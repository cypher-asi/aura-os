import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@cypher-asi/zui": path.resolve(__dirname, "../../zui/src"),
      "@cypher-asi/zui/styles": path.resolve(__dirname, "../../zui/src/styles/index.css"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3100",
      "/ws": {
        target: "ws://localhost:3100",
        ws: true,
      },
    },
  },
});
