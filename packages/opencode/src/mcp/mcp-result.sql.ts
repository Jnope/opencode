import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { PartTable, SessionTable } from "../session/session.sql"
import { Schema } from "effect"
import { zod, ZodOverride } from "@/util/effect-zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"
import type { PartID, SessionID } from "@/session/schema"

export const McpResultID = Schema.String.annotate({
  [ZodOverride]: Identifier.schema("mcp"),
}).pipe(
  Schema.brand("McpResultID"),
  withStatics((s) => ({
    descending: (id?: string) => s.make(Identifier.descending("mcp", id)),
    zod: zod(s),
  })),
)

export type McpResultID = Schema.Schema.Type<typeof McpResultID>

export const McpResultTable = sqliteTable(
  "mcp_result",
  {
    id: text().$type<McpResultID>().primaryKey(),
    part_id: text()
      .$type<PartID>()
      .notNull()
      .references(() => PartTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    server_name: text().notNull(),
    tool_name: text().notNull(),
    content: text({ mode: "json" }).notNull().$type<unknown[]>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    created_at: integer().notNull(),
  },
  (table) => [index("mcp_result_part_idx").on(table.part_id), index("mcp_result_session_idx").on(table.session_id)],
)
