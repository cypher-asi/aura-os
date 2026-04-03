import { promises as fs } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const summaryPath = path.resolve(cwd, process.argv[2] ?? "test-results/aura-benchmark-usage-summary.json");
const baselinePath = path.resolve(cwd, process.argv[3]);
const outputPrefix = process.argv[4] ?? "aura-benchmark-usage-compare";

if (!process.argv[3]) {
  throw new Error("Usage: node compare-benchmark-usage.mjs <summary> <baseline> [outputPrefix]");
}

function scenarioKey(entry) {
  return `${entry.scenarioId}:${entry.device}`;
}

function compareScenario(candidate, baseline) {
  const deltas = {
    inputTokens: candidate.totalInputTokens - baseline.totalInputTokens,
    outputTokens: candidate.totalOutputTokens - baseline.totalOutputTokens,
    cacheWriteTokens:
      candidate.totalCacheCreationInputTokens - baseline.totalCacheCreationInputTokens,
    cacheReadTokens: candidate.totalCacheReadInputTokens - baseline.totalCacheReadInputTokens,
    estimatedCostUsd: Number((candidate.estimatedCostUsd - baseline.estimatedCostUsd).toFixed(6)),
    runWallClockMs: candidate.runWallClockMs - baseline.runWallClockMs,
    averageTurnWallClockMs:
      Number((candidate.averageTurnWallClockMs - baseline.averageTurnWallClockMs).toFixed(2)),
    averageTimeToFirstEventMs:
      Number((candidate.averageTimeToFirstEventMs - baseline.averageTimeToFirstEventMs).toFixed(2)),
    promptInputFootprintTokens:
      candidate.promptInputFootprintTokens - baseline.promptInputFootprintTokens,
    maxContextUtilization:
      Number((candidate.maxContextUtilization - baseline.maxContextUtilization).toFixed(4)),
  };

  return {
    title: candidate.title,
    device: candidate.device,
    success: candidate.success,
    baselineSuccess: baseline.success,
    qualityPass: candidate.qualityPass,
    baselineQualityPass: baseline.qualityPass,
    deltas,
  };
}

function toMarkdown(report) {
  const lines = [
    "# Aura Benchmark Usage Comparison",
    "",
    `Summary: ${report.summaryPath}`,
    `Baseline: ${report.baselinePath}`,
    "",
    `Aggregate input token delta: ${report.totals.inputTokens}`,
    `Aggregate output token delta: ${report.totals.outputTokens}`,
    `Aggregate effective cost delta (USD): ${report.totals.estimatedCostUsd.toFixed(4)}`,
    `Aggregate run wall clock delta (ms): ${report.totals.runWallClockMs}`,
    `Aggregate prompt footprint delta: ${report.totals.promptInputFootprintTokens}`,
    `Aggregate cache read delta: ${report.totals.cacheReadTokens}`,
    `Aggregate cache write delta: ${report.totals.cacheWriteTokens}`,
    "",
    "| Scenario | Device | Success | Quality | Cost Δ USD | Run Δ ms | Avg turn Δ ms | TTFE Δ ms | Input Δ | Output Δ | Prompt footprint Δ | Cache read Δ | Cache write Δ | Max context util Δ |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const entry of report.comparisons) {
    lines.push(
      `| ${entry.title} | ${entry.device} | ${entry.success ? "yes" : "no"} | ${entry.qualityPass ? "pass" : "fail"} | ${entry.deltas.estimatedCostUsd.toFixed(4)} | ${entry.deltas.runWallClockMs} | ${entry.deltas.averageTurnWallClockMs.toFixed(2)} | ${entry.deltas.averageTimeToFirstEventMs.toFixed(2)} | ${entry.deltas.inputTokens} | ${entry.deltas.outputTokens} | ${entry.deltas.promptInputFootprintTokens} | ${entry.deltas.cacheReadTokens} | ${entry.deltas.cacheWriteTokens} | ${entry.deltas.maxContextUtilization.toFixed(4)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [summaryRaw, baselineRaw] = await Promise.all([
    fs.readFile(summaryPath, "utf8"),
    fs.readFile(baselinePath, "utf8"),
  ]);

  const summary = JSON.parse(summaryRaw);
  const baseline = JSON.parse(baselineRaw);
  const baselineMap = new Map((baseline.scenarios ?? []).map((entry) => [scenarioKey(entry), entry]));
  const comparisons = [];

  for (const scenario of summary.scenarios ?? []) {
    const baselineScenario = baselineMap.get(scenarioKey(scenario));
    if (!baselineScenario) continue;
    comparisons.push(compareScenario(scenario, baselineScenario));
  }

  const totals = comparisons.reduce((acc, entry) => ({
    inputTokens: acc.inputTokens + entry.deltas.inputTokens,
    outputTokens: acc.outputTokens + entry.deltas.outputTokens,
    estimatedCostUsd: acc.estimatedCostUsd + entry.deltas.estimatedCostUsd,
    runWallClockMs: acc.runWallClockMs + entry.deltas.runWallClockMs,
    promptInputFootprintTokens:
      acc.promptInputFootprintTokens + entry.deltas.promptInputFootprintTokens,
    cacheReadTokens: acc.cacheReadTokens + entry.deltas.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + entry.deltas.cacheWriteTokens,
  }), {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    runWallClockMs: 0,
    promptInputFootprintTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    summaryPath: path.relative(cwd, summaryPath),
    baselinePath: path.relative(cwd, baselinePath),
    totals,
    comparisons,
  };

  const outputJson = path.resolve(cwd, "test-results", `${outputPrefix}.json`);
  const outputMarkdown = path.resolve(cwd, "test-results", `${outputPrefix}.md`);
  await fs.mkdir(path.dirname(outputJson), { recursive: true });
  await fs.writeFile(outputJson, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(outputMarkdown, toMarkdown(report), "utf8");

  process.stdout.write(`${path.relative(cwd, outputJson)}\n`);
  process.stdout.write(`${path.relative(cwd, outputMarkdown)}\n`);
}

await main();
