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
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
