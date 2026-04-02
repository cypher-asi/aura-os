import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getHarnessBenchmarkScenario,
  validateHarnessBenchmarkScenario,
  prepareHarnessBenchmarkWorkspace,
} from "../../scripts/lib/harness-benchmark-scenarios.mjs";

const interfaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanupDirs = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createTempWorkspace(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

describe("harness benchmark scenarios", () => {
  it("validates fixture-backed scenarios", async () => {
    const scenario = getHarnessBenchmarkScenario(interfaceRoot, "harness-fixture-static-site");
    await expect(validateHarnessBenchmarkScenario(interfaceRoot, scenario)).resolves.toBe(true);
  });

  it("copies fixture files into the prepared workspace", async () => {
    const scenario = getHarnessBenchmarkScenario(interfaceRoot, "harness-fixture-node-server-patch");
    const workspaceDir = await createTempWorkspace("aura-harness-fixture-node-");

    await prepareHarnessBenchmarkWorkspace(interfaceRoot, scenario, workspaceDir);

    await expect(fs.access(path.join(workspaceDir, "server.js"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workspaceDir, "requirements.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workspaceDir, "scripts", "validate.js"))).resolves.toBeUndefined();
  });

  it("prepares the repeated-read fixture with the reference document", async () => {
    const scenario = getHarnessBenchmarkScenario(interfaceRoot, "harness-fixture-repeated-read-summary");
    const workspaceDir = await createTempWorkspace("aura-harness-fixture-read-");

    await prepareHarnessBenchmarkWorkspace(interfaceRoot, scenario, workspaceDir);

    const reference = await fs.readFile(path.join(workspaceDir, "reference.md"), "utf8");
    expect(reference).toContain("Cache usage");
    await expect(fs.access(path.join(workspaceDir, "scripts", "validate.js"))).resolves.toBeUndefined();
  });
});
