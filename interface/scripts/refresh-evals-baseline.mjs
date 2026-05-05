import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const VALID_LANES = new Set(["smoke", "workflow"]);

function usage(message) {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "Usage: node ./scripts/refresh-evals-baseline.mjs <smoke|workflow> [summaryPath]\n",
  );
  process.exit(1);
}

function scenarioKey(entry) {
  return `${entry.suite}:${entry.scenarioId}:${entry.device}`;
}

async function main() {
  const [lane, summaryArg] = process.argv.slice(2);
  if (!lane || !VALID_LANES.has(lane)) {
    usage(`Unknown lane "${lane ?? ""}".`);
  }

  const cwd = process.cwd();
  const summaryPath = path.resolve(cwd, summaryArg ?? "test-results/aura-evals-summary.json");
  const baselinePath = path.resolve(
    cwd,
    "..",
    "infra",
    "evals",
    "reports",
    "baselines",
    `${lane}-summary.json`,
  );

  let raw;
  try {
    raw = await fs.readFile(summaryPath, "utf8");
  } catch (error) {
    usage(`Unable to read summary at ${summaryPath}: ${error.message}`);
  }

  let summary;
  try {
    summary = JSON.parse(raw);
  } catch (error) {
    usage(`Summary at ${summaryPath} is not valid JSON: ${error.message}`);
  }

  const candidates = Array.isArray(summary?.scenarios) ? summary.scenarios : [];
  const laneScenarios = candidates
    .filter((entry) => entry?.suite === lane)
    .sort((left, right) => scenarioKey(left).localeCompare(scenarioKey(right)));

  if (laneScenarios.length === 0) {
    usage(
      `Summary at ${summaryPath} has no "${lane}" scenarios. Run "npm run test:evals:${lane}" first.`,
    );
  }

  const baseline = {
    generatedAt: new Date().toISOString(),
    scenarios: laneScenarios,
  };

  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  process.stdout.write(`${path.relative(cwd, baselinePath)}\n`);
  process.stdout.write(`Wrote ${laneScenarios.length} ${lane} scenario(s).\n`);
}

await main();
