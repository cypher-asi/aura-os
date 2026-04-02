import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  defaultExternalAgentResultsDir,
  getExternalAgentScenario,
  prepareExternalAgentWorkspace,
} from "./lib/external-agent-scenarios.mjs";
import { runAuraAdapter } from "./adapters/aura.mjs";
import { runClaudeCodeAdapter } from "./adapters/claude-code.mjs";
import { runCodexAdapter } from "./adapters/codex.mjs";

const interfaceRoot = process.cwd();
const adapterId = process.env.AURA_EXT_AGENT_ADAPTER?.trim() || "aura";
const scenarioId = process.env.AURA_EXT_AGENT_SCENARIO?.trim() || "external-static-site";
const keepWorkspace = process.env.AURA_EVAL_KEEP_WORKSPACE === "1";
const resultsDir = path.resolve(
  interfaceRoot,
  process.env.AURA_EVAL_RESULTS_DIR ?? defaultExternalAgentResultsDir(interfaceRoot),
);

const scenario = getExternalAgentScenario(interfaceRoot, scenarioId);

const adapters = {
  aura: runAuraAdapter,
  "claude-code": runClaudeCodeAdapter,
  codex: runCodexAdapter,
};

async function main() {
  const runAdapter = adapters[adapterId];
  if (!runAdapter) {
    throw new Error(`Unknown adapter "${adapterId}". Expected one of: ${Object.keys(adapters).join(", ")}`);
  }

  await fs.mkdir(resultsDir, { recursive: true });

  const runId = `${scenario.id}-${adapterId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const workspaceDir = path.join(os.tmpdir(), runId);
  await prepareExternalAgentWorkspace(interfaceRoot, scenario, workspaceDir);

  try {
    const result = await runAdapter({
      interfaceRoot,
      scenario,
      workspaceDir,
      resultsDir,
      runId,
      fixtureDir: scenario.fixtureDir,
    });
    const outputPath = path.join(resultsDir, `${runId}.external-benchmark.json`);
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(`${outputPath}\n`);
  } finally {
    if (!keepWorkspace) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  }
}

await main();
