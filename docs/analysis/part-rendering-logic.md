# Part 渲染逻辑 — 源码 vs SSE Viewer

本文档描述每种 `Part` 类型在 opencode 源码 (`packages/ui/`) 和 SSE Viewer (`docs/analysis/sse-viewer/`) 中的处理方式。

---

## 概览

### 源码架构

源码采用**两级注册表**模式：

1. **`PART_MAPPING`** (`message-part.tsx:159`) — 将 Part `type` 字符串映射到渲染组件。仅注册了 4 种类型：`text`、`reasoning`、`tool`、`compaction`。其余类型（`step-start`、`step-finish`、`patch`、`file`、`agent`、`subtask`）无映射，不渲染。

2. **`ToolRegistry`** (`message-part.tsx:159-465`) — 在 `tool` Part 类型内部，将工具名映射到专用渲染组件。注册了 15 个工具：`read`、`list`、`glob`、`grep`、`webfetch`、`websearch`、`codesearch`、`task`、`bash`、`edit`、`write`、`apply_patch`、`todowrite`、`question`、`skill`。

### SSE Viewer 架构

Viewer 在 `PartView` (`message-timeline.tsx:347-362`) 中使用 **switch 分发**模式，根据 `part.type` 分发到独立组件函数。没有工具类型的子注册表——所有工具由单个 `ToolPartView` 组件统一渲染，显示通用的输入/输出内容。

### 可见性过滤

两端使用相同的 `renderable()` 逻辑来决定 Part 是否显示：

| 过滤规则 | 源码 (`message-part.tsx:573`) | Viewer (`message-timeline.tsx:15`) |
|---|---|---|
| `todowrite` 工具隐藏 | 是（HIDDEN_TOOLS） | 是（HIDDEN_TOOLS） |
| `question` pending/running 状态隐藏 | 是 | 是 |
| 空文本隐藏 | 是 | 是 |
| 空推理文本隐藏 | 是 | 是 |
| 未注册类型隐藏 | 是（不在 PART_MAPPING 中） | 是（不在 RENDERABLE_TYPES 中） |

---

## Part 类型详解

### 1. TextPart (`type: "text"`)

**源码：**
- 注册：`PART_MAPPING["text"]` → `TextPartDisplay`
- 位置：`message-part.tsx:1400-1510`
- 逻辑：以 Markdown 方式渲染文本，支持语法高亮。处理 `synthetic` 标志（合成文本在 `UserMessageDisplay` 中被排除）。支持 `paste-summary` 元数据实现可折叠的粘贴内容。使用 Markdown 渲染器并带代码块语法高亮。

**Viewer：**
- 组件：`TextPartView`
- 位置：`message-timeline.tsx:366-374`
- 逻辑：在 `<pre>` 标签中渲染去除首尾空白的文本。无 Markdown 渲染、无语法高亮、无 paste-summary 支持。非合成文本通过 `TurnView` 用于用户消息展示。

**差异：**
- 源码以 Markdown + 语法高亮渲染；Viewer 使用纯 `<pre>` 文本
- 源码支持 paste-summary 可折叠块；Viewer 不支持
- 源码有专用 CSS/代码块样式；Viewer 使用继承字体

---

### 2. ReasoningPart (`type: "reasoning"`)

**源码：**
- 注册：`PART_MAPPING["reasoning"]` → `ReasoningPartDisplay`
- 位置：`message-part.tsx:1512-1586`
- 逻辑：在可折叠的 `<details>` 元素中渲染。摘要行显示字符数和可选耗时。支持 `showReasoningSummaries` 开关——关闭时推理部分完全隐藏。推理文本以 Markdown 渲染。

**Viewer：**
- 组件：`ReasoningPartView`
- 位置：`message-timeline.tsx:376-387`
- 逻辑：在 `<details>` 元素中渲染，摘要显示字符数。文本以 `<pre>` 标签展示。在 `renderable()` 中遵循 `showReasoningSummaries` 参数，默认为 `true`。

