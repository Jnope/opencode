import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: "/home/transwarp/.local/share/opencode/opencode.db",
  },
})
