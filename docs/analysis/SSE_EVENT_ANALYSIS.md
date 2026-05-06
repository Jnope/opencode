# OpenCode 项目分析：启动、SSE 事件连接与前端事件处理

## 一、如何启动项目

### 前置工具

| 工具 | 要求 | 说明 |
|------|------|------|
| **Bun** | >= 1.3.13 | 主运行时 + 包管理器（`packageManager` 指定） |
| Node.js | >= 22（可选） | Node 适配器存在，但 Bun 优先 |

### 启动步骤

```bash
# 1. 安装依赖
bun install

# 2. 启动后端服务器（headless 模式）
cd packages/opencode
bun run src/index.ts serve --port 4096

# 可选：设置密码 / 开放外部访问 / 配置 CORS
OPENCODE_SERVER_PASSWORD=xxx bun run src/index.ts serve --hostname 0.0.0.0 --port 4096 --cors http://localhost:3000

# 3. 启动前端（另一终端，Vite HMR）
cd packages/app
bun run dev
```

启动后：
- 后端 API：`http://127.0.0.1:4096`
- 前端 UI：`http://localhost:5173`（Vite dev server）或直接访问后端 `http://127.0.0.1:4096/`（内置静态文件）

快速验证：
```bash
curl http://127.0.0.1:4096/global/health          # → {"healthy":true,"version":"1.14.29"}
curl -N http://127.0.0.1:4096/global/event         # 实时 SSE 事件流
```

其他启动方式：
```bash
# CLI TUI 模式（终端界面）
bun run dev

# Desktop 桌面应用
bun run dev:desktop

# 类型检查 / 构建 / 测试
bun run typecheck
bun run build
cd packages/opencode && bun test --timeout 30000
cd packages/app && bun run test:unit
```

---

## 二、SDK 中 SSE 事件的连接与处理

### 整体调用链

```
前端 global-sdk.tsx
  → createSdkForServer()                    # packages/app/src/utils/server.ts
    → createOpencodeClient()                # packages/sdk/js/src/v2/client.ts
      → new OpencodeClient({ client })
        → client.global.event()             # packages/sdk/js/src/v2/gen/sdk.gen.ts:303
          → client.sse.get({ url: "/global/event" })
            → createSseClient()             # packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts
```

### 1. SDK 客户端创建

**`packages/app/src/utils/server.ts`** — 封装 v2 SDK，注入 Basic Auth：

```typescript
export function createSdkForServer({ server, ...config }) {
  const auth = server.password
    ? { Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}` }
    : undefined
  return createOpencodeClient({ ...config, headers: { ...auth }, baseUrl: server.url })
}
```

**`packages/sdk/js/src/v2/client.ts:46-88`** — `createOpencodeClient` 做了三件事：
1. 注入 `x-opencode-directory` / `x-opencode-workspace` 请求头
2. 添加请求拦截器：将 header 中的 directory/workspace 重写到 URL query 参数
3. 添加响应拦截器：如果返回 `text/html` 则抛错（版本不兼容检测）

### 2. SSE 端点调用

**`packages/sdk/js/src/v2/gen/sdk.gen.ts:303-308`** — `Global.event()` 方法：

```typescript
public event<ThrowOnError extends boolean = false>(options?) {
  return (options?.client ?? this.client).sse.get<GlobalEventResponses, unknown, ThrowOnError>({
    url: "/global/event",
    ...options,
  })
}
```

返回 `ServerSentEventsResult<GlobalEventResponses>`，其 `stream` 属性是 `AsyncGenerator`。

### 3. SSE 客户端核心实现

**`packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts:78-239`** — `createSseClient`

核心流程：

```
fetch() → Response.body (ReadableStream)
  → TextDecoderStream
    → reader.read() 循环
      → 累积 buffer
        → 按 "\n\n" 切分 SSE 帧
          → 解析 data:/event:/id:/retry: 行
            → JSON.parse(data) → yield event