**差异：**
- 源码以 Markdown 渲染推理文本；Viewer 使用纯 `<pre>`
- 源码在摘要中显示耗时信息；Viewer 仅显示字符数
- 源码有更丰富的可折叠样式；Viewer 为极简样式

---

### 3. ToolPart (`type: "tool"`)

**源码：**
- 注册：`PART_MAPPING["tool"]` → `ToolPartDisplay`
- 位置：`message-part.tsx:1301-1395`
- 逻辑：按工具名分发到 `ToolRegistry`，每个注册工具拥有独立组件：
  - `read` → 渲染文件路径 + 内容查看器 (`message-part.tsx:160-215`)
  - `list` → 渲染目录列表 (`message-part.tsx:216-260`)
  - `glob` → 渲染文件模式匹配结果 (`message-part.tsx:261-310`)
  - `grep` → 渲染搜索结果并高亮匹配 (`message-part.tsx:311-370`)
  - `webfetch` → 渲染抓取的 URL 内容 (`message-part.tsx:371-410`)
  - `websearch` → 渲染搜索结果 (`message-part.tsx:411-440`)
  - `codesearch` → 渲染代码搜索结果 (`message-part.tsx:441-465`)
  - `task` → 渲染子任务及状态指示器 (`message-part.tsx:25-60`)
  - `bash` → 渲染命令 + 输出（终端风格） (`message-part.tsx:61-100`)
  - `edit` → 渲染文件差异视图 (`message-part.tsx:101-130`)
  - `write` → 渲染文件写入及内容预览 (`message-part.tsx:131-158`)
  - `apply_patch` → 渲染补丁差异视图
  - `todowrite` → 隐藏（在 HIDDEN_TOOLS 中）
  - `question` → 渲染提问 UI 及选项
  - `skill` → 渲染技能调用展示
- 未注册工具名回退到通用显示。
- 上下文分组：连续的 `read`/`glob`/`grep`/`list` 工具通过 `groupParts()` (`message-part.tsx:525`) 分组为 `ContextToolGroup` (`message-part.tsx:898-960`)。

**Viewer：**
- 组件：`ToolPartView`
- 位置：`message-timeline.tsx:389-426`
- 逻辑：所有工具使用通用渲染。显示工具名称、状态徽章（颜色编码：黄色=运行中、绿色=已完成、红色=错误）及关键输入字段（`filePath`、`path`、`pattern`、`command`）。已完成工具显示截断输出（500 字符）。错误工具显示错误文本。
- 上下文分组：相同 `groupParts()` 逻辑 → `ContextToolGroup` (`message-timeline.tsx:305-343`)，显示 read/search/list 操作计数。

**差异：**
- 源码为每种工具有专用渲染器（15 个工具组件）；Viewer 仅一个通用渲染器
- 源码展示文件差异、终端输出、搜索高亮等；Viewer 展示原始截断输出
- 源码有丰富的交互元素（可折叠区域、差异视图）；Viewer 为只读
- 两端共享相同的上下文分组逻辑和 HIDDEN_TOOLS/question 过滤

---

### 4. CompactionPart (`type: "compaction"`)

**源码：**
- 注册：`PART_MAPPING["compaction"]` → `CompactionPartDisplay`
- 位置：`message-part.tsx:1395-1399`
- 逻辑：渲染居中的分隔线，表示上下文压缩。显示压缩是否为自动的（`auto: true`）。

**Viewer：**
- 组件：`CompactionPartView`
- 位置：`message-timeline.tsx:428-434`
- 逻辑：相同——渲染居中分隔线，`part.auto` 为 true 时显示 "(auto)" 标签。

**差异：** 无——Viewer 与源码逻辑一致。

---

### 5. StepStartPart (`type: "step-start"`)

**源码：**
- 不在 `PART_MAPPING` 中——不渲染
- 内部用于快照追踪

