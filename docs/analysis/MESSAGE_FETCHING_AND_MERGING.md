# 消息获取与事件合并分析

## 一、消息获取流程

### 1. API 端点

后端提供 `GET /session/{sessionID}/message` 端点，支持基于游标（cursor）的分页：

- 请求参数：`cursor`（可选，上一页返回的游标）、`limit`（可选）
- 响应头 `x-next-cursor`：返回下一页的游标，无更多数据时为空
- 响应体：消息数组，每条消息包含 `parts` 子数组

### 2. SDK 调用链

```
sync.tsx: fetchMessages()
  → client.session.messages({ params: { id: sessionID }, query: { cursor } })
    → SDK 生成的 HTTP 请求方法
      → GET /session/{sessionID}/message?cursor=xxx
```

### 3. fetchMessages() — 核心获取函数

**`packages/app/src/context/sync.tsx:294-313`**

```typescript
async function fetchMessages(id: string, cursor?: string) {
  const response = await client.session.messages({
    params: { id },
    query: cursor ? { cursor } : undefined,
  })
  if (response.error) throw response.error

  const data = response.data ?? []
  const nextCursor = response.response.headers.get("x-next-cursor") ?? undefined

  // 按 ID 排序消息和 parts
  for (const message of data) {
    message.parts = message.parts?.sort((a, b) => idCompare(a.id, b.id)) ?? []
  }
  data.sort((a, b) => idCompare(a.id, b.id))

  return { data, nextCursor }
}
```

关键点：
- 消息和 parts 均按 ID 排序（`idCompare` 基于时间戳的 ID 比较）
- 返回 `nextCursor` 用于分页加载更早的消息

### 4. loadMessages() — 合并乐观更新并写入 Store

**`packages/app/src/context/sync.tsx:317-369`**

```typescript
async function loadMessages(id: string, mode: "replace" | "prepend", cursor?: string) {
  const { data, nextCursor } = await fetchMessages(id, cursor)

  const optimistic = sync.data.optimistic[id] ?? []
  const { merged, confirmed } = mergeOptimisticPage(optimistic, data)

  // 写入 store — 使用 reconcile 进行差异更新
  sync.setData("message", id, reconcile(merged, { key: "id" }))

  // 清除已确认的乐观消息
  if (confirmed.length > 0) {
    sync.setData("optimistic", id, optimistic.filter(o => !confirmed.includes(o.id)))
  }

  // 更新游标
  sync.setData("cursor", id, nextCursor)

  return nextCursor
}
```

关键机制：
- **`reconcile(merged, { key: "id" })`**：SolidJS 的 reconcile 会按 `id` 键进行差异比较，只更新变化的字段，避免不必要的重渲染
- **乐观更新合并**：服务端返回的数据与乐观消息合并，已确认的乐观消息被清除

### 5. mergeOptimisticPage() — 乐观消息与服务端数据合并

**`packages/app/src/context/sync.tsx:91-119`**

```typescript
function mergeOptimisticPage(optimistic: Message[], serverData: Message[]) {
  const confirmed: string[] = []
  const merged = [...serverData]

  for (const opt of optimistic) {
    const serverIdx = merged.findIndex(m => m.id === opt.id)
    if (serverIdx >= 0) {
      // 服务端已确认此消息 → 标记为已确认，使用服务端数据
      confirmed.push(opt.id)
    } else {
      // 服务端尚未确认 → 保留乐观消息
      merged.push(opt)
    }
  }

  merged.sort((a, b) => idCompare(a.id, b.id))
  return { merged, confirmed }
}
```

逻辑：
- 如果乐观消息 ID 已出现在服务端响应中 → 服务端已确认，移除乐观版本
- 如果乐观消息 ID 不在服务端响应中 → 保留乐观消息（可能是刚刚创建还未持久化的）
- 合并后重新排序

### 6. sync.session.sync() — 会话同步编排

**`packages/app/src/context/sync.tsx:430-501`**

```typescript
sync.session.sync = async (id: string) => {
  // 1. 检查缓存是否已有数据
  if (sync.data.message[id]?.length) return

  // 2. 等待 prefetch 完成（如果正在进行）
  await prefetch

  // 3. 并行加载会话元数据和消息
  const [_, nextCursor] = await Promise.all([
    loadSession(id),
    loadMessages(id, "replace"),
  ])
}
```

