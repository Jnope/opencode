/**
 * Event Reducer — MobX equivalent of event-reducer.ts
 *
 * Ports applyGlobalEvent and applyDirectoryEvent from SolidJS store
 * mutations to MobX actions operating on DirectoryStore.
 */

import { action } from "mobx"
import type {
  EventPayload,
  Session,
  SessionStatus,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SnapshotFileDiff,
  Todo,
} from "../utils/types"
import { binarySearch } from "../utils/binary"
import { trimSessions } from "../utils/session-trim"
import { DirectoryStore } from "./directory-store"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])

// ─── Global Event Handler ──────────────────────────────────────

export interface GlobalEventInput {
  event: EventPayload
  projects: { id: string; [key: string]: unknown }[]
  onRefresh: () => void
}

export const applyGlobalEvent = action("applyGlobalEvent", (input: GlobalEventInput) => {
  const { event } = input

  if (event.type === "global.disposed" || event.type === "server.connected") {
    input.onRefresh()
    return
  }

  if (event.type === "project.updated") {
    const properties = event.properties as { id: string; [key: string]: unknown }
    const idx = input.projects.findIndex((p) => p.id === properties.id)
    if (idx >= 0) {
      input.projects[idx] = { ...input.projects[idx], ...properties }
    } else {
      input.projects.push(properties)
    }
  }
})

// ─── Directory Event Handler ───────────────────────────────────

export interface DirectoryEventInput {
  event: EventPayload
  store: DirectoryStore
  onRebootstrap: (directory: string) => void
  directory: string
}

export const applyDirectoryEvent = action("applyDirectoryEvent", (input: DirectoryEventInput) => {
  const { event, store } = input

  switch (event.type) {
    // ─── Instance disposed ─────────────────────────────────
    case "server.instance.disposed": {
      input.onRebootstrap(input.directory)
      return
    }

    // ─── Session events ────────────────────────────────────
    case "session.created": {
      const info = (event.properties as { info: Session }).info
      const idx = store.session.findIndex((s) => s.id === info.id)
      if (idx >= 0) {
        store.session[idx] = info
      } else {
        store.session.splice(idx, 0, info)
      }
      const trimmed = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      store.setSessions(trimmed)
      store.cleanupDroppedSessionCaches(trimmed)
      if (!info.parentID) store.sessionTotal++
      break
    }

    case "session.updated": {
      const info = (event.properties as { info: Session }).info
      if (info.time.archived) {
        store.removeSession(info.id)
        store.cleanupSessionCaches(info.id)
        if (!info.parentID) store.sessionTotal = Math.max(0, store.sessionTotal - 1)
        break
      }
      const idx = store.session.findIndex((s) => s.id === info.id)
      if (idx >= 0) {
        store.session[idx] = info
      } else {
        store.session.splice(idx, 0, info)
      }
      const trimmed = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      store.setSessions(trimmed)
      store.cleanupDroppedSessionCaches(trimmed)
      break
    }

    case "session.deleted": {
      const info = (event.properties as { info: Session }).info
      store.removeSession(info.id)
      store.cleanupSessionCaches(info.id)
      if (!info.parentID) store.sessionTotal = Math.max(0, store.sessionTotal - 1)
      break
    }

    case "session.diff": {
      const props = event.properties as { sessionID: string; diff: SnapshotFileDiff[] }
      store.setSessionDiff(props.sessionID, props.diff)
      break
    }

    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      store.setSessionTodo(props.sessionID, props.todos)
      break
    }

    case "session.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      store.setSessionStatus(props.sessionID, props.status)
      break
    }

    // ─── Message events ───────────────────────────────────
    case "message.updated": {
      const info = (event.properties as { info: Message }).info
      store.upsertMessage(info.sessionID, info)
      break
    }

    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      store.removeMessage(props.sessionID, props.messageID)
      break
    }

    // ─── Part events ──────────────────────────────────────
    case "message.part.updated": {
      const part = (event.properties as { part: Part }).part
      if (SKIP_PARTS.has(part.type)) break
      store.upsertPart(part.messageID, part)
      break
    }

    case "message.part.removed": {
      const props = event.properties as { messageID: string; partID: string }
      store.removePart(props.messageID, props.partID)
      break
    }

    case "message.part.delta": {
      const props = event.properties as {
        messageID: string
        partID: string
        field: string
        delta: string
      }
      store.appendPartDelta(props.messageID, props.partID, props.field, props.delta)
      break
    }

    // ─── VCS ──────────────────────────────────────────────
    case "vcs.branch.updated": {
      const props = event.properties as { branch?: string }
      if (store.vcs?.branch !== props.branch) {
        store.setVcs({ ...store.vcs, branch: props.branch })
      }
      break
    }

    // ─── Permission events ────────────────────────────────
    case "permission.asked": {
      const permission = event.properties as PermissionRequest
      store.upsertPermission(permission.sessionID, permission)
      break
    }

    case "permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      store.removePermission(props.sessionID, props.requestID)
      break
    }

    // ─── Question events ──────────────────────────────────
    case "question.asked": {
      const question = event.properties as QuestionRequest
      store.upsertQuestion(question.sessionID, question)
      break
    }

    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      store.removeQuestion(props.sessionID, props.requestID)
      break
    }

    // ─── LSP (side-effect only in original, we just mark) ─
    case "lsp.updated": {
      // No-op in this viewer — original calls loadLsp()
      break
    }
  }
})
