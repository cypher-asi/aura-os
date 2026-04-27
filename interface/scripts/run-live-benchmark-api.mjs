import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBenchmarkClient, runScenario } from "./lib/benchmark-api-runner.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const interfaceRoot = path.resolve(currentDir, "..");
const scenariosPath = path.join(interfaceRoot, "tests/e2e/evals/scenarios/live-benchmark.json");
const fixturesDir = path.join(interfaceRoot, "tests/e2e/evals/fixtures");
const resultsDir = path.join(interfaceRoot, "test-results");

const apiBaseUrl = process.env.AURA_EVAL_API_BASE_URL?.trim()
  || process.env.AURA_EVAL_BASE_URL?.trim()
  || "http://127.0.0.1:3190";
const storageUrl = process.env.AURA_EVAL_STORAGE_URL?.trim() || "";
const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
const verbose = process.env.AURA_EVAL_VERBOSE === "1";

if (!accessToken) {
  throw new Error("Set AURA_EVAL_ACCESS_TOKEN before running the API benchmark.");
}

const grepPattern = process.argv[2]?.trim() || "";

async function main() {
  const client = createBenchmarkClient({
    apiBaseUrl,
    accessToken,
    storageUrl,
    verbose,
  });

  const scenarios = JSON.parse(await fs.readFile(scenariosPath, "utf8"));
  const selected = scenarios.filter((scenario) => {
    if (!grepPattern) return true;
    const haystack = `${scenario.id} ${scenario.title}`.toLowerCase();
    return haystack.includes(grepPattern.toLowerCase());
  });

  if (selected.length === 0) {
    throw new Error(`No benchmark scenarios matched "${grepPattern}"`);
  }

  await fs.mkdir(resultsDir, { recursive: true });

  for (const scenario of selected) {
    const payload = await runScenario(scenario, {
      client,
      fixturesDir,
    });
    const outputPath = path.join(resultsDir, `${scenario.id}.api-benchmark.json`);
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    client.logStep("scenario complete", { outputPath });
    process.stdout.write(`${path.relative(interfaceRoot, outputPath)}\n`);
  }
}

await main();
