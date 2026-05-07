/**
 * Bootstrap service — loads initial data via REST API when connecting
 * to an opencode directory.
 *
 * Ported from packages/app/src/context/global-sync/bootstrap.ts
 * Simplified for the SSE viewer: we only bootstrap the data needed
 * for the message timeline view.
 */

import { action } from "mobx"
import { DirectoryStore } from "../stores/directory-store"
import { ChildStoreManager } from "./child-store-manager"
import type { Session, SessionStatus, Message, Part, PermissionRequest, QuestionRequest } from "../utils/types"

const RETRY_COUNT = 2
const RETRY_DELAY_MS = 500

async function fetchJSON<T>(url: string, retries = RETRY_COUNT): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
          continue
        }
        throw new Error(`HTTP ${res.status}: ${url}`)
      }
      return (await res.json()) as T
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
    }
  }
  throw new Error("unreachable")
}

/**
 * Group an array by a key extracted from each item.
 */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) {
    const key = keyFn(item)
    if (!key) continue
    if (!result[key]) result[key] = []
    result[key].push(item)
  }
  return result
}

export interface ProjectEntry {
  id: string
  worktree?: string
  sandboxes?: string[]
  [key: string]: unknown
}

/**
 * Bootstrap global state — fetch the project list from /project.
 * Returns the list of projects so directories can be discovered immediately.
 */
export const bootstrapGlobal = action("bootstrapGlobal", async (): Promise<ProjectEntry[]> => {
  try {
    const projects = await fetchJSON<ProjectEntry[]>("/project")
    return (projects ?? []).filter((p) => p.id).sort((a, b) => a.id.localeCompare(b.id))
  } catch (err) {
    console.error("[bootstrap] Failed to fetch project list:", err)
    return []
  }
})

/**
 * Bootstrap directories from the project list.
 * For each project's worktree, ensure a child store exists and bootstrap it.
 */
export const bootstrapDirectoriesFromProjects = action("bootstrapDirectoriesFromProjects", async (
  projects: ProjectEntry[],
  childStores: ChildStoreManager,
): Promise<void> => {
  const dirs = new Set<string>()
  for (const project of projects) {
    if (project.worktree) dirs.add(project.worktree)
    if (project.sandboxes) {
      for (const sandbox of project.sandboxes) {
        if (sandbox) dirs.add(sandbox)
      }
    }
  }

  // Bootstrap each directory found from projects
  for (const dir of dirs) {
    const store = childStores.ensure(dir)
    if (store.status === "loading") {
      bootstrapDirectory(dir, store)
    }
  }
})

/**
 * Bootstrap a directory store by fetching initial data from the REST API.
 *
 * This is called:
 * 1. When a directory is first seen via SSE events
 * 2. When the user selects a directory
 * 3. When reconnecting after a `server.connected` event
 */
export const bootstrapDirectory = action("bootstrapDirectory", async (
  directory: string,
  store: DirectoryStore,
  force = false,
) => {
  if (!force && store.status === "complete") return
  if (force || store.status === "loading") {
    store.setStatus("loading")
  }

  try {
    // The server's instance middleware resolves directory from
    // ?directory= query param or x-opencode-directory header (NOT URL path).
    const dir = encodeURIComponent(directory)

    // Fetch sessions and status in parallel
    const [sessions, statusMap] = await Promise.allSettled([
      fetchJSON<Session[]>(`/session?limit=50&directory=${dir}`),
      fetchJSON<Record<string, SessionStatus>>(`/session/status?directory=${dir}`),
    ])

    if (sessions.status === "fulfilled") {
      store.setSessions(sessions.value)
      store.sessionTotal = sessions.value.filter((s) => !s.parentID).length
    }

    if (statusMap.status === "fulfilled") {
      for (const [sessionID, status] of Object.entries(statusMap.value)) {
        store.setSessionStatus(sessionID, status)
      }
    }

    // Fetch permissions and questions in parallel
    const [permissions, questions] = await Promise.allSettled([
      fetchJSON<PermissionRequest[]>(`/permission?directory=${dir}`),
      fetchJSON<QuestionRequest[]>(`/question?directory=${dir}`),
    ])

    if (permissions.status === "fulfilled") {
      const grouped = groupBy(permissions.value, (p) => p.sessionID)
      for (const [sessionID, perms] of Object.entries(grouped)) {
        for (const perm of perms) {
          store.upsertPermission(sessionID, perm)
        }
      }
    }

    if (questions.status === "fulfilled") {
      const grouped = groupBy(questions.value, (q) => q.sessionID)
      for (const [sessionID, qs] of Object.entries(grouped)) {
        for (const q of qs) {
          store.upsertQuestion(sessionID, q)
        }
      }
    }

    store.setStatus("complete")
  } catch (err) {
    console.error("[bootstrap] Failed for directory:", directory, err)
    store.setStatus("partial")
  }
})

/**
 * Load messages for a specific session via REST API.
 * Called when the user selects a session to view.
 */
export const loadSessionMessages = action("loadSessionMessages", async (
  directory: string,
  store: DirectoryStore,
  sessionID: string,
) => {
  // Skip if we already have messages for this session
  if (store.message[sessionID]?.length) return

  try {
    const dir = encodeURIComponent(directory)
    const data = await fetchJSON<Array<{ info: Message; parts: Part[] }>>(
      `/session/${sessionID}/message?directory=${dir}`,
    )

    for (const item of data) {
      // Store the message
      store.upsertMessage(sessionID, item.info)
      // Store the parts
      if (item.parts?.length) {
        for (const part of item.parts) {
          store.upsertPart(item.info.id, part)
        }
      }
    }
  } catch (err) {
    console.error("[bootstrap] Failed to load messages for session:", sessionID, err)
  }
})
