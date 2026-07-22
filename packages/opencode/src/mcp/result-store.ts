import { Effect, Layer, Context } from "effect"
import { Database } from "@/storage/db"
import { McpResultTable, McpResultID } from "./mcp-result.sql"
import { eq } from "drizzle-orm"

interface StoredMcpBlobResult {
  id: McpResultID
  partID: string
  sessionID: string
  serverName: string
  toolName: string
  content: unknown[]
  metadata?: Record<string, unknown>
  createdAt: number
}

function isBlobContent(content: unknown[]): boolean {
  return content.some((item) => {
    if (typeof item !== "object" || item === null) return false
    const obj = item as Record<string, unknown>
    if (obj.type === "image") return true
    if (obj.type === "resource") {
      const resource = obj.resource as Record<string, unknown> | undefined
      return resource?.blob != null
    }
    return false
  })
}

const LRU_MAX = 256
const LRU_TTL_MS = 60 * 60 * 1000

export interface Interface {
  readonly put: (input: {
    partID: string
    sessionID: string
    serverName: string
    toolName: string
    content: unknown[]
    metadata?: Record<string, unknown>
  }) => Effect.Effect<McpResultID>
  readonly get: (id: McpResultID) => Effect.Effect<
    | {
        id: McpResultID
        partID: string
        sessionID: string
        serverName: string
        toolName: string
        content: unknown[]
        metadata?: Record<string, unknown>
        createdAt: number
      }
    | undefined
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpResultStore") {}

const blobStore = new Map<McpResultID, StoredMcpBlobResult>()

setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of blobStore) {
    if (now - entry.createdAt > LRU_TTL_MS) blobStore.delete(id)
  }
  if (blobStore.size > LRU_MAX) {
    const sorted = [...blobStore.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    for (let i = 0; i < sorted.length - LRU_MAX; i++) blobStore.delete(sorted[i][0])
  }
}, 60_000)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const put: Interface["put"] = Effect.fn("McpResultStore.put")(function* (input) {
      const id = McpResultID.descending()

      if (isBlobContent(input.content)) {
        blobStore.set(id, {
          id,
          partID: input.partID,
          sessionID: input.sessionID,
          serverName: input.serverName,
          toolName: input.toolName,
          content: input.content,
          metadata: input.metadata,
          createdAt: Date.now(),
        })
      } else {
        Database.use((db) =>
          db
            .insert(McpResultTable)
            .values({
              id: id as string,
              part_id: input.partID,
              session_id: input.sessionID,
              server_name: input.serverName,
              tool_name: input.toolName,
              content: input.content,
              metadata: input.metadata ?? null,
              created_at: Date.now(),
            } as any)
            .run(),
        )
      }

      return id
    })

    const get: Interface["get"] = Effect.fn("McpResultStore.get")(function* (id) {
      const blob = blobStore.get(id)
      if (blob) return blob

      const row = Database.use((db) => db.select().from(McpResultTable).where(eq(McpResultTable.id, id)).get())
      if (!row) return undefined

      return {
        id: row.id as McpResultID,
        partID: row.part_id,
        sessionID: row.session_id,
        serverName: row.server_name,
        toolName: row.tool_name,
        content: row.content,
        metadata: row.metadata ?? undefined,
        createdAt: row.created_at,
      }
    })

    return Service.of({ put, get })
  }),
)

export const defaultLayer = layer

export * as McpResultStore from "./result-store"
