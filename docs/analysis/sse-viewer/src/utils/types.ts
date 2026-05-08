/**
 * Type definitions ported from opencode SDK types.gen.ts
 * Simplified for the SSE viewer use case.
 */

// ─── Session ────────────────────────────────────────────────────

export interface Session {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: SnapshotFileDiff[]
  }
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

// ─── SessionStatus ──────────────────────────────────────────────

export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" }

// ─── Message ────────────────────────────────────────────────────

export type Message = UserMessage | AssistantMessage

export interface UserMessage {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  summary?: {
    title?: string
    body?: string
    diffs?: SnapshotFileDiff[]
  }
}

export interface AssistantMessage {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number }
  error?: unknown
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: { cwd: string; root: string }
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  finish?: string
}

// ─── Part ───────────────────────────────────────────────────────

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | CompactionPart
  | SubtaskPart
  | StepStartPart
  | StepFinishPart
  | PatchPart
  | FilePart
  | AgentPart

export interface TextPart {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  time?: { start: number; end?: number }
}

export interface ReasoningPart {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
  time: { start: number; end?: number }
}

export interface ToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}

export interface CompactionPart {
  id: string
  sessionID: string
  messageID: string
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export interface SubtaskPart {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
}

export interface StepStartPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
  snapshot?: string
}

export interface StepFinishPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
}

export interface PatchPart {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: string[]
}

export interface FilePart {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export interface AgentPart {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number }
}

export type FilePartSource =
  | { text: FilePartSourceText; type: "file"; path: string }
  | { text: FilePartSourceText; type: "symbol"; path: string; range: Range; name: string; kind: number }
  | { text: FilePartSourceText; type: "resource"; clientName: string; uri: string }

export interface FilePartSourceText {
  value: string
  start: number
  end: number
}

export interface Range {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export type ToolState =
  | { type: "pending"; input?: Record<string, unknown>; raw?: string }
  | { type: "running"; input?: Record<string, unknown> }
  | { type: "completed"; output?: string; input?: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { type: "error"; error?: string; input?: Record<string, unknown>; metadata?: Record<string, unknown> }

// ─── Permission ─────────────────────────────────────────────────

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
}

// ─── Question ───────────────────────────────────────────────────

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: { messageID: string; callID: string }
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionOption {
  label: string
  description?: string
}

// ─── VCS ────────────────────────────────────────────────────────

export interface VcsInfo {
  branch?: string
  dirty?: boolean
}

// ─── Diff / Todo ────────────────────────────────────────────────

export interface SnapshotFileDiff {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export interface Todo {
  content: string
  status: string
  priority: string
}

// ─── SSE Event Envelope ────────────────────────────────────────

export interface GlobalEvent {
  directory?: string
  project?: string
  workspace?: string
  payload: EventPayload
}

export interface EventPayload {
  type: string
  properties?: unknown
}

// ─── Directory Store State ──────────────────────────────────────

export interface DirectoryState {
  status: "loading" | "partial" | "complete"
  session: Session[]
  sessionTotal: number
  session_status: Record<string, SessionStatus>
  session_diff: Record<string, SnapshotFileDiff[]>
  todo: Record<string, Todo[]>
  permission: Record<string, PermissionRequest[]>
  question: Record<string, QuestionRequest[]>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  vcs: VcsInfo | undefined
  limit: number
}
