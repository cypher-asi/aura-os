import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "..");
  const env = loadEnv(mode, repoRoot, "");
  const serverPort = env.AURA_SERVER_PORT || "3100";
  const apiTarget = `http://localhost:${serverPort}`;
  const wsTarget = `ws://localhost:${serverPort}`;
  const vendoredZuiEntry = path.resolve(__dirname, "node_modules/@cypher-asi/zui/src/index.ts");
  const vendoredZuiStyles = path.resolve(__dirname, "node_modules/@cypher-asi/zui/src/styles/index.css");
  const analyzeBundle = mode === "analyze" || process.env.ANALYZE === "1";

  return {
    plugins: [
      react(),
      analyzeBundle &&
        visualizer({
          filename: path.resolve(__dirname, "dist/stats.html"),
          gzipSize: true,
          brotliSize: true,
          open: false,
          template: "treemap",
        }),
    ].filter(Boolean),
    resolve: {
      dedupe: ["react", "react-dom"],
      preserveSymlinks: true,
      alias: [
        { find: "@cypher-asi/zui/styles", replacement: vendoredZuiStyles },
        { find: "@cypher-asi/zui", replacement: vendoredZuiEntry },
        { find: "react-dom", replacement: path.resolve(__dirname, "node_modules/react-dom") },
        { find: "react", replacement: path.resolve(__dirname, "node_modules/react") },
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-router-dom/") ||
              id.includes("/@tanstack/")
            ) {
              return "framework";
            }
            if (
              id.includes("/@cypher-asi/zui/") ||
              id.includes("/lucide-react/") ||
              id.includes("/@fontsource-variable/")
            ) {
              return "ui-vendor";
            }
            if (id.includes("/@xyflow/")) {
              return "diagram-vendor";
            }
            if (
              id.includes("/react-markdown/") ||
              id.includes("/remark-gfm/") ||
              id.includes("/rehype-highlight/") ||
              id.includes("/highlight.js/")
            ) {
              return "markdown-vendor";
            }
            if (id.includes("/@xterm/")) {
              return "terminal-vendor";
            }
            return "vendor";
          },
        },
      },
    },
    server: {
      port: 5173,
      hmr: {
        protocol: "ws",
        host: "127.0.0.1",
      },
      proxy: {
        "/api": {
          target: apiTarget,
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes) => {
              if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
                proxyRes.headers["x-accel-buffering"] = "no";
                proxyRes.headers["cache-control"] = "no-cache, no-transform";
              }
            });
          },
        },
        "/ws": {
          target: wsTarget,
          ws: true,
        },
      },
    },
  };
});
