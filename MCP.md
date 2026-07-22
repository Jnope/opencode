# MCP 处理

## 流程

packages/opencode/src/mcp/index.ts — 封装 @modelcontextprotocol/sdk 的 Client 为 Effect 服务。
三类能力的调用链

1. Tools（工具）

- 获取定义：mcp/index.ts:150 defs() → client.listTools()
- 暴露给模型：mcp/index.ts:618 tools getter，由 session/prompt.ts:449 resolveTools() 聚合
- 执行调用：mcp/index.ts:133 convertMcpTool().execute() → client.callTool()
- 结果处理：session/prompt.ts:477-521 处理 result.content（text/image/resource）
- 持久化返回：session/processor.ts:333 completeToolCall()

2. Resources（资源）

- 列出：mcp/index.ts:671 resources() → client.listResources()
- 读取：mcp/index.ts:708 readResource() → client.readResource()
- 注入对话：session/prompt.ts:949 把资源内容作为消息部件

3. Prompts（提示模板）

- 列出：mcp/index.ts:666 prompts() → client.listPrompts()
- 获取：mcp/index.ts:702 getPrompt() → client.getPrompt()
- 转换为命令：command/index.ts:126 暴露为斜杠命令
  HTTP API 对外返回
- server/routes/instance/mcp.ts — GET /mcp 返回状态、连接管理等
- server/routes/instance/experimental.ts:396 — GET /resource 返回所有 MCP 资源
  数据流简图
  client.listTools() ──► mcp.tools() ──► prompt.ts resolveTools()
  │
  model 调用 tool
  ▼
  client.callTool() ──► result.content ──► prompt.ts 处理
  │
  ▼
  processor.ts completeToolCall() ──► 存入消息 ──► 回传模型
  启动时 create() 连接 transport 并缓存工具定义（mcp/index.ts:408），watch() 监听 ToolListChangedNotification 并发布 mcp.tools.changed 事件触发刷新（mcp/index.ts:460）

## MCP 消息

### global/sse

/global/event SSE 接口定义在 packages/opencode/src/server/routes/instance/httpapi/global.ts:60。
关键部分：

- 路径声明：global.ts:42 — event: "/global/event"，在 GlobalPaths 中定义
- HttpApiEndpoint 定义：global.ts:60-68 — 通过 HttpApiEndpoint.get("event", GlobalPaths.event, { success: GlobalEventSchema }) 注册，并标注为 SSE（描述 "server-sent events"）
- SSE 响应实现：eventResponse() 函数 global.ts:123-168 — 构造 ReadableStream，设置 Content-Type: text/event-stream，订阅 GlobalBus 的 "event" 事件，并按 data: <json>\n\n 格式写入；附带心跳（server.heartbeat，10s 一次）和初始 server.connected 事件
- Handler 绑定：global.ts:253 — .handleRaw("event", event)，用 handleRaw 因为返回的是原始 Response 而非 schema 匹配的 JSON
  相关引用：
- 公共路由分流：src/server/routes/instance/httpapi/public.ts:132
- 中间件放行：src/server/middleware.ts:89
- Workspace 控制面消费：src/control-plane/workspace.ts:427

### 当前问题

MCP 工具调用后，`prompt.ts:506-517` 构造的 `output` 中包含 `content: result.content`（原始 MCP 返回），但 `completeToolCall`（`processor.ts:171-195`）的 `output` 参数类型只声明了 `title / metadata / output / attachments`，没有 `content` 字段。也就是说：

1. 原始 MCP `result.content`（可能含 image/resource blob、未截断文本、结构化数据）在持久化时被丢弃；
2. 只有被 `truncate.output()` 截断后的 `output.output`（字符串）随 `ToolStateCompleted` 存入 `PartTable`；
3. 该 part 又通过 `SyncEvent.run(MessageV2.Event.PartUpdated)` 发到 `GlobalBus`，最终经 `/global/event` SSE 以 `data: <整段 ToolPart JSON>\n\n` 形式返回给客户端。

