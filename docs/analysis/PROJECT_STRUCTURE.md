# OpenCode 项目代码结构解析

## 1. 项目概览

OpenCode 是一个 AI 驱动的开发工具，采用 **Bun workspace monorepo** 架构，使用 Turborepo 管理构建。支持 CLI、Web、Desktop 三种使用模式。

- **版本**: 1.14.29
- **包管理器**: bun@1.3.13
- **构建工具**: Turborepo + Vite
- **运行时**: Bun (主要) / Node.js (备用)
- **许可**: MIT

## 2. 顶层目录结构

```
opencode/
├── packages/
│   ├── opencode/          # 核心：CLI + 后端服务器（Hono + Effect）
│   ├── app/               # 前端：SolidJS Web UI（Vite + TailwindCSS）
│   ├── core/              # 共享核心库
│   ├── sdk/               # SDK 包
│   │   └── js/            # JavaScript/TypeScript SDK（基于 OpenAPI 生成）
│   ├── ui/                # 共享 UI 组件库（基于 Kobalte）
│   ├── console/           # Console 子包
│   ├── slack/             # Slack 集成
│   ├── desktop/           # Desktop 相关
│   ├── desktop-electron/  # Electron 桌面应用
│   ├── docs/              # 文档
│   ├── enterprise/        # 企业版
│   ├── extensions/        # 扩展
│   ├── function/          # 函数
│   ├── identity/          # 身份认证
│   ├── plugin/            # 插件
│   ├── script/            # 脚本
│   ├── storybook/         # Storybook 组件文档
│   ├── containers/        # 容器配置
│   └── web/               # Web 相关
├── turbo.json             # Turborepo 配置
├── tsconfig.json          # TypeScript 配置（extends @tsconfig/bun）
└── package.json           # 根 monorepo 配置
```

## 3. 核心包：packages/opencode

### 3.1 目录结构

```
packages/opencode/
├── bin/
│   └── opencode           # CLI 入口脚本（解析平台特定二进制）
├── src/
│   ├── index.ts           # 主入口（yargs CLI 注册）
│   ├── cli/
│   │   ├── cmd/
│   │   │   ├── run.ts     # opencode run [message..] 命令
│   │   │   ├── serve.ts   # opencode serve 命令（启动无头服务器）
│   │   │   ├── web.ts     # opencode web 命令
│   │   │   └── mcp.ts     # opencode mcp 命令
│   │   └── network.ts     # 网络选项（port/hostname/mdns/cors）
│   ├── server/
│   │   ├── server.ts      # Hono 应用创建与监听
│   │   ├── adapter.ts     # Runtime/Adapter 接口定义
│   │   ├── adapter.bun.ts # Bun 适配器（Bun.serve + createBunWebSocket）
│   │   ├── adapter.node.ts# Node 适配器（@hono/node-server + @hono/node-ws）
│   │   ├── middleware/     # 中间件（Auth/Logger/Compression/CORS/Error）
│   │   ├── fence.ts       # 同步序列号追踪（x-opencode-sync 响应头）
│   │   ├── projectors.ts  # 事件投影器初始化
│   │   ├── mdns.ts        # mDNS 服务发现
│   │   ├── workspace.ts   # 工作空间路由中间件
│   │   └── routes/
│   │       ├── global.ts  # /global 路由（health/event/config/dispose/upgrade）
│   │       ├── control.ts # 控制面路由
│   │       ├── ui.ts      # UI 静态文件路由
│   │       └── instance/
│   │           ├── index.ts    # 实例路由挂载
│   │           ├── event.ts    # /event 实例级 SSE 端点
│   │           ├── session/    # 会话相关路由
│   │           ├── permission/ # 权限相关路由
│   │           ├── mcp/        # MCP 路由
│   │           └── ...         # 其他实例级路由
│   ├── bus/
│   │   ├── index.ts       # Bus 服务（Effect PubSub，实例级事件总线）
│   │   ├── global.ts      # GlobalBus（Node.js EventEmitter，全局事件总线）
│   │   └── bus-event.ts   # 事件定义注册表（define/payloads）
│   ├── sync/
│   │   └── index.ts       # 事件溯源（版本化定义、聚合、投影器）
│   ├── storage/           # SQLite 存储（Bun/Node 双实现）
│   ├── pty/               # 伪终端（Bun/Node 双实现）
│   ├── config/            # 配置管理
│   ├── project/           # 项目/实例管理
│   ├── effect/            # Effect 运行时和工具
│   ├── util/              # 工具函数（AsyncQueue、lazy 等）
│   └── ...                # 其他模块
└── package.json           # 包配置（含 import maps 条件导入）
```

