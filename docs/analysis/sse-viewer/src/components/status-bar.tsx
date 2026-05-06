import React from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"

export const StatusBar = observer(function StatusBar() {
  const store = useStore()
  const { sse } = store

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <span
          style={{
            ...styles.dot,
            backgroundColor: sse.connected ? "#4ade80" : "#f87171",
          }}
        />
        <span style={styles.title}>OpenCode SSE Viewer</span>
        {sse.connected ? "Connected" : "Disconnected"}
      </div>
      <div style={styles.right}>
        <span>Events: {sse.eventCount}</span>
        <span>Dirs: {store.directories.length}</span>
        {!sse.connected && sse.reconnectAttempt > 0 && (
          <span style={{ color: "#fbbf24" }}>
            Reconnect #{sse.reconnectAttempt}
          </span>
        )}
        {sse.error && <span style={{ color: "#f87171" }}>{sse.error}</span>}
        <button style={styles.btn} onClick={() => store.connect()}>
          Connect
        </button>
        <button style={styles.btn} onClick={() => store.disconnect()}>
          Disconnect
        </button>
      </div>
    </div>
  )
})

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    borderBottom: "1px solid #2a2a4a",
    fontSize: 13,
    backgroundColor: "#16213e",
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  title: {
    fontWeight: 600,
    marginRight: 8,
  },
  btn: {
    padding: "2px 8px",
    fontSize: 12,
    cursor: "pointer",
    backgroundColor: "#2a2a4a",
    color: "#e0e0e0",
    border: "1px solid #3a3a5a",
    borderRadius: 4,
  },
}
