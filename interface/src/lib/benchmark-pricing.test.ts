import { describe, expect, it } from "vitest";

import {
  calculateEstimatedCostUsd,
  resolvePricing,
} from "../../scripts/lib/benchmark-pricing.mjs";

describe("benchmark pricing", () => {
  it("matches Anthropic family variants by prefix", () => {
    const pricing = resolvePricing("claude-sonnet-4-5-20250220", "anthropic");

    expect(pricing.source).toBe("anthropic-pricing-family-match");
    expect(pricing.model).toBe("claude-sonnet-4-5");
    expect(pricing.input).toBe(3);
    expect(pricing.cacheWrite).toBe(3.75);
    expect(pricing.cacheRead).toBe(0.3);
  });

  it("marks unknown pricing explicitly instead of silently dropping it", () => {
    const pricing = resolvePricing("claude-unknown-next", "anthropic");

    expect(pricing.source).toBe("unknown-pricing");
    expect(pricing.input).toBe(0);
    expect(pricing.output).toBe(0);
  });

  it("includes cache tokens in the estimated cost", () => {
    const { estimatedCostUsd, pricing } = calculateEstimatedCostUsd({
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheCreationInputTokens: 500_000,
      cacheReadInputTokens: 1_000_000,
    });

    expect(pricing.source).toBe("anthropic-pricing");
    expect(estimatedCostUsd).toBeCloseTo(12.675, 6);
  });

  it("resolves OpenAI codex pricing when the model is known", () => {
    const pricing = resolvePricing("gpt-5.3-codex", "openai");

    expect(pricing.source).toBe("openai-pricing");
    expect(pricing.input).toBe(1.75);
    expect(pricing.cacheRead).toBe(0.175);
    expect(pricing.output).toBe(14);
  });
});
