import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

function resolveBuildMeta(isDev: boolean) {
  const pkgPath = path.resolve(__dirname, "package.json");
  let pkgVersion = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (pkg.version) pkgVersion = pkg.version;
  } catch {
    // fall through to default
  }

  const version = process.env.APP_VERSION || pkgVersion;

  let commit = process.env.APP_COMMIT;
  if (!commit) {
    try {
      commit = execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      commit = "local";
    }
  }
  const shortCommit = commit ? commit.slice(0, 12) : "local";

  const channel = process.env.APP_CHANNEL || (isDev ? "dev" : "stable");
  const buildTime = isDev ? "dev" : new Date().toISOString();

  return { version, commit: shortCommit, channel, buildTime };
}

export default defineConfig(({ mode, command }) => {
  const repoRoot = path.resolve(__dirname, "..");
  const env = loadEnv(mode, repoRoot, "");
  const serverPort = env.AURA_SERVER_PORT || "3100";
  const apiTarget = `http://localhost:${serverPort}`;
  const wsTarget = `ws://localhost:${serverPort}`;
  const allowedHosts = (env.AURA_DEV_ALLOWED_HOSTS || ".trycloudflare.com,localhost,127.0.0.1")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const vendoredZuiEntry = path.resolve(__dirname, "node_modules/@cypher-asi/zui/src/index.ts");
  const vendoredZuiStyles = path.resolve(__dirname, "node_modules/@cypher-asi/zui/src/styles/index.css");
  const analyzeBundle = mode === "analyze" || process.env.ANALYZE === "1";
  const buildMeta = resolveBuildMeta(command === "serve");

  return {
    define: {
      __APP_VERSION__: JSON.stringify(buildMeta.version),
      __APP_COMMIT__: JSON.stringify(buildMeta.commit),
      __APP_BUILD_TIME__: JSON.stringify(buildMeta.buildTime),
      __APP_CHANNEL__: JSON.stringify(buildMeta.channel),
    },
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
      sourcemap: false,
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
            if (id.includes("/highlight.js/") && !id.endsWith(".css") && !id.includes("/styles/")) {
              return "highlight-vendor";
            }
            if (
              id.includes("/react-markdown/") ||
              id.includes("/remark-gfm/") ||
              id.includes("/rehype-highlight/")
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
      allowedHosts,
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