后果：

- 大体积 MCP 结果（如完整文件、长列表）经 SSE 一次性下发，易导致帧过大、首屏延迟、反代缓冲超时；
- 客户端拿不到原始 MCP `result.content`，无法自行解析结构化内容；
- `truncate.output()` 的截断逻辑（`prompt.ts:499`）由 opencode 单方面决定，不适用于"只想拿到原始结果"的场景。

---

## 计划：新增 MCP 原始结果接口 + SSE 仅回传 ID

目标：

1. 新增 HTTP 接口 `GET /mcp/result/:id`，按唯一 ID 取回某次 MCP 工具调用的**原始** `CallToolResult`（即 `result.content` + `result.metadata` 等完整字段）。
2. `completeToolCall` 流程中，在持久化 part 之前，把原始 MCP 结果写入一个带 TTL 的内存/磁盘缓存，生成 `mcpResultID`。
3. `ToolStateCompleted` schema 新增可选字段 `mcp_result_id`，随 part 一同持久化和下发。
4. `/global/event` SSE 中 `message.part.updated` 事件的 `part.state.output` 仍是截断文本（保持向后兼容），但新增的 `mcp_result_id` 让客户端能按需拉取原始结果——**SSE 帧不再包含原始大体积内容**，体积大幅降低。
5. 客户端（TUI / Web）在渲染 tool part 时，若需要原始内容，用 `mcp_result_id` 调 `GET /mcp/result/:id` 按需获取。

### 数据结构

```ts
// packages/opencode/src/mcp/result-store.ts （新增）

// ── SQLite 持久表：只存纯文本 content ──
// packages/opencode/src/mcp/mcp-result.sql.ts
export const McpResultTable = sqliteTable(
  "mcp_result",
  {
    id: text().primaryKey(), // McpResultID (UUID)
    part_id: text()
      .notNull()
      .references(() => PartTable.id, { onDelete: "cascade" }),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    server_name: text().notNull(),
    tool_name: text().notNull(),
    content: text({ mode: "json" }).notNull().$type<unknown[]>(), // 纯文本 content 数组
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    created_at: integer().notNull(),
  },
  (table) => [index("mcp_result_part_idx").on(table.part_id), index("mcp_result_session_idx").on(table.session_id)],
)

// ── 内存 LRU：存含 blob 的完整 content ──
export type McpResultID = string & { readonly __brand: "McpResultID" }

export interface StoredMcpBlobResult {
  id: McpResultID
  partID: string
  sessionID: string
  serverName: string
  toolName: string
  content: unknown[] // 原始 result.content（可能含 image/resource blob）
  metadata?: Record<string, unknown>
  createdAt: number
}
```

### 存储策略

| 内容类型                                                                     | 存储位置 | 表名 / 容器        | 生命周期                 |
| ---------------------------------------------------------------------------- | -------- | ------------------ | ------------------------ |
| **纯文本** content（所有 `contentItem.type === "text"`）                     | SQLite   | `mcp_result` 表    | 持久化，随 part 级联删除 |
| **含 blob** content（任一 `contentItem.type` 为 `image` 或 `resource.blob`） | 内存 LRU | `Map` + `LRUCache` | TTL 1 小时，进程重启丢失 |

判断逻辑：

```
如果 result.content 中所有项 type 都是 "text" → 纯文本 → 写 SQLite
否则（含有 image/resource.blob）                     → 含 blob → 写内存 LRU
```

SQLite 表通过 `ON DELETE CASCADE` 与 `PartTable` 关联——part 删除时对应的 `mcp_result` 行自动清理，无需额外 GC。内存 LRU 则需要定时（`Schedule.spaced("5 minutes")`）扫描过期条目。

### 实现步骤

#### 1. 新建 `src/mcp/mcp-result.sql.ts`

用 Drizzle 定义 `McpResultTable`（如上），通过 `bun run db generate --name mcp_result` 生成迁移 SQL。

#### 2. 新建 `src/mcp/result-store.ts`

