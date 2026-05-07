/**
 * Message cleaning — ported from packages/app/src/utils/diffs.ts
 *
 * Sanitizes user message `summary` fields to ensure well-formed data
 * from the backend is normalized before storing.
 */

import type { Message, SnapshotFileDiff } from "./types"

interface DiffLike {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

function isDiff(value: unknown): value is DiffLike {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.file === "string" &&
    typeof obj.patch === "string" &&
    typeof obj.additions === "number" &&
    typeof obj.deletions === "number"
  )
}

/**
 * Filters an arbitrary value to extract only valid Diff objects.
 * Handles arrays, single objects, or objects whose values are diffs.
 */
export function diffs(value: unknown): DiffLike[] {
  if (Array.isArray(value)) {
    return value.filter(isDiff)
  }
  if (isDiff(value)) {
    return [value]
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).filter(isDiff)
  }
  return []
}

/**
 * Cleans a Message — normalizes user message `summary` fields.
 * For non-user messages, returns the message unchanged.
 * For user messages with invalid/malformed summaries, strips or fixes them.
 */
export function cleanMessage(value: Message): Message {
  if (value.role !== "user") return value

  const raw = (value as any).summary as unknown
  if (raw === undefined) return value

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const { summary: _, ...rest } = value as any
    return rest
  }

  const obj = raw as Record<string, unknown>
  const title = typeof obj.title === "string" ? obj.title : undefined
  const body = typeof obj.body === "string" ? obj.body : undefined
  const filteredDiffs = diffs(obj.diffs)

  if (title === obj.title && body === obj.body && filteredDiffs === obj.diffs) {
    return value
  }

  const summary: { title?: string; body?: string; diffs?: DiffLike[] } = {}
  if (title !== undefined) summary.title = title
  if (body !== undefined) summary.body = body
  if (filteredDiffs.length > 0) summary.diffs = filteredDiffs

  return { ...value, summary }
}
