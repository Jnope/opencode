import React, { useEffect } from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"
import { StatusBar } from "./status-bar"
import { DirectoryList } from "./directory-list"
import { SessionList } from "./session-list"
import { MessageTimeline } from "./message-timeline"
import { EventLog } from "./event-log"

export const App = observer(function App() {
  const store = useStore()

  useEffect(() => {
    store.connect()
    return () => store.disconnect()
  }, [store])

  return (
    <div style={styles.container}>
      <StatusBar />
      <div style={styles.main}>
        <div style={styles.sidebar}>
          <DirectoryList />
          <SessionList />
        </div>
        <div style={styles.content}>
          {store.selectedSessionID ? (
            <MessageTimeline />
          ) : store.currentDirStore ? (
            <div style={styles.placeholder}>Select a session to view messages</div>
          ) : store.directories.length > 0 ? (
            <div style={styles.placeholder}>Select a directory to view sessions</div>
          ) : (
            <div style={styles.placeholder}>
              Waiting for SSE events...
              <br />
              <span style={{ fontSize: 12, opacity: 0.6 }}>
                Make sure opencode serve is running on port 4096
              </span>
            </div>
          )}
        </div>
        <div style={styles.log}>
          <EventLog />
        </div>
      </div>
    </div>
  )
})

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },
  main: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  sidebar: {
    width: 280,
    borderRight: "1px solid #2a2a4a",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: 16,
  },
  log: {
    width: 320,
    borderLeft: "1px solid #2a2a4a",
    overflow: "auto",
  },
  placeholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    opacity: 0.5,
    textAlign: "center" as const,
    lineHeight: 1.8,
  },
}