**Viewer：**
- 不在 `RENDERABLE_TYPES` 中——被 `renderable()` 过滤掉

**差异：** 无——两端均跳过此类型。

---

### 6. StepFinishPart (`type: "step-finish"`)

**源码：**
- 不在 `PART_MAPPING` 中——不渲染
- 内部用于步骤完成追踪

**Viewer：**
- 不在 `RENDERABLE_TYPES` 中——被 `renderable()` 过滤掉

**差异：** 无——两端均跳过此类型。

---

### 7. PatchPart (`type: "patch"`)

**源码：**
- 不在 `PART_MAPPING` 中——不渲染
- 事件 reducer 中被跳过（`SKIP_PARTS` 集合）

**Viewer：**
- 不在 `RENDERABLE_TYPES` 中——被 `renderable()` 过滤掉
- 事件 reducer 中被跳过（`event-reducer.ts:26` 的 `SKIP_PARTS` 集合）

**差异：** 无——两端均跳过此类型。

---

### 8. FilePart (`type: "file"`)

**源码：**
- 不在 `PART_MAPPING` 中作为独立渲染的 Part
- 在 `UserMessageDisplay` (`message-part.tsx:996-1171`) 中用于用户消息附件
- 辅助函数来自 `message-file.ts`：
  - `attached()` — `url.startsWith("data:")` — 渲染为缩略图（图片）或文件名标签（非图片）
  - `inline()` — 非附件且含 `source.text` 范围 — 被 `HighlightedText` 用于高亮用户文本中的文件引用
  - `kind()` — `mime.startsWith("image/")` — 判断图片 vs 文件显示方式
- 位置：`message-part.tsx:1070-1105`（附件文件），`message-part.tsx:1175-1210`（高亮内联引用）

**Viewer：**
- 不在 `RENDERABLE_TYPES` 中——不作为独立 Part 渲染
- 在 `TurnView` (`message-timeline.tsx:192-248`) 中用于用户消息展示：
  - `isAttached()` — 与源码逻辑相同（`url.startsWith("data:")`）
  - `isInline()` — 与源码逻辑相同（非附件且含 source.text 范围）
  - 附件文件：渲染图片缩略图或文件名标签 (`message-timeline.tsx:215-230`)
  - 内联文件：被 `HighlightedText` 用于蓝色高亮引用 (`message-timeline.tsx:232-236`)

**差异：** 无——Viewer 与源码在用户消息文件处理逻辑上一致。

---

### 9. AgentPart (`type: "agent"`)

**源码：**
- 不在 `PART_MAPPING` 中作为独立渲染的 Part
- 在 `UserMessageDisplay` 中通过 `HighlightedText` 使用 (`message-part.tsx:1175-1210`)
- 用户文本中的 Agent 引用以紫色背景高亮，使用 `source.start`/`source.end` 范围

**Viewer：**
- 不在 `RENDERABLE_TYPES` 中——不作为独立 Part 渲染
- 在 `TurnView` 中通过 `HighlightedText` 使用 (`message-timeline.tsx:117-132`)
- 相同的紫色高亮内联引用，使用 `source.start`/`source.end` 范围

**差异：** 无——Viewer 与源码逻辑一致。

---

### 10. SubtaskPart (`type: "subtask"`)

**源码：**
- 不在 `PART_MAPPING` 中——不渲染
- 包含 prompt、description 和 agent name，但无可视化组件

**Viewer：**
- 不在 `RENDERABLE_TYPES` 中——被 `renderable()` 过滤掉

**差异：** 无——两端均跳过此类型。

---

## 事件 Reducer 处理

Part 在到达渲染层之前，还会在事件 reducer 层被过滤。

**源码：** `packages/app/src/context/global-sync/event-reducer.ts`
**Viewer：** `docs/analysis/sse-viewer/src/stores/event-reducer.ts`