### 3.2 Import Maps（运行时切换）

`package.json` 中的 `imports` 字段实现 Bun/Node 双运行时支持：

```json
{
  "#db":   { "bun": "./src/storage/db.bun.ts",   "node": "./src/storage/db.node.ts" },
  "#pty":  { "bun": "./src/pty/pty.bun.ts",      "node": "./src/pty/pty.node.ts" },
  "#hono": { "bun": "./src/server/adapter.bun.ts", "node": "./src/server/adapter.node.ts" }
}
```

### 3.3 服务器架构

Hono 应用中间件链：

```
ErrorMiddleware → AuthMiddleware → LoggerMiddleware → CompressionMiddleware → CorsMiddleware
```

路由挂载：

```
/global     → GlobalRoutes()   （health, event, config, dispose, upgrade）
/           → ControlPlaneRoutes() → WorkspaceRoutes() → InstanceRoutes() → UIRoutes()
```

## 4. 前端包：packages/app

### 4.1 技术栈

- **框架**: SolidJS
- **构建**: Vite
- **样式**: TailwindCSS 4
- **状态管理**: TanStack Query + SolidJS Stores
- **UI 组件**: Kobalte
- **路由**: @solidjs/router

### 4.2 目录结构

```
packages/app/
├── src/
│   ├── entry.tsx          # 入口：PlatformProvider → AppBaseProviders → AppInterface
│   ├── app.tsx            # 应用提供者层级
│   └── context/
│       ├── server.tsx     # 服务器连接管理（Http/Sidecar/SSH）
│       ├── global-sdk.tsx # SSE 事件流订阅 + 事件合并
│       └── global-sync.tsx# 事件应用到 SolidJS Stores
```

### 4.3 Provider 层级

```
PlatformProvider
  → ServerProvider          （服务器连接管理）
    → ConnectionGate        （健康检查门控）
      → QueryProvider       （TanStack Query）
        → GlobalSDKProvider （SDK 客户端 + SSE 事件监听）
          → GlobalSyncProvider（事件应用到 Store）
            → Router        （SolidJS Router）
```

### 4.4 路由

```
/                        → HomeRoute
/:dir                    → DirectoryLayout
/:dir/session/:id?       → SessionRoute（含 Terminal/File/Prompt/Comments Provider）
```

## 5. `/global/event` SSE 事件流详解

### 5.1 整体数据流

```
后端代码调用 Bus.publish() / SyncEvent.run()
  → Bus 写入 Effect PubSub（实例级）
  → Bus 发布到 GlobalBus（Node.js EventEmitter，全局级）
    → /global/event SSE handler 订阅 GlobalBus
      → 通过 AsyncQueue 缓冲
        → streamSSE 写入 SSE 响应
          → 前端 eventSdk.global.event() 获取 SSE 流
            → 16ms 动画帧合并 + 去重
              → createGlobalEmitter 分发
                → GlobalSyncProvider 应用到 SolidJS Stores
```

### 5.2 后端：`/global/event` 端点

**文件**: `packages/opencode/src/server/routes/global.ts:97-138`

```typescript
// GET /global/event
async (c) => {
  c.header("Cache-Control", "no-cache, no-transform")
  c.header("X-Accel-Buffering", "no")
  c.header("X-Content-Type-Options", "nosniff")

  return streamEvents(c, (q) => {
    async function handler(event: any) {
      q.push(JSON.stringify(event))
    }
    GlobalBus.on("event", handler)
    return () => GlobalBus.off("event", handler)
  })
}
```

**streamEvents 辅助函数** (`global.ts:23-71`):

1. 创建 `AsyncQueue<string | null>` 作为事件缓冲
2. 推入初始 `server.connected` 事件
3. 每 10 秒推入 `server.heartbeat` 心跳
4. 注册 GlobalBus "event" 回调，将事件 JSON 序列化后推入队列
5. SSE 流通过 `for await` 消费队列，调用 `stream.writeSSE({ data })`
6. 连接中断时清理：清除心跳定时器、取消订阅、推入 null 终止队列

### 5.3 实例级事件端点（对比）

**文件**: `packages/opencode/src/server/routes/instance/event.ts`

