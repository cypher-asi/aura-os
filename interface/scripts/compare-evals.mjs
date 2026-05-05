import { promises as fs } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const summaryPath = path.resolve(cwd, process.argv[2] ?? "test-results/aura-evals-summary.json");
const baselinePath = path.resolve(cwd, process.argv[3] ?? "../infra/evals/reports/baselines/workflow-summary.json");
const outputPrefix = process.argv[4] ?? "aura-evals-compare";

function scenarioKey(entry) {
  return `${entry.suite}:${entry.scenarioId}:${entry.device}`;
}

function compareScenario(candidate, baseline) {
  const blocking = [];
  const warnings = [];

  if (!candidate.success && baseline.success) {
    blocking.push("scenario no longer passes");
  }

  if ((candidate.counts.failedTasks ?? 0) > (baseline.counts.failedTasks ?? 0)) {
    blocking.push(`failed tasks increased from ${baseline.counts.failedTasks} to ${candidate.counts.failedTasks}`);
  }

  if ((candidate.metrics.completionPercentage ?? 0) < (baseline.metrics.completionPercentage ?? 0)) {
    blocking.push(
      `completion dropped from ${baseline.metrics.completionPercentage}% to ${candidate.metrics.completionPercentage}%`,
    );
  }

  // Smoke scenarios are browser-only with no model-backed work, so build/test
  // step counts and token/cost metrics are always 0 in the baseline. Comparing
  // them just adds false-positive surface area when a future scenario starts
  // measuring something — keep the thresholds for the workflow lane only.
  if (baseline.suite !== "smoke") {
    if ((candidate.metrics.buildSteps ?? 0) < (baseline.metrics.buildSteps ?? 0)) {
      blocking.push(`build steps dropped from ${baseline.metrics.buildSteps} to ${candidate.metrics.buildSteps}`);
    }

    if ((candidate.metrics.testSteps ?? 0) < (baseline.metrics.testSteps ?? 0)) {
      blocking.push(`test steps dropped from ${baseline.metrics.testSteps} to ${candidate.metrics.testSteps}`);
    }

    if ((candidate.metrics.totalTokens ?? 0) > (baseline.metrics.totalTokens ?? 0) * 1.1) {
      blocking.push(`tokens increased from ${baseline.metrics.totalTokens} to ${candidate.metrics.totalTokens}`);
    }

    if ((candidate.metrics.estimatedCostUsd ?? 0) > (baseline.metrics.estimatedCostUsd ?? 0) * 1.1) {
      blocking.push(`cost increased from ${baseline.metrics.estimatedCostUsd} to ${candidate.metrics.estimatedCostUsd}`);
    }
  }

  // Skip the duration warning if the baseline doesn't have a measured value
  // yet (0). Otherwise any non-zero candidate duration is "infinity-x" larger
  // and we'd warn on every run until someone refreshes the baseline.
  const baselineDuration = baseline.metrics.totalDurationMs ?? 0;
  if (baselineDuration > 0 && (candidate.metrics.totalDurationMs ?? 0) > baselineDuration * 1.5) {
    warnings.push(`duration increased from ${baselineDuration}ms to ${candidate.metrics.totalDurationMs}ms`);
  }

  return { blocking, warnings };
}

function toMarkdown(report) {
  const lines = [
    "# Aura Eval Comparison",
    "",
    `Summary: ${report.summaryPath}`,
    `Baseline: ${report.baselinePath}`,
    "",
    `Blocking regressions: ${report.blockingRegressions.length}`,
    `Warnings: ${report.warnings.length}`,
    "",
  ];

  if (report.staleBaseline) {
    lines.push(
      "> **Stale baseline detected.** Most baseline scenarios were not found in the candidate run, which usually means a scenario `id` was renamed without refreshing the baseline. Run `npm run evals:refresh-baseline <lane>` to regenerate.",
    );
    lines.push("");
  }

  if (report.blockingRegressions.length > 0) {
    lines.push("## Blocking");
    lines.push("");
    for (const item of report.blockingRegressions) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const item of report.warnings) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("## Scenarios");
  lines.push("");
  lines.push("| Scenario | Device | Status | Notes |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of report.comparisons) {
    const notes = [...entry.blocking, ...entry.warnings].join("; ") || "no regressions";
    lines.push(`| ${entry.title} | ${entry.device} | ${entry.status} | ${notes} |`);
  }

  return `${lines.join("\n")}\n`;
}

