import { describe, expect, it } from "vitest";

import {
  LLM_MARKUP_MULTIPLIER,
  computeSessionCost,
  getBilledPricing,
  normalizePricingKey,
  resolvePricing,
} from "./model-pricing";

describe("normalizePricingKey", () => {
  it("maps aura-managed ids to provider pricing keys", () => {
    expect(normalizePricingKey("aura-claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(normalizePricingKey("aura-claude-fable-5")).toBe("claude-fable-5");
    expect(normalizePricingKey("aura-gpt-5-5")).toBe("gpt-5.5");
    expect(normalizePricingKey("aura-gpt-5-4-mini")).toBe("gpt-5.4-mini");
    expect(normalizePricingKey("aura-kimi-k2-6")).toBe("kimi-k2p6");
    expect(normalizePricingKey("aura-deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(normalizePricingKey("aura-gemini-2-5-pro")).toBe("gemini-2.5-pro");
    expect(normalizePricingKey("aura-gemini-3-1-flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(normalizePricingKey("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro");
  });
});

describe("resolvePricing for Google Gemini", () => {
  it("resolves gemini aliases and raw names to the google table", () => {
    const viaAlias = resolvePricing("aura-gemini-2-5-pro");
    expect(viaAlias.provider).toBe("google");
    expect(viaAlias.input).toBe(1.25);
    expect(viaAlias.output).toBe(10);

    const viaRaw = resolvePricing("gemini-2.5-pro", "google");
    expect(viaRaw.input).toBe(viaAlias.input);
    expect(viaRaw.output).toBe(viaAlias.output);
  });

  it("treats cached prompt tokens as already counted in input", () => {
    // gemini-2.5-pro billed: input $1.5/M, output $12/M, cacheRead $0.15/M.
    // 1M prompt incl. 400k cached -> 600k new input + 400k cache read.
    const result = computeSessionCost({
      model: "aura-gemini-2-5-pro",
      provider: "google",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 400_000,
      cacheCreationTokens: 0,
    });
    // 0.6 * 1.5 + 0.5 * 12 + 0.4 * 0.15 = 0.9 + 6 + 0.06 = 6.96
    expect(result.totalCostUsd).toBeCloseTo(6.96, 6);
    expect(result.unknown).toBe(false);
  });
});

describe("getBilledPricing", () => {
  it("resolves Claude Fable 5 at Anthropic's published rates", () => {
    const base = resolvePricing("aura-claude-fable-5");
    expect(base.provider).toBe("anthropic");
    expect(base.model).toBe("claude-fable-5");
    expect(base.input).toBe(10);
    expect(base.output).toBe(50);
    expect(base.cacheWrite).toBe(12.5);
    expect(base.cacheRead).toBe(1);
  });

  it("applies the 20% markup to base rates", () => {
    const base = resolvePricing("aura-claude-opus-4-8");
    const billed = getBilledPricing("aura-claude-opus-4-8");
    expect(billed.input).toBeCloseTo(base.input * LLM_MARKUP_MULTIPLIER, 6);
    expect(billed.output).toBeCloseTo(5 * 1.2 * 5, 6); // base output 25 -> 30
    expect(billed.cacheRead).toBeCloseTo(0.5 * 1.2, 6);
  });
});

describe("computeSessionCost", () => {
  it("computes total billed cost and weighted average per million", () => {
    const result = computeSessionCost({
      model: "aura-claude-opus-4-8",
      provider: "anthropic",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    // billed input $6/M, output $30/M -> $36 total over 2M tokens.
    expect(result.totalCostUsd).toBeCloseTo(36, 6);
    expect(result.totalTokens).toBe(2_000_000);
    expect(result.avgCostPerMillionUsd).toBeCloseTo(18, 6);
    expect(result.unknown).toBe(false);
  });

  it("flags unknown pricing for unrecognized models", () => {
    const result = computeSessionCost({
      model: "totally-made-up-model",
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(result.unknown).toBe(true);
    expect(result.totalCostUsd).toBe(0);
  });

  it("returns zero average when no tokens consumed", () => {
    const result = computeSessionCost({
      model: "aura-gpt-5-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(result.avgCostPerMillionUsd).toBe(0);
  });
});