- 首次进入会话时触发
- 有缓存则跳过（避免重复加载）
- 会话信息和消息并行请求

### 7. 加载更早消息 — 游标分页

**`packages/app/src/context/sync.tsx:558-579`**

```typescript
history.loadMore = async () => {
  const cursor = sync.data.cursor[sessionId]
  if (!cursor) return  // 没有更多数据
  await loadMessages(sessionId, "prepend", cursor)
}
```

- 使用上一次返回的 `nextCursor` 请求下一页
- `mode: "prepend"` 将更早的消息插入到消息列表头部

---

## 二、事件推送消息的处理与合并

### 1. 事件推送与初始获取的关系

前端采用 **"最后写入胜出"（Last Write Wins）** 的协调模型：

```
初始获取（fetchMessages）→ 写入 Store
                              ↕ 并发
事件推送（event-reducer）→ 更新 Store
```

- **没有栅栏/同步屏障**：初始获取和实时事件可以并发修改同一个 Store
- 两者都通过 SolidJS 的响应式系统操作同一份数据
- 事件推送的更新会直接覆盖或追加到 Store 中已有的消息数据

### 2. sync 类型事件被丢弃

**`packages/app/src/context/global-sdk.tsx:159-161`**

```typescript
if (event.payload.type === "sync") continue
```

后端发送的 `sync` 类型事件在前端被显式丢弃，不进入事件处理流程。这意味着后端的"数据已同步"通知不会触发前端重新获取数据。

### 3. 事件合并的三种模式

在 `event-reducer.ts` 中，不同事件类型以不同方式修改 Store 中的消息数据：

#### 模式 A：Upsert（插入或更新）

适用事件：`message.updated`、`message.part.updated`

```typescript
// message.updated — 二分查找插入或更新
case "message.updated": {
  const result = Binary.search(messages, event.properties.id, (m) => m.id)
  if (result.found) {
    // 更新已有消息
    setStore("message", sessionID, result.index, reconcile(event.properties, { key: "id" }))
  } else {
    // 插入新消息（保持排序）
    setStore("message", sessionID, result.index, event.properties)
  }
}

// message.part.updated — 同样二分查找 upsert
// 注意：patch/step-start/step-finish 类型的 part 被跳过
```

#### 模式 B：Append（追加/delta）

适用事件：`message.part.delta`

```typescript
case "message.part.delta": {
  const { messageID, partID, field, delta } = event.properties
  // 找到对应的 part
  const result = Binary.search(parts, partID, (p) => p.id)
  if (!result.found) break

  // 字符串追加：existing + delta
  setStore("part", messageID, produce((draft) => {
    const part = draft[result.index]
    const existing = part[field] as string | undefined
    ;(part[field] as string) = (existing ?? "") + delta
  }))
}
```

**delta 的过期机制**（在 `global-sdk.tsx` 的事件合并队列中）：

```
SSE 事件 → 16ms 合并队列
  → message.part.updated 覆盖旧 part 时
    → 标记对应的 message.part.delta 为 stale
      → flush 时跳过 stale 的 delta 事件
```

这确保了当 part 的完整状态已通过 `message.part.updated` 到达时，不再处理过时的增量 delta。

#### 模式 C：Delete（删除）

适用事件：`message.removed`、`message.part.removed`

```typescript
case "message.removed": {
  // 移除消息及其所有 parts
  const idx = messages.findIndex(m => m.id === event.properties.id)
  if (idx >= 0) {
    setStore("message", sessionID, (prev) => [...prev.slice(0, idx), ...prev.slice(idx + 1)])
  }
  // 清理 parts 缓存
  setStore("part", event.properties.id, undefined as any)
}

case "message.part.removed": {
  // 从 parts 数组中移除
  const result = Binary.search(parts, partID, (p) => p.id)
  if (result.found) {
    setStore("part", messageID, (prev) => [...prev.slice(0, result.index), ...prev.slice(result.index + 1)])
  }
}
```

### 4. 事件推送与 Store 数据的最终一致性

由于没有同步屏障，可能出现以下场景：

