/**
 * Session cache cleanup — ported from packages/app/src/context/global-sync/session-cache.ts
 */

import type { DirectoryState, Message, Part, PermissionRequest, QuestionRequest, SessionStatus, SnapshotFileDiff, Todo } from "./types"

type SessionCache = Pick<
  DirectoryState,
  "session_status" | "session_diff" | "todo" | "message" | "part" | "permission" | "question"
>

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>): void {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  if (stale.size === 0) return

  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has((part as any).sessionID ?? ""))) continue
    delete store.part[key]
  }

  for (const sessionID of stale) {
    delete store.message[sessionID]
    delete store.todo[sessionID]
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
  }
}