- 暴露 `McpResultStore` Service（Effect Context Service），方法：
  - `put(partID, sessionID, serverName, toolName, content, metadata): Effect.Effect<McpResultID>` —— 内部判断 content 是否含 blob，分路写入 SQLite 或内存 LRU，生成 UUID 返回。
  - `get(id: McpResultID): Effect.Effect<StoredMcpResult | undefined>` —— 先查内存 LRU，未命中再查 SQLite。
- `put` 若判定为 blob 类，走内存 LRU（`Map<McpResultID, StoredMcpBlobResult>` + 容量如 256 条 / 64MB），超阈值写临时文件到 `storageDir/mcp-results/<id>.json`。
- 纯文本写 SQLite 时，使用 `Database.transaction` 内 `db.insert(McpResultTable).values(...).run()`。
- 启动 `Effect.forkScoped` 定时清理 LRU 过期条目。
- 导出 `McpResultStore.layer`，在 `src/project/bootstrap.ts` 注册到 runtime。

#### 3. 修改 `src/session/processor.ts` `completeToolCall`

- 扩展 `output` 参数类型，新增可选字段：
  - `content?: unknown[]`（对应原始 `result.content`）
  - `serverName?: string`
  - `toolName?: string`
- 在 `session.updatePart` 之前，若 `output.content` 存在，`yield* mcpResultStore.put(part.id, sessionID, serverName, toolName, output.content, output.metadata)`，拿到 `mcpResultID`。
- 把 `mcpResultID` 放进 `state`：
  ```ts
  state: {
    status: "completed",
    // ...原字段...
    mcp_result_id: mcpResultID,   // 新增可选字段
  }
  ```

#### 4. 修改 `src/session/prompt.ts` MCP 工具包装（449-525 行）

- 在 `prompt.ts:506-517` 的 `output` 对象里，保留 `content: result.content`（现已存在但未被消费），并补上 `serverName` / `toolName`（从 `key` 和 `item` 可得），让 `completeToolCall` 能拿到。
- 不改 `truncate.output()` 行为——`output.output` 仍是截断文本，供模型和轻量 SSE 使用。

#### 5. 修改 `src/session/message-v2.ts` `ToolStateCompleted` schema

- 新增可选字段：`mcp_result_id: Schema.optional(Schema.String)`
- 同步给 `ToolStateCompleted` 的 zod 静态导出（仓库里 part schema 有 `.zod` 静态属性，供 DB 读写校验）。
- 注意：这是**加字段**，不破坏旧数据；旧 part 没有 `mcp_result_id`，反序列化为 `undefined`。

#### 6. 新增 HTTP 接口 `GET /mcp/result/:id`

在 `src/server/routes/instance/httpapi/mcp.ts` 扩展 `McpApi`：

```ts
HttpApiEndpoint.get("result", "/mcp/result/:id", {
  params: { id: Schema.String },
  success: McpResultSchema, // 联合：统一返回 { id, partID, sessionID, serverName, toolName, content, metadata, createdAt }
  error: HttpApiError.NotFound,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "mcp.result.get",
    summary: "Get raw MCP tool result",
    description: "Retrieve the raw (untruncated) Model Context Protocol tool call result by ID.",
  }),
)
```

Handler 依次查内存 LRU 和 SQLite：

```ts
const result = Effect.fn("McpHttpApi.result")(function* (ctx: { params: { id: string } }) {
  const stored = yield* mcpResultStore.get(ctx.params.id as McpResultID)
  if (!stored) return yield* new HttpApiError.NotFound({})
  return stored
})
```

- 走 `Authorization` 中间件（与同组其他 `/mcp/*` 一致）。
- **不走 SSE 压缩豁免**——它是普通 JSON GET，可以正常 gzip。

#### 7. SSE 帧瘦身（**无需改 `global.ts`**）

`/global/event` 的 `eventResponse()` 只是 `JSON.stringify(event)` 原样下发，不需要改动。收益来自：

