import { describe, expect, it } from "vitest";

import {
  LLM_MARKUP_MULTIPLIER,
  computeSessionCost,
  getBilledPricing,
  normalizePricingKey,
  resolvePricing,
  sonnet5PricingAt,
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
    expect(normalizePricingKey("aura-kimi-k3")).toBe("kimi-k3");
    expect(normalizePricingKey("moonshot/kimi-k3")).toBe("kimi-k3");
    expect(normalizePricingKey("aura-kimi-k2-6")).toBe("kimi-k2p6");
    expect(normalizePricingKey("aura-deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(normalizePricingKey("accounts/fireworks/models/deepseek-v4-pro")).toBe(
      "deepseek-v4-pro",
    );
    expect(normalizePricingKey("aura-gemini-2-5-pro")).toBe("gemini-2.5-pro");
    expect(normalizePricingKey("aura-gemini-3-1-flash-lite")).toBe(
      "gemini-3.1-flash-lite",
    );
    expect(normalizePricingKey("gemini-3.1-pro-preview")).toBe(
      "gemini-3.1-pro",
    );
  });
});

describe("resolvePricing for Moonshot Kimi K3", () => {
  it("resolves Aura and direct Moonshot ids at published rates", () => {
    expect(resolvePricing("aura-kimi-k3")).toMatchObject({
      provider: "moonshot",
      model: "kimi-k3",
      input: 3,
      output: 15,
      cacheWrite: 3,
      cacheRead: 0.3,
    });
    expect(resolvePricing("moonshot/kimi-k3", "moonshot")).toMatchObject({
      provider: "moonshot",
      model: "kimi-k3",
    });
  });

  it("does not double-charge Moonshot cached prompt tokens", () => {
    const result = computeSessionCost({
      model: "aura-kimi-k3",
      provider: "moonshot",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 400_000,
      cacheCreationTokens: 0,
    });
    // After markup: 600k new at $3.60/M, 400k cached at $0.36/M,
    // and 500k output at $18/M.
    expect(result.totalCostUsd).toBeCloseTo(11.304, 6);
    expect(result.unknown).toBe(false);
  });
});

describe("resolvePricing for xAI Grok", () => {
  it("resolves aura aliases and raw names to the xAI table", () => {
    const flagship = resolvePricing("aura-grok-4-5");
    expect(flagship.provider).toBe("xai");
    expect(flagship.model).toBe("grok-4.5");
    expect(flagship.input).toBe(2);
    expect(flagship.output).toBe(6);
    expect(flagship.cacheRead).toBe(0.3);

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
    // The >=200K xAI tier doubles billed rates: 600k new at $3/M,
    // 500k output at $6/M, and 400k cached input at $0.48/M.
    expect(result.totalCostUsd).toBeCloseTo(4.992, 6);
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
    // The >200K Pro tier bills input at $3/M, output at $18/M, and cache at $0.30/M.
    const result = computeSessionCost({
      model: "aura-gemini-2-5-pro",
      provider: "google",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 400_000,
      cacheCreationTokens: 0,
    });
    expect(result.totalCostUsd).toBeCloseTo(10.92, 6);
    expect(result.unknown).toBe(false);
  });
});

describe("resolvePricing for DeepSeek hosting", () => {
  it("distinguishes Aura's Fireworks-hosted aliases from direct API models", () => {
    expect(resolvePricing("aura-deepseek-v4-pro", "deepseek")).toMatchObject({
      provider: "fireworks",
      input: 1.74,
      cacheRead: 0.145,
      output: 3.48,
    });
    expect(resolvePricing("deepseek-v4-pro", "deepseek")).toMatchObject({
      provider: "deepseek",
      input: 0.435,
      cacheRead: 0.003625,
      output: 0.87,
    });
  });
});

describe("getBilledPricing", () => {
  it("keeps Sonnet 5 at Anthropic's permanent launch pricing", () => {
    expect(sonnet5PricingAt(new Date("2026-08-31T23:59:59.999Z"))).toEqual({
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.2,
    });
    expect(sonnet5PricingAt(new Date("2026-09-01T00:00:00.000Z"))).toEqual({
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.2,
    });
    expect(
      resolvePricing(
        "aura-claude-sonnet-5",
        "anthropic",
        new Date("2026-08-31T12:00:00.000Z"),
      ),
    ).toMatchObject({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 });
  });

  it("resolves the full GPT-5.6 family at published rates", () => {
    expect(resolvePricing("gpt-5.6")).toMatchObject({
      model: "gpt-5.6-sol",
      input: 5,
      output: 30,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    });
    expect(resolvePricing("aura-gpt-5-6-terra")).toMatchObject({
      input: 2,
      output: 12,
      cacheWrite: 2.5,
      cacheRead: 0.2,
    });
    expect(resolvePricing("aura-gpt-5-6-luna")).toMatchObject({
      input: 0.2,
      output: 1.2,
      cacheWrite: 0.25,
      cacheRead: 0.02,
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
    // 50k new at $0.24/M + 100k cache write at $0.30/M +
    // 50k cache read at $0.024/M + 100k output at $1.44/M.
    expect(result.totalCostUsd).toBeCloseTo(0.1872, 6);
    expect(result.totalTokens).toBe(300_000);
  });

  it("applies OpenAI, xAI, and Gemini long-context tiers", () => {
    const usage = {
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    expect(
      computeSessionCost({
        ...usage,
        model: "aura-gpt-5-5",
        inputTokens: 300_000,
      }).totalCostUsd,
    ).toBeCloseTo(9, 6);
    expect(
      computeSessionCost({
        ...usage,
        model: "aura-grok-4-5",
        inputTokens: 200_000,
      }).totalCostUsd,
    ).toBeCloseTo(2.4, 6);
    expect(
      computeSessionCost({
        ...usage,
        model: "aura-gemini-2-5-pro",
        inputTokens: 300_000,
      }).totalCostUsd,
    ).toBeCloseTo(2.7, 6);
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
