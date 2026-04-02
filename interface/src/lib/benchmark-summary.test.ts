import { describe, expect, it } from "vitest";

import {
  assertNoUnknownPricing,
  buildSummary,
  normalizeScenario,
} from "../../scripts/lib/benchmark-summary.mjs";

describe("benchmark summary", () => {
  it("captures unknown pricing sources from turn pricing", () => {
    const normalized = normalizeScenario({
      suite: "benchmark",
      scenarioId: "demo",
      title: "Demo",
      device: "local",
      metrics: {
        totalInputTokens: 1,
        totalOutputTokens: 2,
        estimatedCostUsd: 0,
      },
      turns: [
        {
          text: "done",
          pricing: {
            source: "unknown-pricing",
          },
        },
      ],
      quality: {
        qualityPass: true,
      },
    }, "/tmp/demo.json", "/tmp");

    expect(normalized?.hasUnknownPricing).toBe(true);
    expect(normalized?.pricingSources).toContain("unknown-pricing");
  });

  it("throws when priced runs are required and unknown pricing is present", () => {
    const summary = buildSummary([
      {
        scenarioId: "demo",
        title: "Demo",
        device: "local",
        success: true,
        totalInputTokens: 1,
        totalOutputTokens: 2,
        totalTokens: 3,
        totalCacheCreationInputTokens: 0,
        totalCacheReadInputTokens: 0,
        promptInputFootprintTokens: 1,
        maxEstimatedContextTokens: 0,
        maxContextUtilization: 0,
        richUsageTurns: 1,
        fallbackUsageTurns: 0,
        richUsageSessions: 1,
        fallbackUsageSessions: 0,
        fileChangeCount: 0,
        estimatedCostUsd: 0,
        runWallClockMs: 100,
        averageTurnWallClockMs: 100,
        averageTimeToFirstEventMs: 10,
        maxTurnWallClockMs: 100,
        sessionInitMs: 1,
        turnsWithErrors: 0,
        qualityPass: true,
        source: "demo.json",
        pricingSources: ["unknown-pricing"],
        hasUnknownPricing: true,
        cacheSharePct: 0,
      },
    ]);

    expect(() => assertNoUnknownPricing(summary)).toThrow(/unknown pricing/i);
    expect(summary.totals.unknownPricingScenarios).toBe(1);
  });
});
