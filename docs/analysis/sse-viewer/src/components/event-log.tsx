import React, { useState, useRef, useEffect } from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"
import type { GlobalEvent } from "../utils/types"

export const EventLog = observer(function EventLog() {
  const store = useStore()
  const [events, setEvents] = useState<{ time: number; type: string; dir: string }[]>([])
  const [maxEvents] = useState(200)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Listen for event count changes to log event types
  const prevCount = useRef(store.sse.eventCount)
  useEffect(() => {
    if (store.sse.eventCount !== prevCount.current) {
      // We can't access the raw events here, but we can show count updates
      prevCount.current = store.sse.eventCount
    }
  })

  // Track event types from directory stores
  const dirStores = store.sse.childStores.children
  const dirList = Object.keys(dirStores)

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        Event Log
        <span style={styles.count}>{store.sse.eventCount}</span>
      </div>
      <div style={styles.stats}>
        <div>Connected: {store.sse.connected ? "Yes" : "No"}</div>
        <div>Last event: {store.sse.lastEventAt ? new Date(store.sse.lastEventAt).toLocaleTimeString() : "-"}</div>
        <div>Reconnects: {store.sse.reconnectAttempt}</div>
        <div style={{ marginTop: 8, fontWeight: 600 }}>Directory Stores:</div>
        {dirList.map((dir) => {
          const ds = dirStores[dir]
          return (
            <div key={dir} style={styles.dirEntry}>
              <div style={styles.dirName} title={dir}>
                {dir.split("/").pop()}
              </div>
              <div style={styles.dirStats}>
                <span>{ds.session.length} sessions</span>
                <span>{Object.keys(ds.message).length} msg caches</span>
                <span>{Object.keys(ds.part).length} part caches</span>
                {ds.session_status && Object.keys(ds.session_status).map((sid) => {
                  const s = ds.session_status[sid]
                  return s?.type === "busy" ? (
                    <span key={sid} style={{ color: "#4ade80" }}>running</span>
                  ) : null
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div style={styles.permissions}>
        {store.currentSessionPermissions.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Pending Permissions:</div>
            {store.currentSessionPermissions.map((p) => (
              <div key={p.id} style={styles.permItem}>
                {p.permission} — {p.patterns.join(", ")}
              </div>
            ))}
          </>
        )}
        {store.currentSessionQuestions.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 4, marginTop: 8 }}>Pending Questions:</div>
            {store.currentSessionQuestions.map((q) => (
              <div key={q.id} style={styles.questionItem}>
                {q.questions.map((qi, i) => (
                  <div key={i}>
                    <strong>{qi.header}</strong>: {qi.question}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
})

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    fontSize: 12,
  },
  header: {
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: "#8888aa",
    borderBottom: "1px solid #2a2a4a",
    display: "flex",
    justifyContent: "space-between",
  },
  count: {
    backgroundColor: "#2a2a5a",
    padding: "0 6px",
    borderRadius: 4,
    color: "#60a5fa",
  },
  stats: {
    padding: 12,
    borderBottom: "1px solid #2a2a4a",
    lineHeight: 1.8,
  },
  dirEntry: {
    marginTop: 4,
    paddingLeft: 8,
    borderLeft: "2px solid #3a3a5a",
  },
  dirName: {
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  dirStats: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    color: "#8888aa",
    flexWrap: "wrap" as const,
  },
  permissions: {
    padding: 12,
  },
  permItem: {
    padding: "4px 8px",
    backgroundColor: "#2a1a1a",
    borderRadius: 4,
    marginBottom: 4,
    fontSize: 11,
  },
  questionItem: {
    padding: "4px 8px",
    backgroundColor: "#1a2a1a",
    borderRadius: 4,
    marginBottom: 4,
    fontSize: 11,
  },
}