| 事件 | 源码 | Viewer | 是否一致？ |
|---|---|---|---|
| `message.part.updated` | 存储所有 Part 类型 | 跳过 `patch`、`step-start`、`step-finish`（SKIP_PARTS） | 不同——Viewer 跳过得更激进 |
| `message.part.delta` | 将增量追加到 Part 字段 | 相同逻辑 | 一致 |
| `message.part.removed` | 按 ID 移除 Part | 相同逻辑 | 一致 |

Viewer 的 `SKIP_PARTS` 集合 (`event-reducer.ts:26`) 完全不存储 `patch`、`step-start`、`step-finish` 类型的 Part，而源码会存储它们（只是不渲染）。这是 Viewer 中的有意优化，以减少不显示类型的内存占用。

---

## Part 分组逻辑

### groupParts() — 上下文工具分组

连续的 `read`、`glob`、`grep`、`list` 工具 Part 会被分组为单个可折叠的 `ContextToolGroup`。

**源码：** `message-part.tsx:525-571`
**Viewer：** `message-timeline.tsx:44-78`

| 方面 | 源码 | Viewer |
|---|---|---|
| 分组触发 | `CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])` | 相同 |
| 分组 key 格式 | `context:${first.part.id}` | 相同 |
| 单 Part key 格式 | `part:${messageID}:${part.id}` | 相同 |
| 刷新逻辑 | 遇到非上下文工具或数组末尾时刷新 | 相同 |

### ContextToolGroup 渲染

**源码：** `message-part.tsx:898-960` — 显示计数（read/search/list）、忙碌/完成状态、可展开详情含每个工具信息
**Viewer：** `message-timeline.tsx:305-343` — 相同结构：计数、忙碌/完成徽章、可展开详情含工具名 + 副标题

---

## 用户消息展示

### 源码：UserMessageDisplay (`message-part.tsx:996-1171`)

1. 提取非合成 `TextPart` 作为主文本
2. 提取 `FilePart` 列表，拆分为附件和内联
3. 提取 `AgentPart` 列表
4. 渲染附件文件（图片缩略图或文件名标签）
5. 使用 `HighlightedText` 渲染文本——内联文件引用（蓝色）和 Agent 引用（紫色）

### Viewer：TurnView (`message-timeline.tsx:192-248`)

1. 相同提取逻辑：非合成 TextPart、FilePart 列表（附件/内联）、AgentPart 列表
2. 相同渲染逻辑：附件文件 → 图片/文件标签，文本带 HighlightedText
3. 相同高亮颜色：文件引用 = 蓝色背景，Agent 引用 = 紫色背景

**结论：** Viewer 与源码在用户消息展示上完全一致。

---

## 差异总结

| Part 类型 | 源码渲染方式 | Viewer 渲染方式 | 状态 |
|---|---|---|---|
| `text` | Markdown + 语法高亮 + paste-summary | 纯 `<pre>` 文本 | 简化 |
| `reasoning` | Markdown + 耗时 | 纯 `<pre>` + 字符数 | 简化 |
| `tool`（15 种） | 每种工具专用组件 | 通用工具卡片（名称/状态/输出） | 简化 |
| `compaction` | 分隔线 + auto 标签 | 相同 | 一致 |
| `file` | 用户消息附件 + 内联高亮 | 相同 | 一致 |
| `agent` | 用户消息内联高亮 | 相同 | 一致 |
| `step-start` | 隐藏 | 隐藏 | 一致 |
| `step-finish` | 隐藏 | 隐藏 | 一致 |
| `patch` | 隐藏 | 隐藏（reducer 中也跳过） | 一致 |
| `subtask` | 隐藏 | 隐藏 | 一致 |

Viewer 忠实复现了源码的**结构逻辑**（可见性过滤、分组、用户消息展示）。**视觉保真度**（Markdown 渲染、每工具专用视图、语法高亮）有意简化，以适应 Viewer 只读调试的用途。
