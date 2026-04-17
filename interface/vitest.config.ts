import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
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
