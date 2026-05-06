/**
 * ChildStoreManager — MobX equivalent of createChildStoreManager from child-store.ts
 *
 * Manages per-directory DirectoryStore instances with LRU eviction:
 *   - Max 30 directories (MAX_DIR_STORES)
 *   - 20 min idle TTL (DIR_IDLE_TTL_MS)
 *   - Pin/unpin for active views
 */

import { makeAutoObservable, action, observable } from "mobx"
import { DirectoryStore } from "./directory-store"

const MAX_DIR_STORES = 30
const DIR_IDLE_TTL_MS = 20 * 60 * 1000

interface DirLifecycle {
  lastAccessAt: number
}

export class ChildStoreManager {
  children: Record<string, DirectoryStore> = {}
  private lifecycle = new Map<string, DirLifecycle>()
  private pins = new Map<string, number>()

  constructor() {
    makeAutoObservable(this, {
      children: observable.shallow,
    })
  }

  /** Get or create a DirectoryStore for the given directory */
  @action
  ensure(directory: string): DirectoryStore {
    if (!this.children[directory]) {
      this.children[directory] = new DirectoryStore()
    }
    this.mark(directory)
    this.runEviction()
    return this.children[directory]
  }

  /** Get an existing store without creating or marking access */
  peek(directory: string): DirectoryStore | undefined {
    return this.children[directory]
  }

  /** Pin a directory (prevents eviction while pinned) */
  @action
  pin(directory: string) {
    if (!directory) return
    this.pins.set(directory, (this.pins.get(directory) ?? 0) + 1)
    this.mark(directory)
  }

  /** Unpin a directory */
  @action
  unpin(directory: string) {
    if (!directory) return
    const next = (this.pins.get(directory) ?? 0) - 1
    if (next > 0) {
      this.pins.set(directory, next)
      return
    }
    this.pins.delete(directory)
    this.runEviction()
  }

  /** Check if a directory is pinned */
  isPinned(directory: string): boolean {
    return (this.pins.get(directory) ?? 0) > 0
  }

  /** Update last access time */
  @action
  mark(directory: string) {
    if (!directory) return
    this.lifecycle.set(directory, { lastAccessAt: Date.now() })
    const store = this.children[directory]
    if (store) store.markAccessed()
  }

  /** Dispose a directory store */
  @action
  disposeDirectory(directory: string): boolean {
    if (this.isPinned(directory)) return false
    this.lifecycle.delete(directory)
    delete this.children[directory]
    return true
  }

  /** Run LRU eviction */
  @action
  private runEviction(skip?: string) {
    const dirs = Object.keys(this.children)
    if (dirs.length <= MAX_DIR_STORES) return

    const toEvict = dirs
      .filter((d) => !this.isPinned(d) && d !== skip)
      .sort((a, b) => (this.lifecycle.get(a)?.lastAccessAt ?? 0) - (this.lifecycle.get(b)?.lastAccessAt ?? 0))

    const overflow = dirs.length - MAX_DIR_STORES
    const now = Date.now()

    let evicted = 0
    for (const dir of toEvict) {
      if (evicted >= overflow) break
      const lastAccess = this.lifecycle.get(dir)?.lastAccessAt ?? 0
      const idle = now - lastAccess >= DIR_IDLE_TTL_MS
      if (!idle && evicted >= overflow) continue
      this.disposeDirectory(dir)
      evicted++
    }
  }
}
