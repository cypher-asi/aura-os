import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "..");
  const env = loadEnv(mode, envDir, "");
  const serverPort = env.AURA_SERVER_PORT || "3100";
  const apiTarget = `http://localhost:${serverPort}`;
  const wsTarget = `ws://localhost:${serverPort}`;

  return {
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        react: path.resolve(__dirname, "node_modules/react"),
        "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": apiTarget,
        "/ws": {
          target: wsTarget,
          ws: true,
        },
      },
    },
  };
});
