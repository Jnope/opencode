```bash
# node version >= 22.22
npm install -g bun@1.3.13

# install dependencies
bun install

# SQL migration
cd packages/opencode && bun run db generate --name mcp_result

# build
# 取消数据库分支：OPENCODE_CHANNEL=latest | beta | prod 或 OPENCODE_DISABLE_CHANNEL_DB=true
cd packages/opencode && npm run build
```
