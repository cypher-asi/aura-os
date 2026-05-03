import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Mirror vite.config.ts: the vendored @cypher-asi/zui has its own
    // nested copy of React (different major than the app's), so we must
    // dedupe + alias here so anything pulled in from the ZUI source
    // shares the single React instance used by tests.
    dedupe: ["react", "react-dom"],
    preserveSymlinks: true,
    alias: [
      {
        find: "@cypher-asi/zui/styles",
        replacement: path.resolve(__dirname, "node_modules/@cypher-asi/zui/src/styles/index.css"),
      },
      {
        find: "@cypher-asi/zui",
        replacement: path.resolve(__dirname, "node_modules/@cypher-asi/zui/src/index.ts"),
      },
      { find: "react-dom", replacement: path.resolve(__dirname, "node_modules/react-dom") },
      { find: "react", replacement: path.resolve(__dirname, "node_modules/react") },
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
    __APP_COMMIT__: JSON.stringify("testcommit"),
    __APP_BUILD_TIME__: JSON.stringify("2026-04-17T00:00:00.000Z"),
    __APP_CHANNEL__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
