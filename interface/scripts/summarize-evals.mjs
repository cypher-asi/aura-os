import { promises as fs } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const resultsDir = path.resolve(cwd, process.argv[2] ?? "test-results");
const outputJson = path.join(resultsDir, "aura-evals-summary.json");
const outputMarkdown = path.join(resultsDir, "aura-evals-summary.md");

async function walk(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(absolutePath);
    }
    return absolutePath;
  }));

  return files.flat();
}

function inferSuite(payload) {
  if (typeof payload.suite === "string") return payload.suite;
  if (payload.bundle === "deterministic-workflow-mock" || payload.kind === "deterministic_lifecycle") {
    return "workflow";
  }
  if (payload.kind === "live_pipeline" || Array.isArray(payload.canonicalPrompts) || payload.story) {
    return "benchmark";
  }
  return "smoke";
}

function normalizeEntry(payload, filePath) {
  if (!payload || typeof payload !== "object" || typeof payload.scenarioId !== "string") {
    return null;
  }

  const suite = inferSuite(payload);
  const counts = payload.counts ?? {};
  const metrics = payload.metrics ?? {};
  const totalSteps = typeof metrics.totalSteps === "number"
    ? metrics.totalSteps
    : Array.isArray(payload.steps) ? payload.steps.length : 0;
  const failedTasks = Number(counts.failedTasks ?? counts.failed_tasks ?? payload.projectStats?.failed_tasks ?? 0);
  const doneTasks = Number(counts.doneTasks ?? counts.done_tasks ?? payload.projectStats?.done_tasks ?? 0);
  const success = suite === "smoke"
    ? true
    : failedTasks === 0 && (suite !== "benchmark" || doneTasks > 0);

  return {
    scenarioId: payload.scenarioId,
    title: typeof payload.title === "string" ? payload.title : payload.scenarioId,
    suite,
    kind: typeof payload.kind === "string" ? payload.kind : "unknown",
    device: typeof payload.device === "string" ? payload.device : "unknown",
    bundleId: typeof payload.bundleId === "string" ? payload.bundleId : "default",
    success,
    counts: {
      specs: Number(counts.specs ?? payload.projectStats?.total_specs ?? 0),
      tasks: Number(counts.tasks ?? payload.projectStats?.total_tasks ?? 0),
      doneTasks,
      failedTasks,
      artifactChecks: Number(counts.artifactChecks ?? 0),
    },
    metrics: {
      totalDurationMs: Number(metrics.totalDurationMs ?? 0),
      totalSteps,
      totalTokens: Number(metrics.totalTokens ?? 0),
      totalInputTokens: Number(metrics.totalInputTokens ?? 0),
      totalOutputTokens: Number(metrics.totalOutputTokens ?? 0),
      totalCacheCreationInputTokens: Number(metrics.totalCacheCreationInputTokens ?? 0),
      totalCacheReadInputTokens: Number(metrics.totalCacheReadInputTokens ?? 0),
      promptInputFootprintTokens: Number(metrics.promptInputFootprintTokens ?? 0),
      maxEstimatedContextTokens: Number(metrics.maxEstimatedContextTokens ?? 0),
      maxContextUtilization: Number(metrics.maxContextUtilization ?? 0),
      richUsageTurns: Number(metrics.richUsageTurns ?? 0),
      fallbackUsageTurns: Number(metrics.fallbackUsageTurns ?? 0),
      estimatedCostUsd: Number(metrics.estimatedCostUsd ?? 0),
      buildSteps: Number(metrics.buildSteps ?? 0),
      testSteps: Number(metrics.testSteps ?? 0),
      completionPercentage: Number(metrics.completionPercentage ?? payload.projectStats?.completion_percentage ?? 0),
      totalTimeSeconds: Number(metrics.totalTimeSeconds ?? payload.projectStats?.total_time_seconds ?? 0),
    },
    source: path.relative(cwd, filePath),
  };
}

function summarizeSuites(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const bucket = grouped.get(entry.suite) ?? [];
    bucket.push(entry);
    grouped.set(entry.suite, bucket);
  }

  return Object.fromEntries(Array.from(grouped.entries()).map(([suite, items]) => {
    const totals = items.reduce((acc, item) => ({
      scenarios: acc.scenarios + 1,
      passed: acc.passed + (item.success ? 1 : 0),
      failed: acc.failed + (item.success ? 0 : 1),
      durationMs: acc.durationMs + item.metrics.totalDurationMs,
      tokens: acc.tokens + item.metrics.totalTokens,
      inputTokens: acc.inputTokens + item.metrics.totalInputTokens,
      outputTokens: acc.outputTokens + item.metrics.totalOutputTokens,
      cacheCreationInputTokens: acc.cacheCreationInputTokens + item.metrics.totalCacheCreationInputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + item.metrics.totalCacheReadInputTokens,
      promptInputFootprintTokens: acc.promptInputFootprintTokens + item.metrics.promptInputFootprintTokens,
      costUsd: acc.costUsd + item.metrics.estimatedCostUsd,
      buildSteps: acc.buildSteps + item.metrics.buildSteps,
      testSteps: acc.testSteps + item.metrics.testSteps,
      failedTasks: acc.failedTasks + item.counts.failedTasks,
      richUsageTurns: acc.richUsageTurns + item.metrics.richUsageTurns,
      fallbackUsageTurns: acc.fallbackUsageTurns + item.metrics.fallbackUsageTurns,
      maxEstimatedContextTokens: Math.max(acc.maxEstimatedContextTokens, item.metrics.maxEstimatedContextTokens),
      maxContextUtilization: Math.max(acc.maxContextUtilization, item.metrics.maxContextUtilization),
    }), {
      scenarios: 0,
      passed: 0,
      failed: 0,
      durationMs: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      promptInputFootprintTokens: 0,
      costUsd: 0,
      buildSteps: 0,
      testSteps: 0,
      failedTasks: 0,
      richUsageTurns: 0,
      fallbackUsageTurns: 0,
      maxEstimatedContextTokens: 0,
      maxContextUtilization: 0,
    });

    return [suite, {
      ...totals,
      avgDurationMs: totals.scenarios > 0 ? Math.round(totals.durationMs / totals.scenarios) : 0,
      avgTokens: totals.scenarios > 0 ? Math.round(totals.tokens / totals.scenarios) : 0,
      avgCostUsd: totals.scenarios > 0 ? Number((totals.costUsd / totals.scenarios).toFixed(4)) : 0,
    }];
  }));
}

