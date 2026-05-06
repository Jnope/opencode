import React, { createContext, useContext } from "react"
import { RootStore } from "../stores/root-store"

export const StoreContext = createContext<RootStore | null>(null)

export function useStore(): RootStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used within StoreProvider")
  return store
}

export function StoreProvider({ store, children }: { store: RootStore; children: React.ReactNode }) {
  return (
    <StoreContext.Provider value={store}>
      {children}
    </StoreContext.Provider>
  )
}
