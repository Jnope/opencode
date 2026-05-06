import React from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"
import type { Message, Part, TextPart, ReasoningPart, ToolPart, CompactionPart } from "../utils/types"

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
      {turns.map((turn, i) => (
        <TurnView key={turn.user.id} turn={turn} dirStore={dirStore} />
      ))}
    </div>
  )
})

const TurnView = observer(function TurnView({
  turn,
  dirStore,
}: {
  turn: { user: Message; assistants: Message[] }
  dirStore: any
}) {
  return (
    <div style={styles.turn}>
      <div style={styles.userBubble}>
        <div style={styles.roleLabel}>User</div>
        <div style={styles.userText}>{turn.user.id.slice(0, 16)}...</div>
      </div>
      {turn.assistants.map((assistant) => (
        <AssistantMessageView key={assistant.id} message={assistant} dirStore={dirStore} />
      ))}
    </div>
  )
})

const AssistantMessageView = observer(function AssistantMessageView({
  message,
  dirStore,
}: {
  message: Message
  dirStore: any
}) {
  const parts: Part[] = dirStore.part[message.id] ?? []

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
      {parts.length === 0 && (
        <div style={styles.streaming}>Streaming...</div>
      )}
      {parts.map((part) => (
        <PartView key={part.id} part={part} />
      ))}
    </div>
  )
})

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
      return (
        <div style={styles.partDefault}>
          [{part.type}] {part.id.slice(0, 8)}
        </div>
      )
  }
}

const TextPartView = observer(function TextPartView({ part }: { part: TextPart }) {
  return (
    <div style={styles.textPart}>
      <pre style={styles.textContent}>{part.text || "(empty)"}</pre>
    </div>
  )
})

const ReasoningPartView = observer(function ReasoningPartView({ part }: { part: ReasoningPart }) {
  return (
    <details style={styles.reasoningPart}>
      <summary style={styles.reasoningSummary}>
        Reasoning {part.text ? `(${part.text.length} chars)` : ""}
      </summary>
      <pre style={styles.textContent}>{part.text || "(empty)"}</pre>
    </details>
  )
})

const ToolPartView = observer(function ToolPartView({ part }: { part: ToolPart }) {
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
      {part.state.type === "completed" && part.state.output && (
        <pre style={styles.toolOutput}>{truncate(part.state.output, 500)}</pre>
      )}
      {part.state.type === "error" && part.state.error && (
        <pre style={styles.toolError}>{part.state.error}</pre>
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

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + `... (${str.length} chars total)`
}

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
  partDefault: {
    fontSize: 11,
    color: "#8888aa",
    padding: "2px 0",
  },
}
