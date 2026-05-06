# OpenCode SSE 事件路由机制：Global 与 Directory 分流

## 1. 整体路由架构

后端所有实例共享一个 `/global/event` SSE 连接，通过 `directory` 字段区分事件来源；前端用 `directory ?? "global"` 将事件分流到全局通道或具体目录通道，每个目录维护独立的 SolidJS Store。

```
后端 Bus.publish()
  → GlobalBus.emit("event", { directory, payload })
    → /global/event SSE → data: {"directory":"/path/to/project","payload":{...}}

前端 SSE 接收
  → event.directory ?? "global"   // 转换：无 directory → "global"
    → emitter.emit(directory, payload)
      → listener 检查 e.name:
          e.name === "global"  → applyGlobalEvent()   // 处理 server.connected, server.heartbeat 等
          e.name === "/path"   → applyDirectoryEvent() // 处理 session/message/part 等业务事件
```

---

## 2. 后端：发布时携带 directory 字段

**文件**: `packages/opencode/src/bus/index.ts`

Bus.publish() 在发布事件到 GlobalBus 时，将 `InstanceState.directory` 作为 `directory` 字段传入：

```typescript
GlobalBus.emit("event", {
  directory: state.directory,  // 来自实例的工作目录，如 "/Users/x/project"
  project: state.project,
  workspace: state.workspace,
  payload: event,
})
```

### GlobalBus 定义

**文件**: `packages/opencode/src/bus/global.ts`

```typescript
export const GlobalBus = new EventEmitter<{ event: [GlobalEvent] }>()

// GlobalEvent 类型
type GlobalEvent = {
  directory: string    // 目录路径
  project?: string
  workspace?: string
  payload: Event       // 实际业务事件
}
```

### /global/event SSE 端点

**文件**: `packages/opencode/src/server/routes/global.ts:97-138`

后端 SSE 端点订阅 GlobalBus，将 GlobalEvent 对象 JSON 序列化后作为 SSE `data:` 行发送：

```typescript
async (c) => {
  return streamEvents(c, (q) => {
    async function handler(event: any) {
      q.push(JSON.stringify(event))  // event = GlobalEvent { directory, payload, ... }
    }
    GlobalBus.on("event", handler)
    return () => GlobalBus.off("event", handler)
  })
}
```

SSE 传输数据格式示例：
```
data: {"directory":"/Users/x/project","project":"my-app","payload":{"type":"session.created","properties":{...}}}
```

---

## 3. SDK 层：SSE 客户端解析

**文件**: `packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts`

`createSseClient()` 负责 SSE 帧解析，将 `data:` 行 JSON.parse 后 yield 原始对象（即 GlobalEvent），不做任何路由转换：

```typescript
// 读取 SSE 流
const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()

// 累积 buffer，按 "\n\n" 切分帧
// 解析 data:/event:/id:/retry: 行
// JSON.parse(data) → yield event  (此处 event = GlobalEvent)
```

SDK 层只负责传输层解析，**不负责** global/directory 的路由逻辑。

---

## 4. 前端转换：directory → "global" | directory

**文件**: `packages/app/src/context/global-sdk.tsx`

### 4.1 关键转换逻辑（第 158 行）

```typescript
const directory = event.directory ?? "global"
```

- 如果 `event.directory` 有值（来自某个工作目录的实例）→ 使用该目录路径作为路由 key
- 如果 `event.directory` 为空/undefined → 默认为 `"global"`

### 4.2 通过 Emitter 按目录分发（第 91 行）

```typescript
emitter.emit(event.directory, event.payload)
```

`createGlobalEmitter` 是一个多 channel 事件发射器，每个 directory 路径对应一个独立的监听通道。此时 `event.directory` 可能为：
- `"global"` — 全局事件
- `"/Users/x/project1"` — 具体目录事件
- `"/Users/x/project2"` — 另一个目录事件

### 4.3 事件合并（Coalescing）中的 key 机制

事件在 16ms 动画帧内批量处理，按 key 去重：

```typescript
// key 生成逻辑
function eventKey(event) {
  if (event.type === "session.status") return `session.status:${dir}:${sessionID}`
  if (event.type === "lsp.updated") return `lsp.updated:${dir}`
  if (event.type === "message.part.updated") return `message.part.updated:${dir}:${msgID}:${partID}`
  return null  // 不去重
}
```

directory 路径参与去重 key 的构造，确保不同目录的同类型事件不会被误合并。

---

## 5. 消费端路由到不同处理函数

**文件**: `packages/app/src/context/global-sync.tsx:318-358`

