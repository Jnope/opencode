/**
 * DirectoryStore — MobX equivalent of the SolidJS child store from child-store.ts
 *
 * Each directory (workspace) gets its own DirectoryStore instance with
 * observable state matching the original State type from types.ts.
 */

import { makeAutoObservable, observable, action } from "mobx"
import type {
  DirectoryState,
  Session,
  SessionStatus,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  SnapshotFileDiff,
  Todo,
  VcsInfo,
} from "../utils/types"

export class DirectoryStore implements DirectoryState {
  status: "loading" | "partial" | "complete" = "loading"
  session: Session[] = []
  sessionTotal = 0
  session_status: Record<string, SessionStatus> = {}
  session_diff: Record<string, SnapshotFileDiff[]> = {}
  todo: Record<string, Todo[]> = {}
  permission: Record<string, PermissionRequest[]> = {}
  question: Record<string, QuestionRequest[]> = {}
  message: Record<string, Message[]> = {}
  part: Record<string, Part[]> = {}
  vcs: VcsInfo | undefined = undefined
  limit = 5

  lastAccessAt = Date.now()

  constructor() {
    makeAutoObservable(this, {
      session: observable.shallow,
      message: observable.shallow,
      part: observable.shallow,
      permission: observable.shallow,
      question: observable.shallow,
      session_diff: observable.shallow,
      session_status: observable.shallow,
      todo: observable.shallow,
    })
  }

  @action
  markAccessed() {
    this.lastAccessAt = Date.now()
  }

  @action
  setStatus(status: "loading" | "partial" | "complete") {
    this.status = status
  }

  // ─── Session operations ────────────────────────────────────

  @action
  upsertSession(info: Session) {
    const idx = this.session.findIndex((s) => s.id === info.id)
    if (idx >= 0) {
      this.session[idx] = info
    } else {
      this.session.splice(idx, 0, info)
    }
  }

  @action
  removeSession(sessionID: string) {
    const idx = this.session.findIndex((s) => s.id === sessionID)
    if (idx >= 0) {
      this.session.splice(idx, 1)
    }
  }

  @action
  setSessions(sessions: Session[]) {
    this.session = sessions
  }

  // ─── Message operations ────────────────────────────────────

  @action
  upsertMessage(sessionID: string, info: Message) {
    if (!this.message[sessionID]) {
      this.message[sessionID] = [info]
      return
    }
    const msgs = this.message[sessionID]
    const idx = msgs.findIndex((m) => m.id === info.id)
    if (idx >= 0) {
      msgs[idx] = info
    } else {
      // Binary insert to keep sorted
      let insertIdx = msgs.length
      for (let i = 0; i < msgs.length; i++) {
        if (info.id < msgs[i].id) {
          insertIdx = i
          break
        }
      }
      msgs.splice(insertIdx, 0, info)
    }
  }

  @action
  removeMessage(sessionID: string, messageID: string) {
    const msgs = this.message[sessionID]
    if (!msgs) return
    const idx = msgs.findIndex((m) => m.id === messageID)
    if (idx >= 0) {
      msgs.splice(idx, 1)
    }
    delete this.part[messageID]
  }

  // ─── Part operations ───────────────────────────────────────

  @action
  upsertPart(messageID: string, part: Part) {
    if (!this.part[messageID]) {
      this.part[messageID] = [part]
      return
    }
    const parts = this.part[messageID]
    const idx = parts.findIndex((p) => p.id === part.id)
    if (idx >= 0) {
      parts[idx] = part
    } else {
      let insertIdx = parts.length
      for (let i = 0; i < parts.length; i++) {
        if (part.id < parts[i].id) {
          insertIdx = i
          break
        }
      }
      parts.splice(insertIdx, 0, part)
    }
  }

  @action
  removePart(messageID: string, partID: string) {
    const parts = this.part[messageID]
    if (!parts) return
    const idx = parts.findIndex((p) => p.id === partID)
    if (idx >= 0) {
      parts.splice(idx, 1)
      if (parts.length === 0) {
        delete this.part[messageID]
      }
    }
  }