与 `/global/event` 的区别：
- 订阅 `Bus.subscribeAll()`（实例级 Effect PubSub）而非 `GlobalBus`
- 收到 `InstanceDisposed` 事件时主动停止
- 事件格式不包含 directory/project/workspace 包装

### 5.4 事件总线架构

**Bus** (`packages/opencode/src/bus/index.ts`):
- 基于 Effect PubSub
- `publish()`: 写入 typed PubSub + wildcard PubSub，然后 emit 到 GlobalBus
- `subscribeAll()`: 从 wildcard PubSub 读取
- 包含 `InstanceState` 管理（每个目录独立的 PubSub 实例）

**GlobalBus** (`packages/opencode/src/bus/global.ts`):
- Node.js EventEmitter
- 跨实例全局事件广播
- 事件类型: `GlobalEvent = { directory?, project?, workspace?, payload }`

### 5.5 AsyncQueue 缓冲

**文件**: `packages/opencode/src/util/queue.ts`

```typescript
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}
```

### 5.6 前端：事件流处理

**文件**: `packages/app/src/context/global-sdk.tsx`

核心机制：

1. **SSE 连接**: 调用 `eventSdk.global.event()` 请求 `/global/event`
2. **事件合并 (Coalescing)**:
   - 16ms 动画帧内的事件批量处理
   - 按 key 去重：`session.status`、`lsp.updated`、`message.part.updated`
   - `message.part.delta` 事件：若对应 part 已有 `message.part.updated`，则标记为 stale 并跳过
3. **心跳超时**: 15 秒无事件则中断连接
4. **自动重连**: 中断后 250ms 延迟重连
5. **可见性变更**: 页面重新可见时，若心跳已过期则中断连接触发重连
6. **事件分发**: 通过 `createGlobalEmitter` 按 directory 分发事件

### 5.7 前端：事件应用

**文件**: `packages/app/src/context/global-sync.tsx`

- `applyGlobalEvent()`: 处理全局事件
- `applyDirectoryEvent()`: 处理每个目录的事件
- 管理每个目录的子 Store（session 加载、VCS 缓存等）

### 5.8 Sync/Fence 机制

**SyncEvent** (`packages/opencode/src/sync/index.ts`):
- 事件溯源：版本化定义、聚合、投影器
- `run()` 处理事件：在 SQLite 事务中应用投影器，然后发布到 Bus 和 GlobalBus
- 跨实例传播：GlobalBus 发射 `{ type: "sync" }` 包装事件

**Fence** (`packages/opencode/src/server/fence.ts`):
- 追踪变更前后的聚合序列号
- 设置 `x-opencode-sync` 响应头，客户端可知哪些聚合发生了变化

## 6. SDK 包：packages/sdk/js

- 基于 `@hey-api/openapi-ts` 从 OpenAPI spec 生成客户端代码
- 导出路径: `./client`, `./server`, `./v2/client`, `./v2/server`, `./v2/gen/client`
- 前端通过此 SDK 与后端 HTTP API 交互

## 7. 关键技术依赖

| 类别 | 技术 |
|------|------|
| 后端框架 | Hono |
| 函数式框架 | Effect (4.0.0-beta) |
| 数据库 | SQLite (Drizzle ORM) |
| AI SDK | Vercel AI SDK (@ai-sdk/*) |
| 前端框架 | SolidJS 1.9 |
| 构建工具 | Vite 7, Turborepo |
| 样式 | TailwindCSS 4 |
| UI 组件 | Kobalte |
| 状态管理 | TanStack Query, SolidJS Stores |
| Schema | Effect Schema + Zod |
| 终端 | ghostty-web, @lydell/node-pty |

---

## 补充分析文档索引

| 主题 | 文件路径 |
|------|---------|
| 本地调试指南 | [LOCAL_DEBUG_GUIDE.md](LOCAL_DEBUG_GUIDE.md) |
| SSE 事件连接与前端事件处理 | [SSE_EVENT_ANALYSIS.md](SSE_EVENT_ANALYSIS.md) |
| SSE 事件路由机制（Global vs Directory 分流） | [SSE_EVENT_ROUTING.md](SSE_EVENT_ROUTING.md) |
| Event Reducer 事件处理详解 | [EVENT_REDUCER_ANALYSIS.md](EVENT_REDUCER_ANALYSIS.md) |
| 消息获取与事件合并 | [MESSAGE_FETCHING_AND_MERGING.md](MESSAGE_FETCHING_AND_MERGING.md) |
