import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "infra/evals/status/persist-status-history.mjs");

test("persist-status-history fails closed when production persistence is required", () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AURA_STATUS_PERSIST_REQUIRED: "1",
      AURA_STORAGE_URL: "",
      AURA_STORAGE_INTERNAL_TOKEN: "",
      INTERNAL_SERVICE_TOKEN: "",
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /AURA storage URL and internal token are required before publishing observability status/,
  );
});
