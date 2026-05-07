/**
 * SSEConnection — connects to opencode /global/event via native EventSource
 *
 * Handles:
 *  - Automatic reconnection with exponential backoff
 *  - Heartbeat timeout (15s)
 *  - Page visibility change reconnection
 *  - Event routing by directory (global vs directory-specific)
 *  - 16ms coalescing with key-based deduplication (matching global-sdk.tsx)
 */

import { makeAutoObservable, action, observable } from "mobx"
import { applyGlobalEvent, applyDirectoryEvent } from "./event-reducer"
import { bootstrapDirectory, bootstrapGlobal, bootstrapDirectoriesFromProjects, type ProjectEntry } from "./bootstrap"
import type { GlobalEvent, Part } from "../utils/types"
import { ChildStoreManager } from "./child-store-manager"

const HEARTBEAT_TIMEOUT_MS = 15_000
const RECONNECT_DELAY_MS = 250
const FLUSH_FRAME_MS = 16
const COALESCE_KEYS: Record<string, (dir: string, props: any) => string> = {
  "session.status": (dir, p) => `session.status:${dir}:${p.sessionID}`,
  "lsp.updated": (dir) => `lsp.updated:${dir}`,
  "message.part.updated": (dir, p) => `message.part.updated:${dir}:${p.messageID}:${p.part?.id}`,
}

export class SSEConnection {
  es: EventSource | null = null
  connected = false
  error: string | null = null
  reconnectAttempt = 0
  lastEventAt = 0
  eventCount = 0

  /** Child store manager for directory-scoped state */
  childStores: ChildStoreManager

  /** Global projects list (populated by REST bootstrap + SSE events) */
  projects: ProjectEntry[] = []

  /** Whether global bootstrap (project list fetch) has completed */
  globalBootstrapped = false

  /** Base URL for the opencode server */
  private baseUrl: string

  /** Coalescing state */
  private queue: GlobalEvent[] = []
  private staleDeltas = new Set<string>() // keys of stale delta events
  private flushTimer: ReturnType<typeof requestAnimationFrame> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.childStores = new ChildStoreManager()
    makeAutoObservable(this, {
      es: observable.ref,
      projects: observable.shallow,
      childStores: observable.ref,
    })
  }

  // ─── Connection lifecycle ──────────────────────────────────

  @action
  connect() {
    this.disconnect()
    const url = `${this.baseUrl}/event`
    this.es = new EventSource(url)
    this.error = null

    this.es.onopen = () => {
      this.connected = true
      this.reconnectAttempt = 0
      this.startHeartbeat()
      // Run global bootstrap if not yet done, then bootstrap directories
      this.runGlobalBootstrap()
    }

    this.es.onmessage = (e) => {
      this.lastEventAt = Date.now()
      this.eventCount++
      try {
        const event: GlobalEvent = JSON.parse(e.data)
        this.enqueue(event)
      } catch {
        // ignore malformed data
      }
    }

    this.es.onerror = () => {
      this.connected = false
      this.scheduleReconnect()
    }
  }
  @action
  disconnect() {
    if (this.es) {
      this.es.close()
      this.es = null
    }
    this.connected = false
    this.stopHeartbeat()
    this.flushQueue()
  }

  private scheduleReconnect() {
    const delay = RECONNECT_DELAY_MS * Math.pow(2, Math.min(this.reconnectAttempt, 5))
    this.reconnectAttempt++
    setTimeout(() => {
      if (!this.connected) this.connect()
    }, delay)
  }

  // ─── Heartbeat ─────────────────────────────────────────────

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastEventAt > HEARTBEAT_TIMEOUT_MS) {
        this.connected = false
        this.disconnect()
        this.connect()
      }
    }, 5000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ─── Event coalescing (16ms double-buffering) ──────────────

  @action
  private enqueue(event: GlobalEvent) {
    // Discard "sync" type events (matching global-sdk.tsx behavior)
    if (event.payload.type === "sync") return

    const dir = event.directory ?? "global"

    // Check if this event should mark existing deltas as stale
    if (event.payload.type === "message.part.updated") {
      const props = event.payload.properties as { messageID: string; part: Part }
      const key = `message.part.delta:${dir}:${props.messageID}:${props.part?.id}`
      this.staleDeltas.add(key)
    }

    // Check dedup key
    const keyFn = COALESCE_KEYS[event.payload.type]
    const dedupKey = keyFn ? keyFn(dir, event.payload.properties) : null

    // Remove older events with same dedup key
    if (dedupKey) {
      this.queue = this.queue.filter((e) => {
        const eDir = e.directory ?? "global"
        const eKeyFn = COALESCE_KEYS[e.payload.type]
        return !eKeyFn || eKeyFn(eDir, e.payload.properties) !== dedupKey
      })
    }

    this.queue.push(event)

    if (!this.flushTimer) {
      this.flushTimer = requestAnimationFrame(() => this.flushQueue())
    }
  }

  @action
  private flushQueue() {
    this.flushTimer = null
    const events = this.queue
    this.queue = []

    for (const event of events) {
      const dir = event.directory ?? "global"

      // Skip stale deltas
      if (event.payload.type === "message.part.delta") {
        const props = event.payload.properties as {
          messageID: string
          partID: string
        }
        const staleKey = `message.part.delta:${dir}:${props.messageID}:${props.partID}`
        if (this.staleDeltas.has(staleKey)) {
          continue
        }
      }

      if (dir === "global") {
        applyGlobalEvent({
          event: event.payload,
          projects: this.projects,
          onRefresh: () => {
            // server.connected or global.disposed — force re-bootstrap
            this.globalBootstrapped = false
            this.runGlobalBootstrap()
          },
        })
      } else {
        const store = this.childStores.ensure(dir)
        applyDirectoryEvent({
          event: event.payload,
          store,
          onRebootstrap: (directory: string) => {
            bootstrapDirectory(directory, store, true)
          },
          directory: dir,
        })
      }
    }

    this.staleDeltas.clear()
  }

  // ─── Bootstrap helpers ─────────────────────────────────────

  /** Run global bootstrap: fetch project list, then bootstrap directories */
  @action
  private async runGlobalBootstrap() {
    if (!this.globalBootstrapped) {
      const projects = await bootstrapGlobal()
      this.projects = projects
      this.globalBootstrapped = true
      // Auto-discover directories from project list
      if (projects.length > 0) {
        bootstrapDirectoriesFromProjects(projects, this.childStores)
      }
    }
    // Always bootstrap existing directories that aren't complete
    this.bootstrapExistingDirectories()
  }

  @action
  private bootstrapExistingDirectories(force = false) {
    for (const [dir, store] of Object.entries(this.childStores.children)) {
      if (force || store.status !== "complete") {
        bootstrapDirectory(dir, store, force)
      }
    }
  }

  /** Bootstrap a directory when it's first seen */
  @action
  ensureAndBootstrap(dir: string) {
    const store = this.childStores.ensure(dir)
    if (store.status === "loading") {
      bootstrapDirectory(dir, store)
    }
    store.markAccessed()
    return store
  }

  // ─── Page visibility ───────────────────────────────────────

  setupVisibilityHandler() {
    const handler = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - this.lastEventAt > HEARTBEAT_TIMEOUT_MS) {
          this.disconnect()
          this.connect()
        }
      }
    }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }
}
