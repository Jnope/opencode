import React from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"
import type { Message, Part, TextPart, ReasoningPart, ToolPart, CompactionPart, FilePart, AgentPart, AssistantMessage, SessionStatus, UserMessage } from "../utils/types"

// ─── Constants (matching source message-part.tsx) ─────────────

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite"])
/** Part types with registered PART_MAPPING in source — only these are rendered */
const RENDERABLE_TYPES = new Set(["text", "reasoning", "tool", "compaction"])

// ─── renderable() — source: message-part.tsx:573 ──────────────

function renderable(part: Part, showReasoningSummaries = true): boolean {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") {
      const status = (part as ToolPart).state?.type
      return status !== "pending" && status !== "running"
    }
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!(part as ReasoningPart).text?.trim()
  return RENDERABLE_TYPES.has(part.type)
}

// ─── groupParts() — source: message-part.tsx:525 ──────────────

interface PartRef {
  messageID: string
  partID: string
}

type PartGroup =
  | { key: string; type: "context"; refs: PartRef[] }
  | { key: string; type: "part"; ref: PartRef }

function isContextGroupTool(part: Part): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

function groupParts(parts: { messageID: string; part: Part }[]): PartGroup[] {
  const result: PartGroup[] = []
  let start = -1

  const flush = (end: number) => {
    if (start < 0) return
    const first = parts[start]
    if (!first) { start = -1; return }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: parts.slice(start, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    start = -1
  }

  parts.forEach((item, index) => {
    if (isContextGroupTool(item.part)) {
      if (start < 0) start = index
      return
    }
    flush(index - 1)
    result.push({
      key: `part:${item.messageID}:${item.part.id}`,
      type: "part",
      ref: { messageID: item.messageID, partID: item.part.id },
    })
  })

  flush(parts.length - 1)
  return result
}

// ─── HighlightedText — source: message-part.tsx:1175 ──────────

type HighlightSegment = { text: string; type?: "file" | "agent" }

function buildHighlightSegments(
  text: string,
  references: FilePart[],
  agents: AgentPart[],
): HighlightSegment[] {
  const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
    ...references
      .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
      .map((r) => ({ start: r.source!.text!.start, end: r.source!.text!.end, type: "file" as const })),
    ...agents
      .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
      .map((a) => ({ start: a.source!.start, end: a.source!.end, type: "agent" as const })),
  ].sort((a, b) => a.start - b.start)

  const result: HighlightSegment[] = []
  let lastIndex = 0

  for (const ref of allRefs) {
    if (ref.start < lastIndex) continue
    if (ref.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, ref.start) })
    }
    result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
    lastIndex = ref.end
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) })
  }

  return result
}

function HighlightedText({ text, references, agents }: {
  text: string
  references: FilePart[]
  agents: AgentPart[]
}) {
  const segments = buildHighlightSegments(text, references, agents)
  return (
    <>
      {segments.map((seg, i) => (
        <span key={i} style={seg.type === "file" ? styles.highlightFile : seg.type === "agent" ? styles.highlightAgent : undefined}>
          {seg.text}
        </span>
      ))}
    </>
  )
}

// ─── File helpers — source: message-file.ts ────────────────────

function isAttached(part: FilePart) {
  return part.url.startsWith("data:")
}

function isInline(part: FilePart) {
  if (isAttached(part)) return false
  return part.source?.text?.start !== undefined && part.source?.text?.end !== undefined
}

// ─── Path helpers — source: @opencode-ai/core/util/path ────────

function getFilename(path: string | undefined): string {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] ?? ""
}

function getDirectory(path: string | undefined): string {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

// ─── Error parsing — source: session-turn.tsx:29-80 ───────────

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrap(message: string): string {
  const text = message.replace(/^Error:\s*/, "").trim()

  const parse = (value: string) => {
    try { return JSON.parse(value) as unknown }
    catch { return undefined }
  }

  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  let json = read(text)

  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1))
    }
  }

  if (!record(json)) return message

  const err = record(json.error) ? json.error : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }

  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg

  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason

  return message
}

