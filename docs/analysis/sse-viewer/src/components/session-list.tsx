import React from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"
import type { Session, SessionStatus } from "../utils/types"

export const SessionList = observer(function SessionList() {
  const store = useStore()
  const sessions = store.currentSessions
  const dirStore = store.currentDirStore

  if (!dirStore) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Sessions ({dirStore.sessionTotal})
      </div>
      {sessions.length === 0 && (
        <div style={styles.empty}>No sessions</div>
      )}
      {sessions.map((session) => {
        const status: SessionStatus | undefined = dirStore.session_status[session.id]
        const isSelected = store.selectedSessionID === session.id
        const isBusy = status?.type === "busy"
        return (
          <div
            key={session.id}
            style={{
              ...styles.item,
              backgroundColor: isSelected ? "#2a2a5a" : undefined,
            }}
            onClick={() => store.selectSession(session.id)}
          >
            <div style={styles.sessionTitle}>
              {isBusy && <span style={styles.busyDot} />}
              {session.title || session.id.slice(0, 8)}
            </div>
            <div style={styles.sessionMeta}>
              {new Date(session.time.created).toLocaleTimeString()}
              {session.parentID && " (child)"}
            </div>
          </div>
        )
      })}
    </div>
  )
})

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflow: "auto",
    borderTop: "1px solid #2a2a4a",
  },
  header: {
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: "#8888aa",
    borderBottom: "1px solid #2a2a4a",
  },
  empty: {
    padding: 12,
    opacity: 0.5,
    fontSize: 12,
  },
  item: {
    padding: "8px 12px",
    cursor: "pointer",
    borderBottom: "1px solid #1a1a3e",
  },
  sessionTitle: {
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  busyDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: "#4ade80",
    flexShrink: 0,
    animation: "pulse 1s infinite",
  },
  sessionMeta: {
    fontSize: 11,
    color: "#8888aa",
    marginTop: 2,
  },
}
