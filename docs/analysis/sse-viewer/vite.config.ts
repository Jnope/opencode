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
    },
  },
})
