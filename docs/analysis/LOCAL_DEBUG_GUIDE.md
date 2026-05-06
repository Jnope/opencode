# OpenCode 本地调试指南

## 1. 前置工具要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| **Bun** | >= 1.3.13 | 主要运行时和包管理器（packageManager 指定） |
| **Node.js** | >= 22 | 备用运行时（Node 适配器存在但 Bun 优先） |
| **Git** | 任意 | 版本控制 |
| **SQLite3** | 系统自带 | 数据库（通过 Drizzle ORM 使用） |

### 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# 验证
bun --version  # 需要 >= 1.3.13
```

## 2. 安装依赖

```bash
# 克隆仓库
git clone <repo-url> opencode
cd opencode

# 安装所有 workspace 依赖（Bun workspace 自动链接）
bun install
```

> 注意：`postinstall` 会自动运行 `bun run --cwd packages/opencode fix-node-pty` 修复 node-pty。

## 3. 调试模式

### 3.1 CLI 开发模式（TUI）

```bash
# 从项目根目录
bun run dev

# 等效于：
bun run --cwd packages/opencode --conditions=browser src/index.ts
```

这会启动 opencode 的终端 UI (TUI) 模式，可以直接在终端中使用。

### 3.2 Web 开发模式（前端 + 后端）

```bash
# 方式一：分别启动后端和前端

# 终端 1：启动后端服务器
cd packages/opencode
bun run dev serve --port 4096

# 终端 2：启动前端开发服务器（Vite HMR）
cd packages/app
bun run dev

# 方式二：使用根目录脚本启动前端开发
bun run dev:web
```

### 3.3 `opencode serve` 启动服务

```bash
# 基本启动（随机端口，绑定 127.0.0.1）
cd packages/opencode
bun run src/index.ts serve

# 指定端口
bun run src/index.ts serve --port 4096

# 指定主机名（允许外部访问）
bun run src/index.ts serve --hostname 0.0.0.0 --port 4096

# 设置密码（推荐）
OPENCODE_SERVER_PASSWORD=your_password bun run src/index.ts serve --port 4096

# 启用 mDNS 服务发现
bun run src/index.ts serve --mdns --mdns-domain opencode.local

# 配置 CORS
bun run src/index.ts serve --cors http://localhost:3000 --port 4096
```

启动后会输出：
```
opencode server listening on http://127.0.0.1:<port>
```

### 3.4 Desktop 开发模式（Tauri/Electron）

```bash
# Electron 桌面应用
bun run dev:desktop
```

## 4. 前端访问

启动 serve 后，可通过以下方式访问 Web UI：

1. **直接访问后端**: `http://127.0.0.1:<port>/`（后端内置静态文件服务，UIRoutes 提供前端资源）
2. **前端开发服务器**: `http://localhost:5173/`（Vite dev server，支持 HMR）

前端会自动连接后端的 `/global/event` SSE 端点获取实时事件。

## 5. 类型检查与构建

```bash
# 类型检查（全 monorepo）
bun run typecheck

# 代码检查
bun run lint

# 构建
bun run build

# 单独构建 opencode 包
cd packages/opencode
bun run build   # 执行 script/build.ts

# 单独构建前端
cd packages/app
bun run build   # Vite 构建
```

## 6. 测试

```bash
# opencode 包单元测试
cd packages/opencode
bun test --timeout 30000

# 前端单元测试
cd packages/app
bun run test:unit

# 前端 E2E 测试
cd packages/app
bun run test:e2e
```

## 7. 数据库操作

```bash
cd packages/opencode
bun run db  # 等效于 bun drizzle-kit（数据库迁移工具）
```

## 8. 常用调试技巧

### 8.1 查看事件流

```bash
# 使用 curl 订阅 /global/event SSE 流
curl -N http://127.0.0.1:4096/global/event
```

### 8.2 健康检查

```bash
curl http://127.0.0.1:4096/global/health
# 返回: {"healthy":true,"version":"1.14.29"}
```

### 8.3 环境变量

| 变量 | 说明 |
|------|------|
| `OPENCODE_SERVER_PASSWORD` | 服务器认证密码 |
| `OPENCODE_WORKSPACE_ID` | 指定工作空间 ID |
| `OPENCODE_EXPERIMENTAL_HTTPAPI` | 启用实验性 HTTP API |
| `OPENCODE_DISABLE_SHARE` | 禁用分享功能 |

### 8.4 Bun vs Node 运行时

项目通过 `package.json` 的 `imports` 字段（条件导入）在 Bun 和 Node 之间切换实现：
- `#db` → SQLite 驱动
- `#pty` → 伪终端实现
- `#hono` → HTTP 服务器适配器

开发时默认使用 Bun 运行时，构建产物可使用 Node 运行。

---

## 补充分析文档索引

| 主题 | 文件路径 |
|------|---------|
| 项目代码结构解析 | [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) |
| SSE 事件连接与前端事件处理 | [SSE_EVENT_ANALYSIS.md](SSE_EVENT_ANALYSIS.md) |
| SSE 事件路由机制（Global vs Directory 分流） | [SSE_EVENT_ROUTING.md](SSE_EVENT_ROUTING.md) |
| Event Reducer 事件处理详解 | [EVENT_REDUCER_ANALYSIS.md](EVENT_REDUCER_ANALYSIS.md) |
| 消息获取与事件合并 | [MESSAGE_FETCHING_AND_MERGING.md](MESSAGE_FETCHING_AND_MERGING.md) |
