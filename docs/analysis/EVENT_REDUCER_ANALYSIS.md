# OpenCode Event Reducer 事件处理详解

**文件**: `packages/app/src/context/global-sync/event-reducer.ts`

---

## 1. 两种事件处理函数

### applyGlobalEvent — 全局事件

处理 `directory === "global"` 的事件（服务端连接、项目级变更）：

| 事件类型 | 处理方式 | 说明 |
|----------|---------|------|
| `global.disposed` | 调用 `refresh()` 重新 bootstrap | 全局实例销毁 |
| `server.connected` | 调用 `refresh()` 重新 bootstrap | 服务器连接建立 |
| `project.updated` | 二分查找后 upsert `project[]` | 项目信息更新 |

### applyDirectoryEvent — 目录级事件

处理 `directory === "/path/to/project"` 的业务事件，涵盖会话、消息、权限等 16 种事件类型。

---

## 2. 目录级事件完整列表

### 2.1 会话（Session）事件

| 事件类型 | properties 结构 | Store 变更 | 处理模式 |
|----------|----------------|-----------|---------|
| `server.instance.disposed` | — | 调用 `push(directory)` 重新 bootstrap | Side-effect |
| `session.created` | `{ info: Session }` | 二分插入 `store.session[]`，trim 超限 session，`sessionTotal++` | Upsert |
| `session.updated` | `{ info: Session }` | 已存在 → `reconcile`；已归档 → 移除+清理缓存；不存在 → 插入+trim | Upsert/Delete |
| `session.deleted` | `{ info: Session }` | 二分查找后 splice 移除 + 清理缓存，`sessionTotal--` | Delete |
| `session.diff` | `{ sessionID, diff: SnapshotFileDiff[] }` | `store.session_diff[sessionID] = reconcile(list(diff))` | Replace |
| `session.status` | `{ sessionID, status: SessionStatus }` | `store.session_status[sessionID] = reconcile(status)` | Replace |
| `todo.updated` | `{ sessionID, todos: Todo[] }` | `store.todo[sessionID] = reconcile(todos)` + 调用 `setSessionTodo` | Replace |

### 2.2 消息（Message）事件

| 事件类型 | properties 结构 | Store 变更 | 处理模式 |
|----------|----------------|-----------|---------|
| `message.updated` | `{ info: Message }` | 二分插入/更新 `store.message[sessionID][]` | Upsert |
| `message.removed` | `{ sessionID, messageID }` | 移除消息 + 删除 `store.part[messageID]` | Delete |

### 2.3 Part 事件

| 事件类型 | properties 结构 | Store 变更 | 处理模式 |
|----------|----------------|-----------|---------|
| `message.part.updated` | `{ part: Part }` | 二分插入/更新 `store.part[messageID][]`，**跳过** `patch`/`step-start`/`step-finish` | Upsert |
| `message.part.delta` | `{ messageID, partID, field, delta }` | **字符串追加**：`part[field] = (existing ?? "") + delta` | Append |
| `message.part.removed` | `{ messageID, partID }` | 二分查找后 splice 移除，空数组时 delete key | Delete |

### 2.4 权限（Permission）事件

| 事件类型 | properties 结构 | Store 变更 | 处理模式 |
|----------|----------------|-----------|---------|
| `permission.asked` | `PermissionRequest` | 二分插入/更新 `store.permission[sessionID][]` | Upsert |
| `permission.replied` | `{ sessionID, requestID }` | 二分查找后 splice 移除 | Delete |

### 2.5 提问（Question）事件

| 事件类型 | properties 结构 | Store 变更 | 处理模式 |
|----------|----------------|-----------|---------|
| `question.asked` | `QuestionRequest` | 二分插入/更新 `store.question[sessionID][]` | Upsert |
| `question.replied` | `{ sessionID, requestID }` | 二分查找后 splice 移除 | Delete |
| `question.rejected` | `{ sessionID, requestID }` | 二分查找后 splice 移除 | Delete |

### 2.6 其他事件

| 事件类型 | properties 结构 | Store 变更 | 处理模式 |
|----------|----------------|-----------|---------|
| `vcs.branch.updated` | `{ branch?: string }` | 更新 `store.vcs` + vcsCache | Replace |
| `lsp.updated` | — | 调用 `loadLsp()` 重新加载 | Side-effect |

---

## 3. 五种处理模式详解

### 3.1 Upsert 模式（插入或更新）

**适用**: `session.created`, `session.updated`, `message.updated`, `message.part.updated`, `permission.asked`, `question.asked`

统一流程：
1. 用 `Binary.search()` 在有序数组中查找目标元素
2. `result.found === true` → 用 `reconcile()` 替换（智能 diff，最小化更新）
3. `result.found === false` → 用 `produce()` + `splice()` 在正确位置插入

