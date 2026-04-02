import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertNoUnknownPricing,
  buildSummary,
  normalizeScenario,
  percentage,
} from "./lib/benchmark-summary.mjs";

const cwd = process.cwd();
const resultsDir = path.resolve(cwd, process.argv[2] ?? "test-results");
const outputJson = path.join(resultsDir, "aura-benchmark-usage-summary.json");
const outputMarkdown = path.join(resultsDir, "aura-benchmark-usage-summary.md");
const requirePricedRuns = process.env.AURA_EVAL_REQUIRE_PRICED_RUNS === "1";

async function walk(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return absolutePath;
  }));

  return files.flat();
}

function toMarkdown(summary) {
  const lines = [
    "# Aura Benchmark Usage Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Scenarios: ${summary.totals.scenarios}`,
    `Successful scenarios: ${summary.totals.successfulScenarios}`,
    `Input tokens: ${summary.totals.totalInputTokens}`,
    `Output tokens: ${summary.totals.totalOutputTokens}`,
    `Cache write tokens: ${summary.totals.totalCacheCreationInputTokens}`,
    `Cache read tokens: ${summary.totals.totalCacheReadInputTokens}`,
    `Prompt footprint tokens: ${summary.totals.promptInputFootprintTokens}`,
    `Cache share of prompt footprint: ${summary.totals.cacheSharePct.toFixed(2)}%`,
    `Estimated effective cost (USD): ${summary.totals.estimatedCostUsd.toFixed(4)}`,
    `Unknown pricing scenarios: ${summary.totals.unknownPricingScenarios}`,
    `Pricing sources: ${(summary.totals.pricingSources ?? []).join(", ") || "none"}`,
    `Run wall clock (ms): ${summary.totals.runWallClockMs}`,
    `Average turn wall clock (ms): ${summary.totals.averageTurnWallClockMs.toFixed(2)}`,
    `Average time to first event (ms): ${summary.totals.averageTimeToFirstEventMs.toFixed(2)}`,
    `Max estimated context tokens: ${summary.totals.maxEstimatedContextTokens}`,
    `Max context utilization: ${summary.totals.maxContextUtilization.toFixed(3)}`,
    "",
    "| Scenario | Success | Quality | Cost USD | Run ms | Input | Output | Cache write | Cache read | Prompt footprint | Cache share % | Max context util |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const scenario of summary.scenarios) {
    lines.push(
      `| ${scenario.title} | ${scenario.success ? "yes" : "no"} | ${scenario.qualityPass ? "pass" : "fail"} | ${scenario.estimatedCostUsd.toFixed(4)} | ${scenario.runWallClockMs} | ${scenario.totalInputTokens} | ${scenario.totalOutputTokens} | ${scenario.totalCacheCreationInputTokens} | ${scenario.totalCacheReadInputTokens} | ${scenario.promptInputFootprintTokens} | ${scenario.cacheSharePct.toFixed(2)} | ${scenario.maxContextUtilization.toFixed(3)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const files = (await walk(resultsDir)).filter((filePath) =>
    filePath.endsWith(".json") && !filePath.includes(`${path.sep}attachments${path.sep}`)
  );

  const scenarios = [];
  for (const filePath of files) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const payload = JSON.parse(raw);
      const normalized = normalizeScenario(payload, filePath, cwd);
      if (!normalized) continue;
      scenarios.push({
        ...normalized,
        cacheSharePct: percentage(
          normalized.totalCacheCreationInputTokens + normalized.totalCacheReadInputTokens,
          normalized.promptInputFootprintTokens,
        ),
      });
    } catch {
      // Ignore non-benchmark artifacts.
    }
  }

  scenarios.sort((left, right) => left.title.localeCompare(right.title));

  const summary = buildSummary(scenarios);

  if (requirePricedRuns) {
    assertNoUnknownPricing(summary);
  }

  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(outputJson, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(outputMarkdown, toMarkdown(summary), "utf8");

  process.stdout.write(`${path.relative(cwd, outputJson)}\n`);
  process.stdout.write(`${path.relative(cwd, outputMarkdown)}\n`);
}

await main();