  @action
  appendPartDelta(messageID: string, partID: string, field: string, delta: string) {
    const parts = this.part[messageID]
    if (!parts) return
    const part = parts.find((p) => p.id === partID)
    if (!part) return
    const existing = (part as any)[field] as string | undefined
    ;(part as any)[field] = (existing ?? "") + delta
  }

  // ─── Status / Diff / Todo / Permission / Question ──────────

  @action
  setSessionStatus(sessionID: string, status: SessionStatus) {
    this.session_status[sessionID] = status
  }

  @action
  setSessionDiff(sessionID: string, diff: SnapshotFileDiff[]) {
    this.session_diff[sessionID] = diff
  }

  @action
  setSessionTodo(sessionID: string, todos: Todo[] | undefined) {
    if (todos === undefined) {
      delete this.todo[sessionID]
    } else {
      this.todo[sessionID] = todos
    }
  }

  @action
  upsertPermission(sessionID: string, permission: PermissionRequest) {
    if (!this.permission[sessionID]) {
      this.permission[sessionID] = [permission]
      return
    }
    const perms = this.permission[sessionID]
    const idx = perms.findIndex((p) => p.id === permission.id)
    if (idx >= 0) {
      perms[idx] = permission
    } else {
      perms.push(permission)
    }
  }

  @action
  removePermission(sessionID: string, requestID: string) {
    const perms = this.permission[sessionID]
    if (!perms) return
    const idx = perms.findIndex((p) => p.id === requestID)
    if (idx >= 0) {
      perms.splice(idx, 1)
    }
  }

  @action
  upsertQuestion(sessionID: string, question: QuestionRequest) {
    if (!this.question[sessionID]) {
      this.question[sessionID] = [question]
      return
    }
    const qs = this.question[sessionID]
    const idx = qs.findIndex((q) => q.id === question.id)
    if (idx >= 0) {
      qs[idx] = question
    } else {
      qs.push(question)
    }
  }

  @action
  removeQuestion(sessionID: string, requestID: string) {
    const qs = this.question[sessionID]
    if (!qs) return
    const idx = qs.findIndex((q) => q.id === requestID)
    if (idx >= 0) {
      qs.splice(idx, 1)
    }
  }

  @action
  setVcs(vcs: VcsInfo | undefined) {
    this.vcs = vcs
  }

  // ─── Cache cleanup ────────────────────────────────────────

  @action
  cleanupSessionCaches(sessionID: string) {
    if (!sessionID) return
    delete this.todo[sessionID]

    for (const key of Object.keys(this.part)) {
      const parts = this.part[key]
      if (parts?.some((part) => (part as any).sessionID === sessionID)) {
        delete this.part[key]
      }
    }

    delete this.message[sessionID]
    delete this.session_diff[sessionID]
    delete this.session_status[sessionID]
    delete this.permission[sessionID]
    delete this.question[sessionID]
  }

  @action
  cleanupDroppedSessionCaches(next: Session[]) {
    const keep = new Set(next.map((s) => s.id))
    const allKeys = new Set([
      ...Object.keys(this.message),
      ...Object.keys(this.session_diff),
      ...Object.keys(this.todo),
      ...Object.keys(this.permission),
      ...Object.keys(this.question),
      ...Object.keys(this.session_status),
      ...Object.values(this.part)
        .map((parts) => parts?.find((part) => !!(part as any).sessionID)?.sessionID as string | undefined)
        .filter((sessionID): sessionID is string => !!sessionID),
    ])
    const stale: string[] = []
    for (const id of allKeys) {
      if (!keep.has(id) && !stale.includes(id)) stale.push(id)
    }
    if (stale.length === 0) return
    for (const sessionID of stale) {
      this.cleanupSessionCaches(sessionID)
    }
  }
}