```typescript
// 典型 Upsert 代码
const result = Binary.search(array, id, (item) => item.id)
if (result.found) {
  setStore("key", id, result.index, reconcile(newValue))  // 更新
  break
}
setStore("key", id, produce((draft) => {
  draft.splice(result.index, 0, newValue)  // 插入
}))
```

**关键点**:
- 使用 `Binary.search` 确保数组始终按 ID 有序
- `reconcile()` 进行智能 diff，只更新实际变化的字段
- 新插入时 `splice(result.index, 0, item)` 保证插入位置正确

### 3.2 Delete 模式（删除）

**适用**: `session.deleted`, `message.removed`, `message.part.removed`, `permission.replied`, `question.replied`, `question.rejected`

统一流程：
1. `Binary.search()` 定位目标
2. `splice(result.index, 1)` 移除
3. 可选：级联清理关联缓存

```typescript
// 典型 Delete 代码
const result = Binary.search(array, id, (item) => item.id)
if (result.found) {
  setStore(produce((draft) => {
    draft.splice(result.index, 1)
  }))
}
```

**级联清理**:
- `session.deleted` → 调用 `cleanupSessionCaches()` 清理 message/part/permission/question/session_diff/session_status/todo
- `message.removed` → 同时删除 `store.part[messageID]`
- `message.part.removed` → 如果 parts 数组为空，删除 `store.part[messageID]`

### 3.3 Append 模式（增量追加）

**适用**: `message.part.delta`

这是流式文本的核心处理模式：

```typescript
case "message.part.delta": {
  const props = event.properties as {
    messageID: string
    partID: string
    field: string   // 追加的目标字段，如 "text"
    delta: string   // 增量文本
  }
  const parts = input.store.part[props.messageID]
  if (!parts) break
  const result = Binary.search(parts, props.partID, (p) => p.id)
  if (!result.found) break
  input.setStore("part", props.messageID, produce((draft) => {
    const part = draft[result.index]
    const field = props.field as keyof typeof part
    const existing = part[field] as string | undefined
    ;(part[field] as string) = (existing ?? "") + props.delta  // 追加
  }))
  break
}
```

**关键点**:
- `field` 参数指定追加到哪个字段（通常是 `"text"`）
- `(existing ?? "") + props.delta` 确保首次追加时不会出现 `undefined + "text"`
- 使用 `produce()` 确保细粒度响应式更新

**与事件合并的交互**:
- `global-sdk.tsx` 中，如果 `message.part.updated` 已覆盖某个 part，对应的 `message.part.delta` 会被标记为 stale 并跳过
- 这避免了 "先更新完整值，后又追加旧增量" 的问题

### 3.4 Replace 模式（整体替换）

**适用**: `session.diff`, `session.status`, `todo.updated`, `vcs.branch.updated`

直接用新值替换旧值，不进行合并：

```typescript
// session.status
input.setStore("session_status", props.sessionID, reconcile(props.status))

// session.diff
input.setStore("session_diff", props.sessionID, reconcile(list(props.diff), { key: "file" }))

// vcs.branch.updated
input.setStore("vcs", { ...input.store.vcs, branch: props.branch })
```

### 3.5 Side-effect 模式（副作用）

**适用**: `server.instance.disposed`, `lsp.updated`

不直接修改 Store，而是触发副作用：

```typescript
// server.instance.disposed
input.push(input.directory)  // 重新 bootstrap 目录

// lsp.updated
input.loadLsp()  // 重新加载 LSP 状态
```

---

## 4. SKIP_PARTS 过滤机制

```typescript
const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
```

在 `message.part.updated` 处理中，这三种 part 类型会被跳过：

- `patch` — 内部补丁状态，不需要 UI 展示
- `step-start` — 工具调用步骤开始标记
- `step-finish` — 工具调用步骤结束标记

这些类型在 `message-part.tsx` 的 `PART_MAPPING` 中没有对应的渲染组件，跳过它们可以：
1. 减少 Store 更新次数
2. 避免无渲染组件的 part 触发不必要的 UI 重绘

---

## 5. Session 缓存清理机制

### cleanupSessionCaches

当 session 被删除或归档时，清理所有关联缓存：

```typescript
function cleanupSessionCaches(setStore, sessionID, setSessionTodo) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  setStore(produce((draft) => {
    dropSessionCaches(draft, [sessionID])
  }))
}
```

清理的 Store 字段：
- `store.message[sessionID]` — 该 session 的所有消息
- `store.part[messageID]` — 该 session 下所有消息的 parts
- `store.session_diff[sessionID]` — 该 session 的文件差异
- `store.session_status[sessionID]` — 该 session 的运行状态
- `store.permission[sessionID]` — 该 session 的权限请求
- `store.question[sessionID]` — 该 session 的提问
- `store.todo[sessionID]` — 该 session 的 TODO 列表

