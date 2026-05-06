import React from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "../hooks/use-store"

export const DirectoryList = observer(function DirectoryList() {
  const store = useStore()
  const dirs = store.directories

  return (
    <div style={styles.container}>
      <div style={styles.header}>Directories ({dirs.length})</div>
      {dirs.length === 0 && (
        <div style={styles.empty}>No directories yet</div>
      )}
      {dirs.map((dir) => {
        const dirStore = store.sse.childStores.peek(dir)
        const sessionCount = dirStore?.session.length ?? 0
        const isSelected = store.selectedDirectory === dir
        return (
          <div
            key={dir}
            style={{
              ...styles.item,
              backgroundColor: isSelected ? "#2a2a5a" : undefined,
            }}
            onClick={() => store.selectDirectory(dir)}
          >
            <div style={styles.dirName} title={dir}>
              {dir.split("/").pop() || dir}
            </div>
            <div style={styles.dirMeta}>
              {sessionCount} session{sessionCount !== 1 ? "s" : ""}
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
  dirName: {
    fontSize: 13,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  dirMeta: {
    fontSize: 11,
    color: "#8888aa",
    marginTop: 2,
  },
}