function markdownSummary(summary) {
  const lines = [
    "# Aura Evals Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Scenarios: ${summary.totals.scenarios}`,
    `Passed: ${summary.totals.passed}`,
    `Failed: ${summary.totals.failed}`,
    `Duration (ms): ${summary.totals.durationMs}`,
    `Tokens: ${summary.totals.tokens}`,
    `Estimated Cost (USD): ${summary.totals.costUsd.toFixed(4)}`,
    `Input Tokens: ${summary.totals.inputTokens}`,
    `Output Tokens: ${summary.totals.outputTokens}`,
    `Cache Write Tokens: ${summary.totals.cacheCreationInputTokens}`,
    `Cache Read Tokens: ${summary.totals.cacheReadInputTokens}`,
    `Prompt Footprint Tokens: ${summary.totals.promptInputFootprintTokens}`,
    `Max Estimated Context Tokens: ${summary.totals.maxEstimatedContextTokens}`,
    `Max Context Utilization: ${summary.totals.maxContextUtilization.toFixed(3)}`,
    "",
    "| Suite | Scenarios | Passed | Failed | Duration ms | Tokens | Cost USD |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const [suite, suiteSummary] of Object.entries(summary.suites)) {
    lines.push(
      `| ${suite} | ${suiteSummary.scenarios} | ${suiteSummary.passed} | ${suiteSummary.failed} | ${suiteSummary.durationMs} | ${suiteSummary.tokens} | ${suiteSummary.costUsd.toFixed(4)} |`,
    );
  }

  lines.push("");
  lines.push("| Scenario | Suite | Bundle | Device | Success | Duration ms | Tokens | Cost USD | Failed tasks |");
  lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |");

  for (const entry of summary.scenarios) {
    lines.push(
      `| ${entry.title} | ${entry.suite} | ${entry.bundleId} | ${entry.device} | ${entry.success ? "yes" : "no"} | ${entry.metrics.totalDurationMs} | ${entry.metrics.totalTokens} | ${entry.metrics.estimatedCostUsd.toFixed(4)} | ${entry.counts.failedTasks} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const files = (await walk(resultsDir)).filter((filePath) =>
    filePath.endsWith(".json") && !filePath.includes(`${path.sep}attachments${path.sep}`)
  );
  const entries = [];

  for (const filePath of files) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const payload = JSON.parse(raw);
      const normalized = normalizeEntry(payload, filePath);
      if (normalized) {
        entries.push(normalized);
      }
    } catch {
      // Ignore non-eval JSON artifacts.
    }
  }

  entries.sort((left, right) => left.title.localeCompare(right.title));

  const totals = entries.reduce((acc, entry) => ({
    scenarios: acc.scenarios + 1,
    passed: acc.passed + (entry.success ? 1 : 0),
    failed: acc.failed + (entry.success ? 0 : 1),
    durationMs: acc.durationMs + entry.metrics.totalDurationMs,
    tokens: acc.tokens + entry.metrics.totalTokens,
    inputTokens: acc.inputTokens + entry.metrics.totalInputTokens,
    outputTokens: acc.outputTokens + entry.metrics.totalOutputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens + entry.metrics.totalCacheCreationInputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + entry.metrics.totalCacheReadInputTokens,
    promptInputFootprintTokens: acc.promptInputFootprintTokens + entry.metrics.promptInputFootprintTokens,
    costUsd: acc.costUsd + entry.metrics.estimatedCostUsd,
    richUsageTurns: acc.richUsageTurns + entry.metrics.richUsageTurns,
    fallbackUsageTurns: acc.fallbackUsageTurns + entry.metrics.fallbackUsageTurns,
    maxEstimatedContextTokens: Math.max(acc.maxEstimatedContextTokens, entry.metrics.maxEstimatedContextTokens),
    maxContextUtilization: Math.max(acc.maxContextUtilization, entry.metrics.maxContextUtilization),
  }), {
    scenarios: 0,
    passed: 0,
    failed: 0,
    durationMs: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    promptInputFootprintTokens: 0,
    costUsd: 0,
    richUsageTurns: 0,
    fallbackUsageTurns: 0,
    maxEstimatedContextTokens: 0,
    maxContextUtilization: 0,
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      costUsd: Number(totals.costUsd.toFixed(4)),
    },
    suites: summarizeSuites(entries),
    scenarios: entries,
  };

  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(outputJson, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(outputMarkdown, markdownSummary(summary), "utf8");

  process.stdout.write(`${path.relative(cwd, outputJson)}\n`);
  process.stdout.write(`${path.relative(cwd, outputMarkdown)}\n`);
}

await main();