```typescript
const unsub = globalSDK.event.listen((e) => {
  const directory = e.name    // emitter 的 channel name = directory 路径
  const event = e.details     // payload（实际业务事件）

  if (directory === "global") {
    applyGlobalEvent({ event, ... })    // 全局事件处理
    return
  }

  // directory 路径 → 找到对应子 store
  const [store, setStore] = children.children[directory]
  applyDirectoryEvent({ event, store, setStore, ... })  // 目录级事件处理
})
```

### 5.1 全局事件 (applyGlobalEvent)

处理 `directory === "global"` 的事件：

| 事件类型 | 处理方式 |
|----------|---------|
| `server.connected` | 初始化连接状态 |
| `server.heartbeat` | 更新心跳时间戳 |
| `server.instance.disposed` | 触发目录重新 bootstrap |

### 5.2 目录级事件 (applyDirectoryEvent)

处理 `directory === "/path/to/project"` 的事件：

| 事件类型 | Store 变更 |
|----------|-----------|
| `session.created/updated/deleted` | 更新 session 数组 |
| `session.status` | 更新 session_status 映射 |
| `message.updated/removed` | 更新 message 数组 |
| `message.part.updated/delta/removed` | 更新 part 数组 |
| `permission.asked/replied` | 更新 permission 数组 |
| `question.asked/replied/rejected` | 更新 question 数组 |
| `vcs.branch.updated` | 更新 vcs 状态 |
| `lsp.updated` | 触发 LSP 重载 |

---

## 6. 子 Store 管理与 LRU 淘汰

**文件**: `packages/app/src/context/global-sync/child-store.ts`

每个 directory 维护独立的子 Store，通过 `createChildStoreManager` 管理：

- **最大数量**: 30 个目录
- **TTL**: 20 分钟无活动则淘汰
- **淘汰策略**: LRU（最近最少使用）

```typescript
const children = createChildStoreManager({
  maxChildren: 30,
  ttl: 20 * 60 * 1000,  // 20 min
})
```

当 `applyDirectoryEvent` 收到某目录事件时：
1. 查找或创建该目录的子 Store
2. 更新该目录的最近访问时间（LRU）
3. 如果超出最大数量，淘汰最久未访问的目录

---

## 7. 完整数据流图

```
后端 AI 流式输出
  → session/processor.ts 创建 Message/Part 记录
    → SyncEvent.run() → SQLite 事务 + Bus.publish()
      → Bus.publish() → Effect PubSub（实例级）
        → GlobalBus.emit("event", { directory, payload })
          → /global/event SSE handler → AsyncQueue → streamSSE

前端 SSE 流
  → createSseClient() fetch + ReadableStream 解析
    → yield GlobalEvent { directory, payload }
      → global-sdk.tsx: event.directory ?? "global"
        → emitter.emit(directory, payload)
          → global-sync.tsx: e.name 路由
            ├── "global" → applyGlobalEvent()
            └── "/path"  → applyDirectoryEvent()
                ├── 子 Store 查找/创建（LRU 管理）
                └── event-reducer.ts 更新 SolidJS Store
                    → UI 响应式渲染
```

---

## 关键代码位置索引

| 功能 | 文件路径 |
|------|---------|
| Bus.publish() 发布到 GlobalBus | `packages/opencode/src/bus/index.ts` |
| GlobalBus 定义 | `packages/opencode/src/bus/global.ts` |
| /global/event SSE 端点 | `packages/opencode/src/server/routes/global.ts` |
| SSE 客户端核心解析 | `packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts` |
| SDK 客户端工厂 | `packages/sdk/js/src/v2/client.ts` |
| 前端 directory 转换 + emitter 分发 | `packages/app/src/context/global-sdk.tsx` |
| 事件路由到 global/directory 处理 | `packages/app/src/context/global-sync.tsx` |
| 事件 Reducer（Store 变更） | `packages/app/src/context/global-sync/event-reducer.ts` |
| 子 Store LRU 管理 | `packages/app/src/context/global-sync/child-store.ts` |
| Store 类型定义 | `packages/app/src/context/global-sync/types.ts` |

---

## 补充分析文档索引

| 主题 | 文件路径 |
|------|---------|
| 项目代码结构解析 | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| 本地调试指南 | [LOCAL_DEBUG_GUIDE.md](LOCAL_DEBUG_GUIDE.md) |
| SSE 事件连接与前端事件处理 | [SSE_EVENT_ANALYSIS.md](SSE_EVENT_ANALYSIS.md) |
| Event Reducer 事件处理详解 | [EVENT_REDUCER_ANALYSIS.md](EVENT_REDUCER_ANALYSIS.md) |
| 消息获取与事件合并 | [MESSAGE_FETCHING_AND_MERGING.md](MESSAGE_FETCHING_AND_MERGING.md) |