```

关键机制：

| 机制 | 实现 |
|------|------|
| **帧解析** | 按 `\n\n` 切分，解析 `data:`/`event:`/`id:`/`retry:` 字段，多行 `data:` 用 `\n` 拼接 |
| **行尾规范化** | `\r\n` → `\n`，`\r` → `\n`（v2 新增，v1 没有） |
| **重连** | 指数退避：`retryDelay * 2^(attempt-1)`，上限 30s |
| **Last-Event-ID** | 记录上次事件 ID，重连时通过 `Last-Event-ID` 头发送 |
| **自定义 fetch** | v2 支持传入自定义 `fetch`（前端用此注入 platform.fetch） |
| **onRequest 钩子** | v2 支持请求拦截器（注入 Auth 等） |

### 4. 前端 SSE 连接与事件合并

**`packages/app/src/context/global-sdk.tsx`** — 事件消费层

```typescript
// 1. 创建 SDK 实例
const eventSdk = createSdkForServer({ signal: abort.signal, fetch: eventFetch, server: currentServer.http })

// 2. 请求 SSE 流
const events = await eventSdk.global.event({ signal: attempt.signal, onSseError: ... })

// 3. 遍历事件流
for await (const event of events.stream) { ... }
```

**事件合并（Coalescing）机制**：

```
SSE 事件 → queue[]（双缓冲）
  ↓ 16ms 动画帧定时器（FLUSH_FRAME_MS = 16）
flush() → batch() → emitter.emit(directory, payload)
```

- 按 key 去重：`session.status:{dir}:{sessionID}`、`lsp.updated:{dir}`、`message.part.updated:{dir}:{msgID}:{partID}`
- `message.part.updated` 覆盖旧值时，标记对应 `message.part.delta` 为 stale（跳过渲染）
- 每 8ms 让出事件循环（`STREAM_YIELD_MS = 8`），避免阻塞 UI
- 心跳超时 15s（`HEARTBEAT_TIMEOUT_MS`），超时则中断触发重连
- 重连延迟 250ms（`RECONNECT_DELAY_MS`）
- 页面可见性变更时，若心跳已过期则中断重连

---

## 三、不同类型 Event 的处理与前端对话显示

### 1. 事件路由层

**`packages/app/src/context/global-sync.tsx:318-358`** — 事件从 emitter 分发到 store：

```typescript
const unsub = globalSDK.event.listen((e) => {
  const directory = e.name
  const event = e.details

  if (directory === "global") {
    applyGlobalEvent({ event, ... })   // 全局事件
    return
  }

  // 目录级事件 → 找到对应的子 store
  const [store, setStore] = children.children[directory]
  applyDirectoryEvent({ event, store, setStore, ... })
})
```

### 2. Event Reducer（Store 变更）

**`packages/app/src/context/global-sync/event-reducer.ts`** — 核心状态更新逻辑

| 事件类型 | Store 变更 | 说明 |
|----------|-----------|------|
| `server.instance.disposed` | 重新 bootstrap 目录 | 实例销毁 |
| `session.created` | 二分插入 `store.session[]` | 新会话创建 |
| `session.updated` | 更新/归档/移除 session | 会话更新 |
| `session.deleted` | 从 `store.session[]` 移除 + 清理缓存 | 会话删除 |
| `session.diff` | 设置 `store.session_diff[sessionID]` | 文件差异 |
| `session.status` | 设置 `store.session_status[sessionID]` | 会话运行状态 |
| `message.updated` | 二分插入/更新 `store.message[sessionID][]` | 消息变更 |
| `message.removed` | 移除消息 + 其所有 parts | 消息删除 |
| `message.part.updated` | 二分插入/更新 `store.part[messageID][]`，**跳过** `patch`/`step-start`/`step-finish` 类型 | Part 状态更新 |
| `message.part.delta` | **字符串拼接**：`part[field] = (existing ?? "") + delta` | 流式文本追加 |
| `message.part.removed` | 从 parts 数组移除 | Part 删除 |
| `permission.asked/replied` | 更新 `store.permission[sessionID][]` | 权限请求 |
| `question.asked/replied/rejected` | 更新 `store.question[sessionID][]` | 用户提问 |
| `vcs.branch.updated` | 更新 `store.vcs` | Git 分支变更 |
| `lsp.updated` | 触发重新加载 LSP 状态 | 语言服务变更 |

**delta 处理核心代码**（`event-reducer.ts:260-277`）：

```typescript
case "message.part.delta": {
  const props = event.properties  // { messageID, partID, field, delta }
  const parts = input.store.part[props.messageID]
  const result = Binary.search(parts, props.partID, (p) => p.id)
  if (!result.found) break
  input.setStore("part", props.messageID, produce((draft) => {
    const part = draft[result.index]
    const existing = part[field] as string | undefined
    ;(part[field] as string) = (existing ?? "") + props.delta  // 追加文本
  }))
}
```

### 3. 前端对话 UI 渲染链

```
Session 页面 (packages/app/src/pages/session.tsx)
  → MessageTimeline (packages/app/src/pages/session/message-timeline.tsx)
    → SessionTurn (packages/ui/src/components/session-turn.tsx)
      → 用户消息: <Message>
      → 助手消息: <AssistantParts> → groupParts() 分组
        → ContextToolGroup（上下文工具折叠组）
        → <Part> → PART_MAPPING[part.type] 查找组件
