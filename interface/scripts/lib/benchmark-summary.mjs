import path from "node:path";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizeScenario(payload, filePath, cwd) {
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
    && /(cta|call-to-action|start building|start shipping|get started|explore features|readme|changelog)/.test(combinedTurnText);
  const qualityPass = Boolean(payload.quality?.qualityPass) || heuristicQualityPass;

  const metricPricingSources = Array.isArray(metrics.pricingSources)
    ? metrics.pricingSources.filter((value) => typeof value === "string" && value.trim())
    : [];
  const turnPricingSources = turns
    .map((turn) => asRecord(turn?.pricing)?.source)
    .filter((value) => typeof value === "string" && value.trim());
  const pricingSources = Array.from(new Set([...metricPricingSources, ...turnPricingSources])).sort();

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
    pricingSources,
    hasUnknownPricing: pricingSources.includes("unknown-pricing"),
    source: path.relative(cwd, filePath),
  };
}

export function percentage(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(2));
}

export function buildSummary(scenarios) {
  const pricingSources = new Set();

  const totals = scenarios.reduce((acc, scenario) => {
    for (const source of scenario.pricingSources ?? []) {
      pricingSources.add(source);
    }

    return {
      scenarios: acc.scenarios + 1,
      successfulScenarios: acc.successfulScenarios + (scenario.success ? 1 : 0),
      totalInputTokens: acc.totalInputTokens + scenario.totalInputTokens,
      totalOutputTokens: acc.totalOutputTokens + scenario.totalOutputTokens,
      totalTokens: acc.totalTokens + scenario.totalTokens,
      totalCacheCreationInputTokens:
        acc.totalCacheCreationInputTokens + scenario.totalCacheCreationInputTokens,
      totalCacheReadInputTokens:
        acc.totalCacheReadInputTokens + scenario.totalCacheReadInputTokens,
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
      averageTimeToFirstEventMs:
        acc.averageTimeToFirstEventMs + scenario.averageTimeToFirstEventMs,
      maxTurnWallClockMs: Math.max(acc.maxTurnWallClockMs, scenario.maxTurnWallClockMs),
      sessionInitMs: acc.sessionInitMs + scenario.sessionInitMs,
      turnsWithErrors: acc.turnsWithErrors + scenario.turnsWithErrors,
      qualityPasses: acc.qualityPasses + (scenario.qualityPass ? 1 : 0),
      unknownPricingScenarios:
        acc.unknownPricingScenarios + (scenario.hasUnknownPricing ? 1 : 0),
    };
  }, {
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
    unknownPricingScenarios: 0,
  });

  return {
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
      pricingSources: Array.from(pricingSources).sort(),
    },
    scenarios,
  };
}

export function assertNoUnknownPricing(summary) {
  if ((summary?.totals?.unknownPricingScenarios ?? 0) > 0) {
    throw new Error(
      `Benchmark summary contains ${summary.totals.unknownPricingScenarios} scenario(s) with unknown pricing`,
    );
  }
}