function inferLaneFromBaseline(baselinePath) {
  const base = path.basename(baselinePath);
  const match = base.match(/^([a-z0-9-]+)-summary\.json$/i);
  return match ? match[1] : null;
}

async function main() {
  const [summaryRaw, baselineRaw] = await Promise.all([
    fs.readFile(summaryPath, "utf8"),
    fs.readFile(baselinePath, "utf8"),
  ]);

  const summary = JSON.parse(summaryRaw);
  const baseline = JSON.parse(baselineRaw);
  const summaryMap = new Map((summary.scenarios ?? []).map((entry) => [scenarioKey(entry), entry]));
  const baselineEntries = baseline.scenarios ?? [];

  const comparisons = [];
  const blockingRegressions = [];
  const warnings = [];
  const missingScenarios = [];

  for (const baselineEntry of baselineEntries) {
    const candidate = summaryMap.get(scenarioKey(baselineEntry));
    if (!candidate) {
      const message = `missing scenario ${baselineEntry.title} (${baselineEntry.device})`;
      missingScenarios.push(message);
      blockingRegressions.push(message);
      comparisons.push({
        title: baselineEntry.title,
        device: baselineEntry.device,
        status: "missing",
        blocking: [message],
        warnings: [],
      });
      continue;
    }

    const result = compareScenario(candidate, baselineEntry);
    blockingRegressions.push(...result.blocking.map((message) => `${baselineEntry.title} (${baselineEntry.device}): ${message}`));
    warnings.push(...result.warnings.map((message) => `${baselineEntry.title} (${baselineEntry.device}): ${message}`));

    comparisons.push({
      title: baselineEntry.title,
      device: baselineEntry.device,
      status: result.blocking.length > 0 ? "regressed" : result.warnings.length > 0 ? "warning" : "ok",
      blocking: result.blocking,
      warnings: result.warnings,
    });
  }

  // Detect baseline drift: if at least half of the baseline scenarios are
  // missing in the candidate AND the candidate produced roughly the same
  // total number of scenarios, the most likely cause is that scenario IDs
  // were renamed in the source-of-truth JSON without refreshing the
  // baseline. Surface this with a single actionable message instead of N
  // noisy "missing scenario" lines, which previously read like real
  // regressions.
  const candidateCount = summaryMap.size;
  const missingCount = missingScenarios.length;
  const baselineCount = baselineEntries.length;
  const lane = inferLaneFromBaseline(baselinePath);
  const isStaleBaseline =
    baselineCount > 0
    && missingCount >= Math.ceil(baselineCount / 2)
    && Math.abs(candidateCount - baselineCount) <= Math.max(1, Math.floor(baselineCount * 0.25));

  if (isStaleBaseline) {
    const refreshHint = lane
      ? `npm run test:evals:${lane} && npm run evals:refresh-baseline ${lane}`
      : "npm run test:evals:<lane> && npm run evals:refresh-baseline <lane>";
    process.stderr.write(
      `\n[stale-baseline] ${missingCount}/${baselineCount} baseline scenarios were not found in the candidate run.\n`
      + "The scenario IDs likely changed since the baseline was last regenerated.\n"
      + `Run:\n    ${refreshHint}\n`
      + "to refresh the baseline, then re-run compare.\n\n",
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summaryPath: path.relative(cwd, summaryPath),
    baselinePath: path.relative(cwd, baselinePath),
    staleBaseline: isStaleBaseline,
    blockingRegressions,
    warnings,
    comparisons,
  };

  const outputJson = path.resolve(cwd, "test-results", `${outputPrefix}.json`);
  const outputMarkdown = path.resolve(cwd, "test-results", `${outputPrefix}.md`);
  await fs.mkdir(path.dirname(outputJson), { recursive: true });
  await fs.writeFile(outputJson, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(outputMarkdown, toMarkdown(report), "utf8");

  process.stdout.write(`${path.relative(cwd, outputJson)}\n`);
  process.stdout.write(`${path.relative(cwd, outputMarkdown)}\n`);

  if (blockingRegressions.length > 0) {
    process.exitCode = 1;
  }
}

await main();