| 场景 | 处理方式 |
|------|---------|
| 初始获取尚未完成，事件已到达 | 事件直接 upsert 到空数组（Binary.search 找不到则插入） |
| 初始获取返回旧数据，事件已更新 | 事件更新覆盖初始数据（Last Write Wins） |
| delta 事件在 part 尚未创建时到达 | delta 被忽略（Binary.search 找不到则 break） |
| 同一 part 的 updated 和 delta 并发 | 合并队列中 updated 标记 delta 为 stale，delta 被跳过 |

---

## 三、消息从 Store 到 UI 的渲染链

### 1. Store → 组件数据流

```
sync.data.message[sessionID]  （SolidJS Store）
  → session.tsx: messages = createMemo(() => sync.data.message[params.id] ?? [])
    → userMessages = messages.filter(m => m.role === "user")
      → visibleUserMessages = userMessages.filter(m => !m.reverted)
        → createSessionHistoryWindow() 管理可见窗口
          → renderedUserMessages — 根据 turnStart 切片
            → MessageTimeline 接收 renderedUserMessages
              → createTimelineStaging() 渐进式 DOM 挂载
                → <For each={rendered()}> 渲染每个 userMessage
                  → <SessionTurn> 渲染一轮对话
```

### 2. createSessionHistoryWindow — Turn 级可见窗口

**`packages/app/src/pages/session.tsx:94-319`**

控制可见的消息轮次（turn），实现虚拟滚动：

| 参数 | 值 | 说明 |
|------|-----|------|
| `turnInit` | 10 | 初始显示 10 个 turn |
| `turnBatch` | 8 | 每次回填 8 个 turn |
| `turnScrollThreshold` | 200px | 距顶部 200px 时触发预加载 |
| `turnPrefetchBuffer` | 16 | 预加载缓冲区 |

关键方法：
- `renderedUserMessages`：根据 `turnStart` 切片 `visibleUserMessages`
- `backfillTurns()`：向上批量展开更早的 turn
- `loadAndReveal()`：从服务器加载更早的消息 + 展开一批 turn
- `fetchOlderMessages()`：预加载机制（带冷却和增长限制）
- `onScrollerScroll()`：滚动到顶部附近时触发预加载/回填

### 3. createTimelineStaging — DOM 级渐进挂载

**`packages/app/src/pages/session/message-timeline.tsx:132-208`**

防止大量 DOM 节点同时挂载导致卡顿：

| 参数 | 值 | 说明 |
|------|-----|------|
| `init` | 1 | 初始挂载 1 个 turn |
| `batch` | 3 | 每个动画帧追加 3 个 turn |

```typescript
function createTimelineStaging(count, cfg = { init: 1, batch: 3 }) {
  const [staged, setStaged] = createSignal(cfg.init)

  // 每帧追加 batch 个 turn，直到全部挂载
  createEffect(() => {
    if (staged() >= count()) return
    requestAnimationFrame(() => {
      setStaged(Math.min(staged() + cfg.batch, count()))
    })
  })

  return { staged }
}
```

- 一旦某个 session 完成全部 staging，不会再重新 staging
- 新消息追加时，staged 数量自动跟随 count 增长

### 4. SessionTurn — 单轮对话渲染

每个 `SessionTurn` 对应一个用户消息，渲染流程：

```
<SessionTurn userMessage={msg}>
  → <Message> 渲染用户消息
  → 获取该用户消息之后、下一条用户消息之前的所有助手消息
    → <AssistantParts> 渲染助手回复
      → groupParts() 分组：
        → ContextToolGroup（read/glob/grep/list 折叠组）
        → 隐藏 todowrite
        → 其他 part 按类型渲染
```

### 5. Part 类型与渲染映射

| Part 类型 | 渲染方式 | 流式支持 |
|-----------|---------|---------|
| `text` | PacedMarkdown（24ms 节奏渲染）→ Markdown | 是（delta 追加） |
| `reasoning` | PacedMarkdown → Markdown | 是（delta 追加） |
| `tool` | ToolRegistry 查找 → 工具专用组件 | 否（updated 更新） |
| `compaction` | 折叠分割线 | 否 |

### 6. PacedMarkdown — 流式文本节奏渲染

**`packages/ui/src/components/message-part.tsx:161-246`**

