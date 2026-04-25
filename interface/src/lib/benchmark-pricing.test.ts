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

  it("does not double-charge DeepSeek cache-hit input tokens", () => {
    const { estimatedCostUsd, pricing } = calculateEstimatedCostUsd({
      model: "aura-deepseek-v4-pro",
      provider: "deepseek",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });

    expect(pricing.source).toBe("deepseek-pricing");
    expect(estimatedCostUsd).toBeCloseTo(1.885, 6);
  });

  it("resolves OpenAI codex pricing when the model is known", () => {
    const pricing = resolvePricing("gpt-5.3-codex", "openai");

    expect(pricing.source).toBe("openai-pricing");
    expect(pricing.input).toBe(1.75);
    expect(pricing.cacheRead).toBe(0.175);
    expect(pricing.output).toBe(14);
  });

  it("resolves GPT-5.5 pricing for OpenAI model IDs", () => {
    const pricing = resolvePricing("openai/gpt-5.5", "openai");

    expect(pricing.source).toBe("openai-pricing");
    expect(pricing.model).toBe("gpt-5.5");
    expect(pricing.input).toBe(5);
    expect(pricing.cacheRead).toBe(0.5);
    expect(pricing.output).toBe(30);
  });

  it("resolves GPT-5.5 pricing for Aura-managed model IDs", () => {
    const pricing = resolvePricing("aura-gpt-5-5");

    expect(pricing.provider).toBe("openai");
    expect(pricing.source).toBe("openai-pricing");
    expect(pricing.model).toBe("gpt-5.5");
    expect(pricing.input).toBe(5);
    expect(pricing.output).toBe(30);
  });

  it("resolves Kimi pricing for Aura-managed Fireworks model IDs", () => {
    const pricing = resolvePricing("aura-kimi-k2-6");

    expect(pricing.provider).toBe("fireworks");
    expect(pricing.source).toBe("fireworks-pricing");
    expect(pricing.model).toBe("kimi-k2p6");
    expect(pricing.input).toBe(0.95);
    expect(pricing.cacheRead).toBe(0.16);
    expect(pricing.output).toBe(4);
  });

  it("resolves Kimi pricing for Fireworks account model IDs", () => {
    const pricing = resolvePricing("accounts/fireworks/models/kimi-k2p5");

    expect(pricing.provider).toBe("fireworks");
    expect(pricing.source).toBe("fireworks-pricing");
    expect(pricing.model).toBe("kimi-k2p5");
    expect(pricing.input).toBe(0.6);
    expect(pricing.cacheRead).toBe(0.1);
    expect(pricing.output).toBe(3);
  });

  it("resolves Kimi pricing for Fireworks router model IDs", () => {
    const pricing = resolvePricing("accounts/fireworks/routers/kimi-k2p6-turbo");

    expect(pricing.provider).toBe("fireworks");
    expect(pricing.source).toBe("fireworks-pricing");
    expect(pricing.model).toBe("kimi-k2p6-turbo");
    expect(pricing.input).toBe(2);
    expect(pricing.cacheRead).toBe(0.3);
    expect(pricing.output).toBe(8);
  });

  it.each([
    ["aura-deepseek-v4-pro", "deepseek-v4-pro", 1.74, 0.145, 3.48],
    ["aura-deepseek-v4-flash", "deepseek-v4-flash", 0.14, 0.028, 0.28],
    ["deepseek-v4-pro", "deepseek-v4-pro", 1.74, 0.145, 3.48],
    ["deepseek-v4-flash", "deepseek-v4-flash", 0.14, 0.028, 0.28],
    ["deepseek/deepseek-v4-flash", "deepseek-v4-flash", 0.14, 0.028, 0.28],
  ])(
    "resolves direct DeepSeek pricing for %s",
    (modelId, expectedModel, input, cacheRead, output) => {
      const pricing = resolvePricing(modelId);

      expect(pricing.provider).toBe("deepseek");
      expect(pricing.source).toBe("deepseek-pricing");
      expect(pricing.model).toBe(expectedModel);
      expect(pricing.input).toBe(input);
      expect(pricing.cacheRead).toBe(cacheRead);
      expect(pricing.output).toBe(output);
    },
  );

  it.each([
    ["aura-kimi-k2-5", "kimi-k2p5", 0.6, 0.1, 3],
    ["aura-kimi-k2-6", "kimi-k2p6", 0.95, 0.16, 4],
    ["aura-oss-120b", "gpt-oss-120b", 0.15, 0.01, 0.6],
    ["accounts/fireworks/models/kimi-k2p5", "kimi-k2p5", 0.6, 0.1, 3],
    ["accounts/fireworks/models/kimi-k2p6", "kimi-k2p6", 0.95, 0.16, 4],
    ["accounts/fireworks/models/gpt-oss-120b", "gpt-oss-120b", 0.15, 0.01, 0.6],
  ])(
    "resolves explicit Fireworks pricing for %s",
    (modelId, expectedModel, input, cacheRead, output) => {
      const pricing = resolvePricing(modelId);

      expect(pricing.provider).toBe("fireworks");
      expect(pricing.source).toBe("fireworks-pricing");
      expect(pricing.model).toBe(expectedModel);
      expect(pricing.input).toBe(input);
      expect(pricing.cacheRead).toBe(cacheRead);
      expect(pricing.output).toBe(output);
    },
  );
});
