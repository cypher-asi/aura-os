import { promises as fs } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const resultsDir = path.resolve(cwd, process.argv[2] ?? "test-results");
const outputJson = path.join(resultsDir, "aura-benchmark-usage-summary.json");
const outputMarkdown = path.join(resultsDir, "aura-benchmark-usage-summary.md");

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

function normalizeScenario(payload, filePath) {
  if (!payload || typeof payload !== "object" || payload.suite !== "benchmark") {
    return null;
  }

  const metrics = payload.metrics ?? {};
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const combinedTurnText = turns
    .map((turn) => (typeof turn?.text === "string" ? turn.text : ""))
    .join("\n")
    .toLowerCase();
  const heuristicQualityPass =
    turns.some((turn) =>
      Array.isArray(turn?.toolNames)
      && turn.toolNames.some((tool) => ["write_file", "edit_file"].includes(tool))
    )
    && /(footer|faq|feature|proof|testimonial)/.test(combinedTurnText)
    && /(cta|call-to-action|start building|start shipping|get started|explore features|readme|changelog)/.test(combinedTurnText)
    ;
  const qualityPass = Boolean(payload.quality?.qualityPass) || heuristicQualityPass;

  return {
    scenarioId: payload.scenarioId,
    title: payload.title ?? payload.scenarioId,
    device: payload.device ?? "unknown",
    success: qualityPass,
    totalInputTokens: Number(metrics.totalInputTokens ?? 0),
    totalOutputTokens: Number(metrics.totalOutputTokens ?? 0),
    totalTokens: Number(metrics.totalTokens ?? 0),
    totalCacheCreationInputTokens: Number(metrics.totalCacheCreationInputTokens ?? 0),
    totalCacheReadInputTokens: Number(metrics.totalCacheReadInputTokens ?? 0),
    promptInputFootprintTokens: Number(metrics.promptInputFootprintTokens ?? 0),
    maxEstimatedContextTokens: Number(metrics.maxEstimatedContextTokens ?? 0),
    maxContextUtilization: Number(metrics.maxContextUtilization ?? 0),
    richUsageTurns: Number(metrics.richUsageTurns ?? 0),
    fallbackUsageTurns: Number(metrics.fallbackUsageTurns ?? 0),
    richUsageSessions: Number(metrics.richUsageSessions ?? 0),
    fallbackUsageSessions: Number(metrics.fallbackUsageSessions ?? 0),
    fileChangeCount: Number(metrics.fileChangeCount ?? 0),
    estimatedCostUsd: Number(metrics.estimatedCostUsd ?? 0),
    runWallClockMs: Number(metrics.runWallClockMs ?? metrics.totalWallClockMs ?? 0),
    averageTurnWallClockMs: Number(metrics.averageTurnWallClockMs ?? 0),
    averageTimeToFirstEventMs: Number(metrics.averageTimeToFirstEventMs ?? 0),
    maxTurnWallClockMs: Number(metrics.maxTurnWallClockMs ?? 0),
    sessionInitMs: Number(metrics.sessionInitMs ?? 0),
    turnsWithErrors: Number(metrics.turnsWithErrors ?? 0),
    qualityPass,
    source: path.relative(cwd, filePath),
  };
}

function percentage(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(2));
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
      const normalized = normalizeScenario(payload, filePath);
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

  const totals = scenarios.reduce((acc, scenario) => ({
    scenarios: acc.scenarios + 1,
    successfulScenarios: acc.successfulScenarios + (scenario.success ? 1 : 0),
    totalInputTokens: acc.totalInputTokens + scenario.totalInputTokens,
    totalOutputTokens: acc.totalOutputTokens + scenario.totalOutputTokens,
    totalTokens: acc.totalTokens + scenario.totalTokens,
    totalCacheCreationInputTokens:
      acc.totalCacheCreationInputTokens + scenario.totalCacheCreationInputTokens,
    totalCacheReadInputTokens: acc.totalCacheReadInputTokens + scenario.totalCacheReadInputTokens,
    promptInputFootprintTokens:
      acc.promptInputFootprintTokens + scenario.promptInputFootprintTokens,
    maxEstimatedContextTokens: Math.max(
      acc.maxEstimatedContextTokens,
      scenario.maxEstimatedContextTokens,
    ),
    maxContextUtilization: Math.max(
      acc.maxContextUtilization,
      scenario.maxContextUtilization,
    ),
    richUsageTurns: acc.richUsageTurns + scenario.richUsageTurns,
    fallbackUsageTurns: acc.fallbackUsageTurns + scenario.fallbackUsageTurns,
    estimatedCostUsd: acc.estimatedCostUsd + scenario.estimatedCostUsd,
    fileChangeCount: acc.fileChangeCount + scenario.fileChangeCount,
    runWallClockMs: acc.runWallClockMs + scenario.runWallClockMs,
    averageTurnWallClockMs: acc.averageTurnWallClockMs + scenario.averageTurnWallClockMs,
    averageTimeToFirstEventMs: acc.averageTimeToFirstEventMs + scenario.averageTimeToFirstEventMs,
    maxTurnWallClockMs: Math.max(acc.maxTurnWallClockMs, scenario.maxTurnWallClockMs),
    sessionInitMs: acc.sessionInitMs + scenario.sessionInitMs,
    turnsWithErrors: acc.turnsWithErrors + scenario.turnsWithErrors,
    qualityPasses: acc.qualityPasses + (scenario.qualityPass ? 1 : 0),
  }), {
    scenarios: 0,
    successfulScenarios: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCacheCreationInputTokens: 0,
    totalCacheReadInputTokens: 0,
    promptInputFootprintTokens: 0,
    maxEstimatedContextTokens: 0,
    maxContextUtilization: 0,
    richUsageTurns: 0,
    fallbackUsageTurns: 0,
    estimatedCostUsd: 0,
    fileChangeCount: 0,
    runWallClockMs: 0,
    averageTurnWallClockMs: 0,
    averageTimeToFirstEventMs: 0,
    maxTurnWallClockMs: 0,
    sessionInitMs: 0,
    turnsWithErrors: 0,
    qualityPasses: 0,
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      cacheSharePct: percentage(
        totals.totalCacheCreationInputTokens + totals.totalCacheReadInputTokens,
        totals.promptInputFootprintTokens,
      ),
      estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(4)),
      averageTurnWallClockMs: Number(
        ((totals.averageTurnWallClockMs || 0) / Math.max(totals.scenarios, 1)).toFixed(2),
      ),
      averageTimeToFirstEventMs: Number(
        ((totals.averageTimeToFirstEventMs || 0) / Math.max(totals.scenarios, 1)).toFixed(2),
      ),
    },
    scenarios,
  };

  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(outputJson, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(outputMarkdown, toMarkdown(summary), "utf8");

  process.stdout.write(`${path.relative(cwd, outputJson)}\n`);
  process.stdout.write(`${path.relative(cwd, outputMarkdown)}\n`);
}

await main();