不是每收到 delta 就重渲染 Markdown，而是以 24ms 间隔逐步"揭示"文本：

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
  // 在 end 后 8 字符内寻找词边界对齐
  for (let i = end; i < Math.min(end + 8, text.length); i++) {
    if (TEXT_RENDER_SNAP.test(text[i])) { end = i + 1; break }
  }
  return end
}
```

- `createPacedValue()`：SolidJS signal，每 24ms 调用 `next()` 推进揭示位置
- 文本非增量变化时（如编辑后），立即显示完整内容
- 流式结束后立即显示全文

---

## 四、完整数据流总结

```
┌─────────────────────────────────────────────────────────────────────┐
│                        初始加载路径                                  │
│                                                                     │
│  GET /session/{id}/message                                          │
│    → fetchMessages() → 排序消息+parts                               │
│      → mergeOptimisticPage() 合并乐观消息                            │
│        → reconcile() 差异写入 SolidJS Store                         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        实时更新路径                                  │
│                                                                     │
│  /global/event SSE 流                                               │
│    → createSseClient() 解析 SSE 帧                                  │
│      → global-sdk.tsx 16ms 合并去重                                  │
│        → global-sync.tsx 路由到 applyDirectoryEvent                  │
│          → event-reducer.ts 更新 Store:                              │
│            - Upsert: message.updated / message.part.updated          │
│            - Append: message.part.delta (字符串追加)                  │
│            - Delete: message.removed / message.part.removed          │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        UI 渲染路径                                   │
│                                                                     │
│  SolidJS Store (响应式)                                              │
│    → session.tsx: messages memo → userMessages → visibleUserMessages │
│      → createSessionHistoryWindow (turn 级虚拟窗口)                   │
│        → MessageTimeline                                             │
│          → createTimelineStaging (DOM 渐进挂载)                       │
│            → <For each={rendered}> → <SessionTurn>                   │
│              → <Message> (用户) + <AssistantParts> (助手)             │
│                → text: PacedMarkdown (24ms 节奏渲染)                  │
│                → tool: ToolRegistry → 工具专用组件                    │
│                → ContextToolGroup (上下文工具折叠)                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 关键代码位置索引

| 功能 | 文件路径 |
|------|---------|
| 消息获取 + Store 管理 | `packages/app/src/context/sync.tsx` |
| fetchMessages() | `packages/app/src/context/sync.tsx:294-313` |
| loadMessages() | `packages/app/src/context/sync.tsx:317-369` |
| mergeOptimisticPage() | `packages/app/src/context/sync.tsx:91-119` |
| sync.session.sync() 编排 | `packages/app/src/context/sync.tsx:430-501` |
| 游标分页加载更多 | `packages/app/src/context/sync.tsx:558-579` |
| SKIP_PARTS 过滤 | `packages/app/src/context/sync.tsx:18` |
| 事件 Reducer（Store 变更） | `packages/app/src/context/global-sync/event-reducer.ts` |
| 事件合并队列（16ms 去重） | `packages/app/src/context/global-sdk.tsx` |
| Turn 级虚拟窗口 | `packages/app/src/pages/session.tsx:94-319` |
| 消息 memo 计算 | `packages/app/src/pages/session.tsx:449-480` |
| 路由切换触发同步 | `packages/app/src/pages/session.tsx:758-789` |
| DOM 渐进挂载 | `packages/app/src/pages/session/message-timeline.tsx:132-208` |
| Timeline 主组件 | `packages/app/src/pages/session/message-timeline.tsx:210-1118` |
| PacedMarkdown 节奏渲染 | `packages/ui/src/components/message-part.tsx:161-246` |
| Part 类型渲染映射 | `packages/ui/src/components/message-part.tsx` |
| ToolRegistry 工具映射 | `packages/ui/src/components/message-part.tsx` |

---

## 补充分析文档索引

| 主题 | 文件路径 |
|------|---------|
| 项目代码结构解析 | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| 本地调试指南 | [LOCAL_DEBUG_GUIDE.md](LOCAL_DEBUG_GUIDE.md) |
| SSE 事件连接与前端事件处理 | [SSE_EVENT_ANALYSIS.md](SSE_EVENT_ANALYSIS.md) |
| SSE 事件路由机制（Global vs Directory 分流） | [SSE_EVENT_ROUTING.md](SSE_EVENT_ROUTING.md) |
| Event Reducer 事件处理详解 | [EVENT_REDUCER_ANALYSIS.md](EVENT_REDUCER_ANALYSIS.md) |