```

### 4. PART_MAPPING 渲染映射

**`packages/ui/src/components/message-part.tsx`**

| Part 类型 | 组件 | 渲染行为 |
|-----------|------|---------|
| `text` | `TextPartDisplay` | 流式用 `<PacedMarkdown>`，完成用 `<Markdown>`，显示 agent/model/耗时 |
| `reasoning` | `ReasoningPartDisplay` | 流式用 `<PacedMarkdown>`，完成用 `<Markdown>`，需开启 showReasoningSummaries |
| `tool` | `ToolPartDisplay` | 按 ToolRegistry 查找工具渲染器，fallback 到 GenericTool |
| `compaction` | `CompactionPartDisplay` | 折叠分割线 |

### 5. ToolRegistry 工具渲染映射

| 工具名 | 渲染方式 | 代码位置（message-part.tsx） |
|--------|---------|---------|
| `read` | 加载文件列表 | line 1530 |
| `glob` | Markdown 输出 | line 1590 |
| `grep` | Markdown 输出 | line 1614 |
| `list` | Markdown 输出 | line 1570 |
| `bash` | Shell 命令 + ANSI 清理输出 | line 1820 |
| `edit` | Diff 查看器 | line 1886 |
| `write` | 全文件查看器 | line 1958 |
| `apply_patch` | 多文件 Diff 手风琴 | line 2017 |
| `task` | 子 Agent，链接到子 session | line 1739 |
| `webfetch` | 外部 URL 链接 | line 1641 |
| `websearch` | 搜索结果链接 | line 1687 |
| `codesearch` | 代码搜索结果链接 | line 1713 |
| `todowrite` | **返回 null（完全隐藏）** | line 2208 |
| `question` | Q&A 交互 | line 2259 |
| `skill` | 技能名 + shimmer 动画 | line 2304 |
| MCP 工具 | GenericTool 通用展示 | fallback |

### 6. 上下文工具分组

`read`/`glob`/`grep`/`list` 四个工具被自动折叠为 `ContextToolGroup`：

```
┌─ Gathering context... ──────────────────┐
│  3 reads, 2 searches, 1 list            │
├─ (展开) ────────────────────────────────┤
│  📄 read src/index.ts :1-50             │
│  📄 read src/app.tsx                   │
│  🔍 grep "createStore" --include *.ts   │
│  ...                                    │
└─────────────────────────────────────────┘
```

- `CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])`（line 469）
- `HIDDEN_TOOLS = new Set(["todowrite"])`（line 470）
- `groupParts()` 函数（line 525-567）将连续的上下文工具合并为一个 context group
- `ContextToolGroup` 组件（line 898-993）显示 "Gathering context..." / "Gathered context" + 计数摘要

### 7. 流式文本的节奏渲染（PacedMarkdown）

**`packages/ui/src/components/message-part.tsx:161-246`**

不是每收到 delta 就重新渲染 Markdown，而是以 24ms 间隔逐步"揭示"文本：

```typescript
const TEXT_RENDER_PACE_MS = 24

function step(size) {
  if (size <= 12) return 2    // 小文本：每 tick 2 字符
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(24, Math.ceil(size / 8))  // 大文本：最多 24 字符/tick
}

