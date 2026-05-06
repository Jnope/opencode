import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./components/app"
import { RootStore } from "./stores/root-store"
import { StoreProvider } from "./hooks/use-store.tsx"

const store = new RootStore()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </React.StrictMode>,
)