- `ToolStateCompleted.output` 仍是截断文本（已经很小）；
- 新增的 `mcp_result_id` 只是一个短字符串；
- 原始 `result.content`（可能数 MB）不再出现在 SSE 帧里——它从未被持久化过，本计划只是**让它可被按需拉取**，而不是新增到 SSE。

> 说明：当前 SSE 帧里**本来就没有**原始 `result.content`（`completeToolCall` 丢弃了它）。本计划真正的价值是：
>
> 1. 不再丢弃原始结果，使其可通过 `GET /mcp/result/:id` 取回；
> 2. 给 `ToolStateCompleted` 加 `mcp_result_id`，让客户端知道"这次调用有原始结果可拉"；
> 3. `truncate.output()` 可以对带 `mcp_result_id` 的调用**更激进地截断**（甚至只留摘要），因为完整内容有接口兜底——这是可选的后续优化。

#### 8. 客户端适配（可选，非阻塞）

- **Web (`packages/app`)**：`event-reducer.ts:219` 处理 `message.part.updated` 时，若 part 是 tool 且 `state.mcp_result_id` 存在，在 UI 上展示"查看原始结果"按钮，点击调 `GET /mcp/result/:id`。
- **TUI**：同理，在 tool part 渲染处加查看原始结果的入口。
- **SDK (`packages/sdk`)**：在生成的 SDK 里自动有 `mcp.result()` 方法（OpenAPI 重新生成即可，命令 `./packages/sdk/js/script/build.ts`）。

#### 9. 测试

- `packages/opencode/test/mcp/result-store.test.ts`：测 SQLite 纯文本写入/读取、LRU blob 淘汰、TTL 过期、大 blob 落盘、并发 `put/get`。
- `packages/opencode/test/server/httpapi-mcp.test.ts`：测 `GET /mcp/result/:id` 200（纯文本/SQLite 和 blob/LRU 两种路径）和 404。
- `packages/opencode/test/server/httpapi-bridge.test.ts`：加 `mcp.result` 的 content-type 断言。
- migration 测试：验证 `mcp_result` 表创建成功、`ON DELETE CASCADE` 随 part 删除自动清理。
- 集成：在现有 tool 调用 e2e 里断言 `ToolPart.state.mcp_result_id` 非空，且 `GET /mcp/result/:id` 返回的 `content` 与原始 `result.content` 深相等。

### 兼容性与风险

- **Schema 兼容**：`ToolStateCompleted` 加可选字段，旧 part 读取不受影响；`PartTable.data` 是 JSON 列，无需 migration；`mcp_result` 是新表，需 `bun run db generate` 生成迁移。
- **性能**：纯文本写 SQLite 走事务内 `insert`，开销小；含 blob 走内存 LRU（大结果落盘），不阻塞 `completeToolCall` 主路径；`get` 是按需 HTTP，不影响 SSE。
- **安全**：`GET /mcp/result/:id` 走 `Authorization` 中间件，与 `/mcp/*` 同组；ID 用 `crypto.randomUUID()`，不可枚举。
- **持久性**：纯文本结果持久化，重启后可回溯；blob 结果有 TTL，适合一次性消费场景。
- **Workspace 同步**：远程 workspace 的 SSE 事件 replay 时，`mcp_result_id` 会随 part 传到本地。纯文本结果因在 SQLite 中，跨实例同步依赖 DB 自身同步机制（需感知 `part_id` 归属）；blob 结果只存在源实例内存，跨 workspace 拉取需走源 workspace HTTP（已有 `target.url` + `target.headers` 可复用）。阶段 1 只支持同实例拉取。

### 阶段划分

- **阶段 1（最小可用）**：步骤 1-6 + 9，同实例内 `GET /mcp/result/:id` 可用，`ToolStateCompleted.mcp_result_id` 下发。
- **阶段 2**：客户端 UI 适配（步骤 8）、跨 workspace 拉取、`truncate.output()` 对带 ID 的调用加激进截断策略。
