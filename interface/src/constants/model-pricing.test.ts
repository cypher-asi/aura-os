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
    expect(normalizePricingKey("aura-claude-opus-5")).toBe("claude-opus-5");
    expect(normalizePricingKey("aura-claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(normalizePricingKey("aura-claude-fable-5")).toBe("claude-fable-5");
    expect(normalizePricingKey("aura-gpt-5-5")).toBe("gpt-5.5");
    expect(normalizePricingKey("gpt-5.6")).toBe("gpt-5.6-sol");
    expect(normalizePricingKey("aura-gpt-5-6-terra")).toBe("gpt-5.6-terra");
    expect(normalizePricingKey("openai/gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(normalizePricingKey("aura-gpt-5-4-mini")).toBe("gpt-5.4-mini");
    expect(normalizePricingKey("aura-grok-4-5")).toBe("grok-4.5");
    expect(normalizePricingKey("xai/grok-4.5")).toBe("grok-4.5");
    expect(normalizePricingKey("aura-grok-4-3")).toBe("grok-4.3");
    expect(normalizePricingKey("xai/grok-4.3")).toBe("grok-4.3");
    expect(normalizePricingKey("aura-grok-build-0-1")).toBe("grok-build-0.1");
    expect(normalizePricingKey("xai/grok-build-0.1")).toBe("grok-build-0.1");
    expect(normalizePricingKey("grok-code-fast-1")).toBe("grok-build-0.1");
    expect(normalizePricingKey("aura-kimi-k2-6")).toBe("kimi-k2p6");
    expect(normalizePricingKey("aura-deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(normalizePricingKey("aura-gemini-2-5-pro")).toBe("gemini-2.5-pro");
    expect(normalizePricingKey("aura-gemini-3-1-flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(normalizePricingKey("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro");
  });
});

describe("resolvePricing for xAI Grok", () => {
  it("resolves aura aliases and raw names to the xAI table", () => {
    const flagship = resolvePricing("aura-grok-4-5");
    expect(flagship.provider).toBe("xai");
    expect(flagship.model).toBe("grok-4.5");
    expect(flagship.input).toBe(2);
    expect(flagship.output).toBe(6);
    expect(flagship.cacheRead).toBe(0.5);

    const grok = resolvePricing("aura-grok-4-3");
    expect(grok.provider).toBe("xai");
    expect(grok.model).toBe("grok-4.3");
    expect(grok.input).toBe(1.25);
    expect(grok.output).toBe(2.5);
    expect(grok.cacheRead).toBe(0.2);

    const build = resolvePricing("aura-grok-build-0-1");
    expect(build.provider).toBe("xai");
    expect(build.model).toBe("grok-build-0.1");
    expect(build.input).toBe(1);
    expect(build.output).toBe(2);
    expect(build.cacheRead).toBe(0.2);
  });

  it("treats cached prompt tokens as already counted in input", () => {
    const result = computeSessionCost({
      model: "aura-grok-4-3",
      provider: "xai",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 400_000,
      cacheCreationTokens: 0,
    });
    // billed: 600k new input at $1.50/M, 500k output at $3/M,
    // and 400k cached input at $0.24/M after markup.
    expect(result.totalCostUsd).toBeCloseTo(2.496, 6);
    expect(result.unknown).toBe(false);
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
  it("resolves the full GPT-5.6 family at published rates", () => {
    expect(resolvePricing("gpt-5.6")).toMatchObject({
      model: "gpt-5.6-sol",
      input: 5,
      output: 30,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    });
    expect(resolvePricing("aura-gpt-5-6-terra")).toMatchObject({
      input: 2.5,
      output: 15,
      cacheWrite: 3.125,
      cacheRead: 0.25,
    });
    expect(resolvePricing("aura-gpt-5-6-luna")).toMatchObject({
      input: 1,
      output: 6,
      cacheWrite: 1.25,
      cacheRead: 0.1,
    });
  });

  it("resolves Claude Fable 5 at Anthropic's published rates", () => {
    const base = resolvePricing("aura-claude-fable-5");
    expect(base.provider).toBe("anthropic");
    expect(base.model).toBe("claude-fable-5");
    expect(base.input).toBe(10);
    expect(base.output).toBe(50);
    expect(base.cacheWrite).toBe(12.5);
    expect(base.cacheRead).toBe(1);
  });

  it("resolves Claude Opus 5 base and prompt-cache rates", () => {
    expect(resolvePricing("aura-claude-opus-5")).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      input: 5,
      output: 25,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    });
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
  it("does not double-charge OpenAI cached input", () => {
    const result = computeSessionCost({
      model: "aura-gpt-5-5",
      provider: "openai",
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      cacheCreationTokens: 0,
    });
    // 100k new input at $6/M + 100k cached at $0.60/M +
    // 100k output at $36/M after Aura's 20% markup.
    expect(result.totalCostUsd).toBeCloseTo(4.26, 6);
    expect(result.totalTokens).toBe(300_000);
  });

  it("prices GPT-5.6 cache writes at 1.25x input without double charging", () => {
    const result = computeSessionCost({
      model: "aura-gpt-5-6-luna",
      provider: "openai",
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 50_000,
      cacheCreationTokens: 100_000,
    });
    // 50k new at $1.20/M + 100k cache write at $1.50/M +
    // 50k cache read at $0.12/M + 100k output at $7.20/M.
    expect(result.totalCostUsd).toBeCloseTo(0.936, 6);
    expect(result.totalTokens).toBe(300_000);
  });

  it("computes total billed cost and weighted average per million", () => {
    const result = computeSessionCost({
      model: "aura-claude-opus-5",
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