// ─── Reasoning heading — source: session-turn.tsx:110-144 ─────

function clean(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

function heading(text: string): string | undefined {
  const markdown = text.replace(/\r\n?/g, "\n")

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = clean(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = clean(atx[1])
    if (value) return value
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = clean(setext[1])
    if (value) return value
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = clean(strong[1])
    if (value) return value
  }

  return undefined
}

// ─── Duration formatting — source: message-part.tsx:1417-1436

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}m ${seconds}s`
}

// ─── Part visibility state — source: session-turn.tsx:95-108 ──

function partState(part: Part, showReasoningSummaries = true): "visible" | undefined {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool)) return undefined
    if (part.tool === "question") {
      const status = (part as ToolPart).state?.type
      if (status === "pending" || status === "running") return undefined
    }
    return "visible"
  }
  if (part.type === "text") return (part as TextPart).text?.trim() ? "visible" : undefined
  if (part.type === "reasoning") {
    if (showReasoningSummaries && (part as ReasoningPart).text?.trim()) return "visible"
    return undefined
  }
  if (RENDERABLE_TYPES.has(part.type)) return "visible"
  return undefined
}

// ─── MessageTimeline ───────────────────────────────────────────

export const MessageTimeline = observer(function MessageTimeline() {
  const store = useStore()
  const messages = store.currentSessionMessages
  const dirStore = store.currentDirStore
  const status = store.currentSessionStatus

  if (!dirStore || !store.selectedSessionID) return null

  // Group messages into turns (user message + following assistant messages)
  const turns: { user: Message; assistants: Message[] }[] = []
  for (const msg of messages) {
    if (msg.role === "user") {
      turns.push({ user: msg, assistants: [] })
    } else if (msg.role === "assistant" && turns.length > 0) {
      turns[turns.length - 1].assistants.push(msg)
    }
  }

  // Find the pending assistant message (last one with no time.completed)
  // Source: session-turn.tsx:201-207
  let activeTurnId: string | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && typeof (m as AssistantMessage).time.completed !== "number") {
      activeTurnId = (m as AssistantMessage).parentID
      break
    }
  }

  return (
    <div>
      <div style={styles.header}>
        <span style={styles.headerTitle}>
          Session: {store.selectedSessionID.slice(0, 12)}...
        </span>
        {status && (
          <span style={{
            ...styles.statusBadge,
            color: status.type === "busy" ? "#4ade80" : status.type === "retry" ? "#fbbf24" : "#8888aa",
          }}>
            {status.type}
          </span>
        )}
      </div>
      {turns.length === 0 && (
        <div style={styles.empty}>No messages in this session</div>
      )}
      {turns.map((turn) => (
        <TurnView
          key={turn.user.id}
          turn={turn}
          dirStore={dirStore}
          sessionStatus={status}
          active={turn.user.id === activeTurnId}
        />
      ))}
    </div>
  )
})

// ─── TurnView ──────────────────────────────────────────────────

const TurnView = observer(function TurnView({
  turn,
  dirStore,
  sessionStatus,
  active,
}: {
  turn: { user: Message; assistants: Message[] }
  dirStore: any
  sessionStatus: SessionStatus | null
  active: boolean
}) {
  const userParts: Part[] = dirStore.part[turn.user.id] ?? []

  // Source: UserMessageDisplay (message-part.tsx:1007-1019)
  const textPart = userParts.find((p): p is TextPart => p.type === "text" && !p.synthetic)
  const text = textPart?.text || ""
  const files = userParts.filter((p): p is FilePart => p.type === "file")
  const attachments = files.filter(isAttached)
  const inlineFiles = files.filter(isInline)
  const agents = userParts.filter((p): p is AgentPart => p.type === "agent")

  // ─── Turn-level computed values — source: session-turn.tsx ───

  const status = sessionStatus?.type ?? "idle"

  // Source: session-turn.tsx:318-323
  const working = status !== "idle" && active

  // Source: session-turn.tsx:284
  const interrupted = turn.assistants.some((m) => {
    const err = (m as AssistantMessage).error
    return record(err) && (err as any).name === "MessageAbortedError"
  })

  // Source: session-turn.tsx:285-316
  const errorAssistant = turn.assistants.find((m) => {
    const err = (m as AssistantMessage).error
    if (!err) return false
    if (record(err) && (err as any).name === "MessageAbortedError") return false
    return true
  })
  const errorText = (() => {
    const err = (errorAssistant as AssistantMessage | undefined)?.error
    if (!err) return undefined
    if (record(err)) {
      const data = (err as any).data
      if (record(data)) {
        const msg = typeof data.message === "string" ? data.message : undefined
        if (msg) return unwrap(msg)
      }
      const msg = typeof (err as any).message === "string" ? (err as any).message : undefined
      if (msg) return unwrap(msg)
    }
    if (typeof err === "string") return unwrap(err)
    return String(err)
  })()

  // Source: session-turn.tsx:345-369
  const assistantVisible = turn.assistants.reduce((count, m) => {
    const parts: Part[] = dirStore.part[m.id] ?? []
    return count + parts.filter((p) => partState(p) === "visible").length
  }, 0)

  const reasoningHeadingText = (() => {
    for (let i = turn.assistants.length - 1; i >= 0; i--) {
      const parts: Part[] = dirStore.part[turn.assistants[i].id] ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j]
        if (p.type === "reasoning" && (p as ReasoningPart).text?.trim()) {
          const h = heading((p as ReasoningPart).text)
          if (h) return h
        }
      }
    }
    return undefined
  })()

  // Source: session-turn.tsx:369
  const showThinking = working && !errorAssistant && !interrupted && status !== "retry" && assistantVisible === 0

  // Source: session-turn.tsx:330-344
  const turnDurationMs = (() => {
    let maxCompleted = 0
    for (const m of turn.assistants) {
      const completed = (m as AssistantMessage).time.completed
      if (typeof completed === "number" && completed > maxCompleted) {
        maxCompleted = completed
      }
    }
    if (!maxCompleted) return undefined
    return maxCompleted - (turn.user as UserMessage).time.created
  })()

  // Source: session-turn.tsx:285-289
  const dividerLabel = (() => {
    // Check for compaction part in assistant messages
    for (const m of turn.assistants) {
      const parts: Part[] = dirStore.part[m.id] ?? []
      if (parts.some((p) => p.type === "compaction")) return "Compaction"
    }
    if (interrupted) return "Interrupted"
    return ""
  })()

  // Check if any assistant is still streaming
  const isAnyStreaming = turn.assistants.some(
    (m) => typeof (m as AssistantMessage).time.completed !== "number"
  )

  return (
    <div style={styles.turn}>
      {/* User message */}
      <div style={styles.userBubble}>
        <div style={styles.roleLabel}>User</div>
        {attachments.length > 0 && (
          <div style={styles.userAttachments}>
            {attachments.map((file) => {
              const isImage = file.mime.startsWith("image/")
              const name = file.filename ?? "attachment"
              return isImage ? (
                <img key={file.id} src={file.url} alt={name} style={styles.userAttachmentImage} />
              ) : (
                <div key={file.id} style={styles.userAttachmentFile} title={name}>
                  <span style={styles.userAttachmentIcon}>📄</span>
                  <span style={styles.userAttachmentName}>{name}</span>
                </div>
              )
            })}
          </div>
        )}
        {text && (
          <div style={styles.userText}>
            <HighlightedText text={text} references={inlineFiles} agents={agents} />
          </div>
        )}
        {!text && attachments.length === 0 && (
          <div style={styles.userText}>(no content)</div>
        )}
      </div>

      {/* Turn divider — source: session-turn.tsx:396-427 */}
      {dividerLabel && <TurnDivider label={dividerLabel} />}

      {/* Assistant messages */}
      {turn.assistants.map((assistant) => (
        <AssistantMessageView
          key={assistant.id}
          message={assistant}
          dirStore={dirStore}
          isStreaming={typeof (assistant as AssistantMessage).time.completed !== "number"}
        />
      ))}

      {/* Thinking indicator */}
      {showThinking && <ThinkingIndicator heading={reasoningHeadingText} />}

      {/* Retry display */}
      {status === "retry" && working && sessionStatus?.type === "retry" && (
        <RetryDisplay
          attempt={sessionStatus.attempt}
          message={sessionStatus.message}
          next={sessionStatus.next}
        />
      )}

      {/* Error display */}
      {errorText && <ErrorDisplay text={errorText} />}

      {/* Duration */}
      {turnDurationMs != null && turnDurationMs > 0 && (
        <div style={styles.durationLine}>
          <span style={styles.duration}>{formatDuration(turnDurationMs)}</span>
        </div>
      )}
    </div>
  )
})

// ─── New UI Components ─────────────────────────────────────────

function ThinkingIndicator({ heading: headingText }: { heading?: string }) {
  return (
    <div style={styles.thinking}>
      <span style={styles.thinkingText}>Thinking...</span>
      {headingText && <span style={styles.thinkingHeading}>{headingText}</span>}
    </div>
  )
}

function ErrorDisplay({ text }: { text: string }) {
  return (
    <div style={styles.errorCard}>
      {text}
    </div>
  )
}

function RetryDisplay({ attempt, message, next }: { attempt: number; message: string; next: number }) {
  const [countdown, setCountdown] = React.useState(() =>
    Math.max(0, Math.ceil((next - Date.now()) / 1000))
  )

  React.useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((next - Date.now()) / 1000))
      setCountdown(remaining)
      if (remaining <= 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [next])

  return (
    <div style={styles.retryCard}>
      <div style={styles.retryMessage}>{message}</div>
      <div style={styles.retryInfo}>Attempt {attempt} · retrying in {countdown}s</div>
    </div>
  )
}

function TurnDivider({ label }: { label: string }) {
  return (
    <div style={styles.turnDivider}>
      <span style={styles.turnDividerLine} />
      <span style={styles.turnDividerLabel}>{label}</span>
      <span style={styles.turnDividerLine} />
    </div>
  )
}

// ─── AssistantMessageView ──────────────────────────────────────

const AssistantMessageView = observer(function AssistantMessageView({
  message,
  dirStore,
  isStreaming,
}: {
  message: Message
  dirStore: any
  isStreaming?: boolean
}) {
  const allParts: Part[] = dirStore.part[message.id] ?? []

  // Filter + group parts — source: AssistantMessageDisplay (message-part.tsx:822-896)
  const renderableParts = allParts.filter((p) => renderable(p))
  const groups = groupParts(
    renderableParts.map((part) => ({ messageID: message.id, part })),
  )

  // Build a map for quick part lookup by ID
  const partMap = new Map<string, Part>()
  for (const p of allParts) partMap.set(p.id, p)

  return (
    <div style={styles.assistantBubble}>
      <div style={styles.roleLabel}>
        Assistant
        {"agent" in message && (
          <span style={styles.agentLabel}> ({(message as any).agent})</span>
        )}
        {"cost" in message && (message as any).cost > 0 && (
          <span style={styles.costLabel}> ${(message as any).cost.toFixed(4)}</span>
        )}
      </div>
      {isStreaming && renderableParts.length === 0 && (
        <div style={styles.streaming}>Streaming...</div>
      )}
      {groups.map((group) => {
        if (group.type === "context") {
          const contextParts = group.refs
            .map((ref) => partMap.get(ref.partID))
            .filter((p): p is ToolPart => !!p && p.type === "tool" && CONTEXT_GROUP_TOOLS.has(p.tool))
          return (
            <ContextToolGroup key={group.key} parts={contextParts} />
          )
        }
        // Single part
        const part = partMap.get(group.ref.partID)
        if (!part) return null
        return <PartView key={group.key} part={part} />
      })}
    </div>
  )
})

// ─── contextToolTrigger — source: message-part.tsx:711-761 ──────

function contextToolTrigger(part: ToolPart): { title: string; subtitle: string; args: string[] } {
  const input = (part.state as any).input ?? {} as Record<string, unknown>
  const path = typeof input.path === "string" ? input.path : "/"
  const filePath = typeof input.filePath === "string" ? input.filePath : undefined
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const offset = typeof input.offset === "number" ? input.offset : undefined
  const limit = typeof input.limit === "number" ? input.limit : undefined

  switch (part.tool) {
    case "read": {
      const args: string[] = []
      if (offset !== undefined) args.push("offset=" + offset)
      if (limit !== undefined) args.push("limit=" + limit)
      return {
        title: "读取",
        subtitle: filePath ? getFilename(filePath) : "",
        args,
      }
    }
    case "list":
      return {
        title: "列表",
        subtitle: getDirectory(path),
        args: [],
      }
    case "glob":
      return {
        title: "Glob",
        subtitle: getDirectory(path),
        args: pattern ? ["pattern=" + pattern] : [],
      }
    case "grep": {
      const args: string[] = []
      if (pattern) args.push("pattern=" + pattern)
      if (include) args.push("include=" + include)
      return {
        title: "Grep",
        subtitle: getDirectory(path),
        args,
      }
    }
    default:
      return { title: part.tool, subtitle: "", args: [] }
  }
}

// ─── ContextToolGroup — source: message-part.tsx:898-960 ───────

function ContextToolGroup({ parts }: { parts: ToolPart[] }) {
  const read = parts.filter((p) => p.tool === "read").length
  const search = parts.filter((p) => p.tool === "glob" || p.tool === "grep").length
  const list = parts.filter((p) => p.tool === "list").length
  const busy = parts.some((p) => p.state.type === "running" || p.state.type === "pending")

  const summary = [
    read > 0 ? `${read} 读取` : "",
    search > 0 ? `${search} 搜索` : "",
    list > 0 ? `${list} 列表` : "",
  ].filter(Boolean).join(", ")

  return (
    <details style={styles.contextGroup}>
      <summary style={styles.contextGroupSummary}>
        <span style={busy ? styles.contextActive : styles.contextDone}>
          {busy ? "正在收集上下文..." : "已收集上下文"}
        </span>
        <span style={styles.contextSummary}>{summary}</span>
      </summary>
      <div style={styles.contextGroupDetail}>
        {parts.map((part) => {
          const trigger = contextToolTrigger(part)
          return (
            <div key={part.id} style={styles.contextToolItem}>
              <span style={styles.contextToolName}>{trigger.title}</span>
              {trigger.subtitle && <span style={styles.contextToolSubtitle}>{trigger.subtitle}</span>}
              {trigger.args.map((arg) => (
                <span key={arg} style={styles.contextToolArg}>{arg}</span>
              ))}
            </div>
          )
        })}
      </div>
    </details>
  )
}

// ─── PartView dispatcher ───────────────────────────────────────

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return <TextPartView part={part} />
    case "reasoning":
      return <ReasoningPartView part={part} />
    case "tool":
      return <ToolPartView part={part} />
    case "compaction":
      return <CompactionPartView part={part} />
    default:
      // Unregistered types should have been filtered by renderable(),
      // but as safety fallback:
      return null
  }
}

// ─── Individual part views ─────────────────────────────────────

const TextPartView = observer(function TextPartView({ part }: { part: TextPart }) {
  const text = (part.text ?? "").trim()
  if (!text) return null
  return (
    <div style={styles.textPart}>
      <pre style={styles.textContent}>{text}</pre>
    </div>
  )
})

const ReasoningPartView = observer(function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const text = (part.text ?? "").trim()
  if (!text) return null
  return (
    <details style={styles.reasoningPart}>
      <summary style={styles.reasoningSummary}>
        Reasoning ({text.length} chars)
      </summary>
      <pre style={styles.textContent}>{text}</pre>
    </details>
  )
})

const ToolPartView = observer(function ToolPartView({ part }: { part: ToolPart }) {
  // Source: todowrite hidden (message-part.tsx:1305, HIDDEN_TOOLS)
  if (HIDDEN_TOOLS.has(part.tool)) return null

  // Source: question pending/running hidden (message-part.tsx:1307-1308)
  if (part.tool === "question") {
    const status = part.state?.type
    if (status === "pending" || status === "running") return null
  }

  const input = (part.state as any).input ?? {}

  return (
    <div style={styles.toolPart}>
      <div style={styles.toolHeader}>
        <span style={styles.toolName}>{part.tool}</span>
        <span style={{
          ...styles.toolState,
          color: part.state.type === "running" ? "#fbbf24" :
            part.state.type === "completed" ? "#4ade80" : "#f87171",
        }}>
          {part.state.type}
        </span>
      </div>
      {/* Show key input fields as subtitle */}
      {input.filePath && <div style={styles.toolInput}>file: {input.filePath}</div>}
      {input.path && <div style={styles.toolInput}>path: {input.path}</div>}
      {input.pattern && <div style={styles.toolInput}>pattern: {input.pattern}</div>}
      {input.command && <div style={styles.toolInput}>$ {input.command}</div>}
      {part.state.type === "completed" && (part.state as any).output && (
        <pre style={styles.toolOutput}>{truncate((part.state as any).output, 500)}</pre>
      )}
      {part.state.type === "error" && (part.state as any).error && (
        <pre style={styles.toolError}>{(part.state as any).error}</pre>
      )}
    </div>
  )
})

function CompactionPartView({ part }: { part: CompactionPart }) {
  return (
    <div style={styles.compactionPart}>
      ── Compaction {part.auto ? "(auto)" : ""} ──
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + `... (${str.length} chars total)`
}

// ─── Styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: "1px solid #2a2a4a",
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  statusBadge: {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 4,
    backgroundColor: "#1a1a3e",
  },
  empty: {
    opacity: 0.5,
    textAlign: "center" as const,
    padding: 32,
  },
  turn: {
    marginBottom: 16,
  },
  userBubble: {
    backgroundColor: "#1e3a5f",
    padding: "10px 14px",
    borderRadius: "8px 8px 8px 2px",
    marginBottom: 8,
    maxWidth: "80%",
  },
  assistantBubble: {
    backgroundColor: "#1a2e1a",
    padding: "10px 14px",
    borderRadius: "8px 8px 2px 8px",
    marginLeft: 24,
    marginBottom: 8,
    maxWidth: "90%",
  },
  roleLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    color: "#8888aa",
    marginBottom: 4,
  },
  agentLabel: {
    color: "#a78bfa",
    fontWeight: 400,
  },
  costLabel: {
    color: "#4ade80",
    fontWeight: 400,
  },
  userText: {
    fontSize: 13,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  highlightFile: {
    backgroundColor: "rgba(96, 165, 250, 0.15)",
    borderRadius: 2,
    padding: "0 2px",
  },
  highlightAgent: {
    backgroundColor: "rgba(167, 139, 250, 0.15)",
    borderRadius: 2,
    padding: "0 2px",
  },
  userAttachments: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    marginBottom: 6,
  },
  userAttachmentImage: {
    maxWidth: 120,
    maxHeight: 80,
    borderRadius: 4,
    objectFit: "contain" as const,
  },
  userAttachmentFile: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    backgroundColor: "#162a45",
    borderRadius: 4,
    fontSize: 12,
  },
  userAttachmentIcon: {
    fontSize: 12,
  },
  userAttachmentName: {
    fontSize: 12,
    color: "#93c5fd",
  },
  streaming: {
    fontSize: 12,
    color: "#8888aa",
    fontStyle: "italic",
  },
  textPart: {
    marginTop: 4,
  },
  textContent: {
    fontSize: 13,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    margin: 0,
    fontFamily: "inherit",
    lineHeight: 1.5,
  },
  reasoningPart: {
    marginTop: 4,
    border: "1px solid #2a2a4a",
    borderRadius: 4,
    padding: 4,
  },
  reasoningSummary: {
    fontSize: 11,
    color: "#a78bfa",
    cursor: "pointer",
  },
  contextGroup: {
    marginTop: 4,
    border: "1px solid #2a3a4a",
    borderRadius: 4,
    padding: "4px 8px",
    backgroundColor: "#141428",
  },
  contextGroupSummary: {
    fontSize: 11,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  contextActive: {
    color: "#fbbf24",
    fontWeight: 600,
  },
  contextDone: {
    color: "#4ade80",
    fontWeight: 600,
  },
  contextSummary: {
    color: "#8888aa",
  },
  contextGroupDetail: {
    marginTop: 4,
    paddingLeft: 12,
  },
  contextToolItem: {
    fontSize: 11,
    padding: "2px 0",
    display: "flex",
    gap: 6,
  },
  contextToolName: {
    color: "#60a5fa",
    fontWeight: 600,
  },
  contextToolSubtitle: {
    color: "#a0a0a0",
  },
  contextToolArg: {
    fontSize: 10,
    color: "#666688",
    backgroundColor: "#1a1a3e",
    padding: "0 4px",
    borderRadius: 2,
    marginLeft: 4,
  },
  toolPart: {
    marginTop: 4,
    border: "1px solid #2a2a4a",
    borderRadius: 4,
    padding: "6px 10px",
  },
  toolHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
  },
  toolName: {
    fontWeight: 600,
    color: "#60a5fa",
  },
  toolInput: {
    fontSize: 11,
    color: "#a0a0a0",
    marginTop: 2,
  },
  toolState: {
    fontSize: 11,
  },
  toolOutput: {
    fontSize: 11,
    marginTop: 6,
    maxHeight: 200,
    overflow: "auto",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    margin: 0,
    color: "#a0a0a0",
  },
  toolError: {
    fontSize: 11,
    marginTop: 6,
    color: "#f87171",
    whiteSpace: "pre-wrap" as const,
    margin: 0,
  },
  compactionPart: {
    textAlign: "center" as const,
    color: "#666688",
    fontSize: 11,
    padding: "4px 0",
  },
  thinking: {
    marginLeft: 24,
    marginTop: 4,
    padding: "6px 10px",
    animation: "sse-viewer-shimmer 2s ease-in-out infinite",
  },
  thinkingText: {
    fontSize: 12,
    color: "#a78bfa",
    fontStyle: "italic",
  },
  thinkingHeading: {
    fontSize: 11,
    color: "#8888aa",
    marginLeft: 8,
  },
  errorCard: {
    marginLeft: 24,
    marginTop: 4,
    padding: "8px 12px",
    border: "1px solid #f87171",
    borderRadius: 4,
    backgroundColor: "rgba(248, 113, 113, 0.08)",
    color: "#f87171",
    fontSize: 12,
  },
  retryCard: {
    marginLeft: 24,
    marginTop: 4,
    padding: "8px 12px",
    border: "1px solid #fbbf24",
    borderRadius: 4,
    backgroundColor: "rgba(251, 191, 36, 0.08)",
  },
  retryMessage: {
    fontSize: 12,
    color: "#fbbf24",
  },
  retryInfo: {
    fontSize: 11,
    color: "#8888aa",
    marginTop: 2,
  },
  turnDivider: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "8px 0",
  },
  turnDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#2a2a4a",
  },
  turnDividerLabel: {
    fontSize: 11,
    color: "#666688",
    textTransform: "uppercase" as const,
  },
  durationLine: {
    marginLeft: 24,
    marginTop: 4,
  },
  duration: {
    fontSize: 11,
    color: "#666688",
  },
}