function next(text, start) {
  let end = start + step(text.length - start)
  // 在 end 后 8 字符内寻找词边界（空格/标点）对齐
  for (let i = end; i < Math.min(end + 8, text.length); i++) {
    if (TEXT_RENDER_SNAP.test(text[i])) { end = i + 1; break }
  }
  return end
}
```

- `createPacedValue()`: SolidJS signal，每 24ms 调用 `next()` 推进揭示位置
- 文本非增量变化时（如编辑后），立即显示完整内容
- 流式结束后立即显示全文

### 8. 完整事件流总结

```
后端 AI 流式输出
  → session/processor.ts 创建 Message/Part 记录
    → SyncEvent.run() → SQLite 事务 + Bus.publish()
      → GlobalBus.emit("event")
        → /global/event SSE handler → AsyncQueue → streamSSE

前端 SSE 流
  → createSseClient() fetch + ReadableStream 解析
    → global-sdk.tsx 16ms 合并去重
      → global-sync.tsx 路由到 applyDirectoryEvent
        → event-reducer.ts 更新 SolidJS Store
          → TextPartDisplay / PacedMarkdown 24ms 节奏渲染
          → ToolPartDisplay / ToolRegistry 按工具名渲染
          → ContextToolGroup 折叠上下文工具
```

---

## 关键代码位置索引

| 功能 | 文件路径 |
|------|---------|
| `opencode serve` 命令 | `packages/opencode/src/cli/cmd/serve.ts` |
| 网络选项（port/hostname/cors） | `packages/opencode/src/cli/network.ts` |
| Hono 服务器创建与监听 | `packages/opencode/src/server/server.ts` |
| `/global/event` SSE 端点 | `packages/opencode/src/server/routes/global.ts` |
| `/:dir/event` 实例级 SSE 端点 | `packages/opencode/src/server/routes/instance/event.ts` |
| Bus（Effect PubSub，实例级） | `packages/opencode/src/bus/index.ts` |
| GlobalBus（EventEmitter，全局级） | `packages/opencode/src/bus/global.ts` |
| 事件定义注册表 | `packages/opencode/src/bus/bus-event.ts` |
| SyncEvent 事件溯源 | `packages/opencode/src/sync/index.ts` |
| AsyncQueue 缓冲 | `packages/opencode/src/util/queue.ts` |
| SSE 客户端核心（v2） | `packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts` |
| SDK 客户端工厂（v2） | `packages/sdk/js/src/v2/client.ts` |
| SDK 生成类 | `packages/sdk/js/src/v2/gen/sdk.gen.ts` |
| 前端 SDK 工具 | `packages/app/src/utils/server.ts` |
| 前端 SSE 连接+事件合并 | `packages/app/src/context/global-sdk.tsx` |
| 前端事件路由+全局同步 | `packages/app/src/context/global-sync.tsx` |
| 事件 Reducer（Store 变更） | `packages/app/src/context/global-sync/event-reducer.ts` |
| Store 类型定义 | `packages/app/src/context/global-sync/types.ts` |
| 子 Store 管理（LRU 淘汰） | `packages/app/src/context/global-sync/child-store.ts` |
| 消息 Part 渲染+PacedMarkdown | `packages/ui/src/components/message-part.tsx` |
| 会话 Turn 渲染 | `packages/ui/src/components/session-turn.tsx` |
| 会话页面 | `packages/app/src/pages/session.tsx` |
| 消息时间线 | `packages/app/src/pages/session/message-timeline.tsx` |

---

## 补充分析文档索引

| 主题 | 文件路径 |
|------|---------|
| 项目代码结构解析 | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| 本地调试指南 | [LOCAL_DEBUG_GUIDE.md](LOCAL_DEBUG_GUIDE.md) |
| SSE 事件路由机制（Global vs Directory 分流） | [SSE_EVENT_ROUTING.md](SSE_EVENT_ROUTING.md) |
| Event Reducer 事件处理详解 | [EVENT_REDUCER_ANALYSIS.md](EVENT_REDUCER_ANALYSIS.md) |
| 消息获取与事件合并 | [MESSAGE_FETCHING_AND_MERGING.md](MESSAGE_FETCHING_AND_MERGING.md) |