### cleanupDroppedSessionCaches

当 session 列表被 trim 后，批量清理被移除 session 的缓存：

```typescript
function cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo) {
  const keep = new Set(next.map((item) => item.id))
  const stale = [...Object.keys(store.message), ...Object.keys(store.session_diff), ...]
    .filter((sessionID) => !keep.has(sessionID))
  if (stale.length === 0) return
  // 批量清理 stale session 的缓存
  setStore(produce((draft) => { dropSessionCaches(draft, stale) }))
}
```

---

## 6. Binary Search 工具

**文件**: `packages/core/src/util/binary.ts`

所有数组的查找和定位都使用 `Binary.search()`，确保数组始终按 ID 有序：

```typescript
interface BinarySearchResult {
  found: boolean    // 是否找到
  index: number     // 找到时为目标位置，未找到时为应插入位置
}

Binary.search(array, targetId, (item) => item.id)
```

有序数组的好处：
- O(log n) 查找性能
- 插入时自动保持有序（用于 UI 渲染的排序）
- 避免每次渲染时重新排序

---

## 7. Session Trim 机制

**文件**: `packages/app/src/context/global-sync/session-trim.ts`

当 session 数组超过限制时，trimSessions 会移除多余的 session：

```typescript
// session.created 和 session.updated 中
const trimmed = trimSessions(next, { limit: input.store.limit, permission: input.store.permission })
input.setStore("session", reconcile(trimmed, { key: "id" }))
cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
```

- 按 `limit` 限制最大 session 数量
- 被 trim 掉的 session 会被清理缓存
- 使用 `reconcile` 的 `{ key: "id" }` 选项确保按 ID 匹配更新

---

## 8. 事件处理流程图

```
SSE 事件到达 global-sync.tsx
  │
  ├── directory === "global"
  │   └── applyGlobalEvent()
  │       ├── global.disposed     → refresh()
  │       ├── server.connected    → refresh()
  │       └── project.updated     → upsert project[]
  │
  └── directory === "/path"
      └── applyDirectoryEvent()
          ├── Upsert 模式
          │   ├── session.created/updated   → Binary.search + reconcile/splice
          │   ├── message.updated           → Binary.search + reconcile/splice
          │   ├── message.part.updated      → Binary.search + reconcile/splice (SKIP_PARTS 过滤)
          │   ├── permission.asked          → Binary.search + reconcile/splice
          │   └── question.asked            → Binary.search + reconcile/splice
          │
          ├── Delete 模式
          │   ├── session.deleted           → splice + cleanupSessionCaches
          │   ├── message.removed           → splice + delete part[messageID]
          │   ├── message.part.removed      → splice (空数组时 delete key)
          │   ├── permission.replied        → splice
          │   └── question.replied/rejected → splice
          │
          ├── Append 模式
          │   └── message.part.delta        → part[field] += delta
          │
          ├── Replace 模式
          │   ├── session.diff              → reconcile
          │   ├── session.status            → reconcile
          │   ├── todo.updated              → reconcile
          │   └── vcs.branch.updated        → spread + set
          │
          └── Side-effect 模式
              ├── server.instance.disposed   → push(directory)
              └── lsp.updated               → loadLsp()
```

---

## 关键代码位置索引

| 功能 | 文件路径 |
|------|---------|
| applyGlobalEvent | `packages/app/src/context/global-sync/event-reducer.ts:21-48` |
| applyDirectoryEvent | `packages/app/src/context/global-sync/event-reducer.ts:93-364` |
| SKIP_PARTS 过滤 | `packages/app/src/context/global-sync/event-reducer.ts:19` |
| Delta 追加处理 | `packages/app/src/context/global-sync/event-reducer.ts:260-277` |
| Session 缓存清理 | `packages/app/src/context/global-sync/event-reducer.ts:50-91` |
| Session Trim | `packages/app/src/context/global-sync/session-trim.ts` |
| Session 缓存删除 | `packages/app/src/context/global-sync/session-cache.ts` |
| Binary Search 工具 | `packages/core/src/util/binary.ts` |
| State 类型定义 | `packages/app/src/context/global-sync/types.ts` |

---

## 补充分析文档索引

| 主题 | 文件路径 |
|------|---------|
| 项目代码结构解析 | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| 本地调试指南 | [LOCAL_DEBUG_GUIDE.md](LOCAL_DEBUG_GUIDE.md) |
| SSE 事件连接与前端事件处理 | [SSE_EVENT_ANALYSIS.md](SSE_EVENT_ANALYSIS.md) |
| SSE 事件路由机制（Global vs Directory 分流） | [SSE_EVENT_ROUTING.md](SSE_EVENT_ROUTING.md) |
| 消息获取与事件合并 | [MESSAGE_FETCHING_AND_MERGING.md](MESSAGE_FETCHING_AND_MERGING.md) |
