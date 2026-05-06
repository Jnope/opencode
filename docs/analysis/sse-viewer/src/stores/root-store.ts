/**
 * Root store — top-level MobX store holding SSEConnection and providing
 * computed views for the React UI.
 */

import { makeAutoObservable, computed, action, observable } from "mobx"
import { SSEConnection } from "./sse-connection"

export class RootStore {
  sse: SSEConnection
  selectedDirectory: string | null = null
  selectedSessionID: string | null = null

  constructor(baseUrl = "/global") {
    this.sse = new SSEConnection(baseUrl)
    makeAutoObservable(this, {
      sse: observable.ref,
    })
  }

  @computed
  get directories(): string[] {
    return Object.keys(this.sse.childStores.children)
  }

  @computed
  get currentDirStore() {
    if (!this.selectedDirectory) return null
    return this.sse.childStores.peek(this.selectedDirectory) ?? null
  }

  @computed
  get currentSessions() {
    return this.currentDirStore?.session ?? []
  }

  @computed
  get currentSessionMessages(): import("../utils/types").Message[] {
    const store = this.currentDirStore
    if (!store || !this.selectedSessionID) return []
    return store.message[this.selectedSessionID] ?? []
  }

  @computed
  get currentSessionStatus() {
    const store = this.currentDirStore
    if (!store || !this.selectedSessionID) return null
    return store.session_status[this.selectedSessionID] ?? null
  }

  @computed
  get currentSessionPermissions() {
    const store = this.currentDirStore
    if (!store || !this.selectedSessionID) return []
    return store.permission[this.selectedSessionID] ?? []
  }

  @computed
  get currentSessionQuestions() {
    const store = this.currentDirStore
    if (!store || !this.selectedSessionID) return []
    return store.question[this.selectedSessionID] ?? []
  }

  @action
  selectDirectory(dir: string | null) {
    this.selectedDirectory = dir
    this.selectedSessionID = null
    if (dir) {
      this.sse.childStores.pin(dir)
    }
  }

  @action
  selectSession(sessionID: string | null) {
    this.selectedSessionID = sessionID
  }

  connect() {
    this.sse.connect()
  }

  disconnect() {
    this.sse.disconnect()
  }
}
