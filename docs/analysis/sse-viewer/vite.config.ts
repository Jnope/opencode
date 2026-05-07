import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 13368,
    proxy: {
      "/global": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/session": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/permission": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/question": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/project": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/path": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/vcs": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/agent": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
      "/config": {
        target: "http://127.0.0.1:12345",
        changeOrigin: true,
      },
    },
  },
})
