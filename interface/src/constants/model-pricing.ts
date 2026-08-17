/**
 * Per-model LLM pricing used by the Context popover's "Session Cost"
 * section. Rates are the base provider prices in USD per million tokens,
 * ported from `interface/scripts/lib/benchmark-pricing.mjs` (which in
 * turn mirrors the rates in `aura-router`'s `billing.rs`).
 *
 * Displayed/charged cost applies {@link LLM_MARKUP_MULTIPLIER}, matching
 * `DEFAULT_LLM_MARKUP_MULTIPLIER` in aura-router so the figures line up
 * with what is actually debited as Z credits (1 Z = $0.01).
 *
 * This module is pure (no side effects) and lives at the constants layer:
 * it must not import from `features` or `apps`.
 */

/** Markup applied on top of base provider rates (matches aura-router). */
export const LLM_MARKUP_MULTIPLIER = 1.2;

/** 1 Z credit in US dollars. */
export const USD_PER_Z = 0.01;

export type PricingProvider =
  | "anthropic"
  | "openai"
  | "xai"
  | "moonshot"
  | "fireworks"
  | "deepseek"
  | "google"
  | "unknown";

/** Base provider rates, USD per 1M tokens. */
export interface ModelRates {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

/** Anthropic made Sonnet 5's original $2/$10 launch pricing permanent. */
const SONNET_5_PRICING: ModelRates = {
  input: 2,
  output: 10,
  cacheWrite: 2.5,
  cacheRead: 0.2,
};

/** Resolve Sonnet 5's published rates; `at` remains for API compatibility. */
export function sonnet5PricingAt(_at: Date = new Date()): ModelRates {
  void _at;
  return SONNET_5_PRICING;
}

/** Rates resolved for a model, including which table they came from. */
export interface ResolvedPricing extends ModelRates {
  readonly provider: PricingProvider;
  readonly model: string;
  readonly source: string;
}

/** Cumulative token counts for a session, used to compute cost. */
export interface SessionTokenUsage {
  readonly model: string;
  readonly provider?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

const ANTHROPIC_PRICING: Readonly<Record<string, ModelRates>> = {
  "claude-fable-5": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-1": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-opus-4": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

const OPENAI_PRICING: Readonly<Record<string, ModelRates>> = {
  // GPT-5.6 cache writes cost 1.25x uncached input; cache reads cost 0.1x.
  "gpt-5.6-sol": { input: 5, output: 30, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheWrite: 2.5, cacheRead: 0.2 },
  "gpt-5.6-luna": {
    input: 0.2,
    output: 1.2,
    cacheWrite: 0.25,
    cacheRead: 0.02,
  },
  "gpt-5.5": { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
  "gpt-5.4": { input: 2.5, output: 15, cacheWrite: 2.5, cacheRead: 0.25 },
  "gpt-5.4-mini": {
    input: 0.75,
    output: 4.5,
    cacheWrite: 0.75,
    cacheRead: 0.075,
  },
  "gpt-5.4-nano": {
    input: 0.2,
    output: 1.25,
    cacheWrite: 0.2,
    cacheRead: 0.02,
  },
} as const;

// xAI publishes a discounted cached-input rate for Grok. It does not
// publish a separate cache-write rate for these models, so cache writes use
// the base input rate when a caller reports them.
const XAI_PRICING: Readonly<Record<string, ModelRates>> = {
  "grok-4.6": { input: 2, output: 6, cacheWrite: 2, cacheRead: 0.5 },
  "grok-4.5": { input: 2, output: 6, cacheWrite: 2, cacheRead: 0.3 },
  "grok-4.3": { input: 1.25, output: 2.5, cacheWrite: 1.25, cacheRead: 0.2 },
  "grok-build-0.1": { input: 1, output: 2, cacheWrite: 1, cacheRead: 0.2 },
} as const;

// Moonshot publishes automatic prompt-cache reads separately but no
// cache-write surcharge, so writes use the uncached-input rate.
const MOONSHOT_PRICING: Readonly<Record<string, ModelRates>> = {
  "kimi-k3": { input: 3, output: 15, cacheWrite: 3, cacheRead: 0.3 },
} as const;

const FIREWORKS_PRICING: Readonly<Record<string, ModelRates>> = {
  "kimi-k2p7-code": {
    input: 0.95,
    output: 4.0,
    cacheWrite: 0.95,
    cacheRead: 0.19,
  },
  "kimi-k2p6": { input: 0.95, output: 4.0, cacheWrite: 0.95, cacheRead: 0.16 },
  "kimi-k2p5": { input: 0.6, output: 3.0, cacheWrite: 0.6, cacheRead: 0.1 },
  "gpt-oss-120b": {
    input: 0.15,
    output: 0.6,
    cacheWrite: 0.15,
    cacheRead: 0.015,
  },
  "minimax-m3": { input: 0.3, output: 1.2, cacheWrite: 0.3, cacheRead: 0.06 },
  "minimax-m2p7": { input: 0.3, output: 1.2, cacheWrite: 0.3, cacheRead: 0.06 },
  "glm-5p2": { input: 1.4, output: 4.4, cacheWrite: 1.4, cacheRead: 0.14 },
  "glm-5p1": { input: 1.4, output: 4.4, cacheWrite: 1.4, cacheRead: 0.26 },
  "qwen3p7-plus": { input: 0.4, output: 1.6, cacheWrite: 0.4, cacheRead: 0.08 },
  "qwen3p6-plus": { input: 0.5, output: 3.0, cacheWrite: 0.5, cacheRead: 0.1 },
  "deepseek-v4-pro": { input: 1.74, output: 3.48, cacheWrite: 1.74, cacheRead: 0.145 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheWrite: 0.14, cacheRead: 0.028 },
} as const;

const DEEPSEEK_PRICING: Readonly<Record<string, ModelRates>> = {
  "deepseek-v4-pro": {
    input: 0.435,
    output: 0.87,
    cacheWrite: 0.435,
    cacheRead: 0.003625,
  },
  "deepseek-v4-flash": {
    input: 0.14,
    output: 0.28,
    cacheWrite: 0.14,
    cacheRead: 0.0028,
  },
} as const;

// Gemini chat models. Pro tiers use the flat (<=200k prompt) rate; cached
// input is ~10% of the base input rate (no separate cache-write charge).
const GOOGLE_PRICING: Readonly<Record<string, ModelRates>> = {
  "gemini-3.1-pro": {
    input: 2.0,
    output: 12.0,
    cacheWrite: 2.0,
    cacheRead: 0.2,
  },
  "gemini-3.5-flash": {
    input: 1.5,
    output: 9.0,
    cacheWrite: 1.5,
    cacheRead: 0.15,
  },
  "gemini-3-flash": {
    input: 0.5,
    output: 3.0,
    cacheWrite: 0.5,
    cacheRead: 0.05,
  },
  "gemini-3.1-flash-lite": {
    input: 0.25,
    output: 1.5,
    cacheWrite: 0.25,
    cacheRead: 0.025,
  },
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10.0,
    cacheWrite: 1.25,
    cacheRead: 0.125,
  },
  "gemini-2.5-flash": {
    input: 0.3,
    output: 2.5,
    cacheWrite: 0.3,
    cacheRead: 0.03,
  },
  "gemini-2.5-flash-lite": {
    input: 0.1,
    output: 0.4,
    cacheWrite: 0.1,
    cacheRead: 0.01,
  },
} as const;

const PROVIDER_TABLES: Readonly<
  Record<
    Exclude<PricingProvider, "unknown">,
    Readonly<Record<string, ModelRates>>
  >
> = {
  anthropic: ANTHROPIC_PRICING,
  openai: OPENAI_PRICING,
  xai: XAI_PRICING,
  moonshot: MOONSHOT_PRICING,
  fireworks: FIREWORKS_PRICING,
  deepseek: DEEPSEEK_PRICING,
  google: GOOGLE_PRICING,
} as const;

const ZERO_RATES: ModelRates = {
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
};

/**
 * Normalize an Aura-managed model id to the provider's canonical pricing
 * key (e.g. `aura-claude-opus-4-8` -> `claude-opus-4-8`,
 * `aura-gpt-5-5` -> `gpt-5.5`, `aura-kimi-k2-6` -> `kimi-k2p6`).
 */
export function normalizePricingKey(model: string): string {
  const key = model.trim().toLowerCase();
  const unprefixed = key.startsWith("openai/")
    ? key.slice("openai/".length)
    : key.startsWith("xai/")
      ? key.slice("xai/".length)
      : key.startsWith("moonshot/")
        ? key.slice("moonshot/".length)
      : key;
  const fireworksModel = unprefixed.match(/^accounts\/fireworks\/(?:models|routers)\/(.+)$/);
  if (fireworksModel) return fireworksModel[1];
  const directAura: Readonly<Record<string, string>> = {
    "gpt-5.6": "gpt-5.6-sol",
    "aura-gpt-5-6-sol": "gpt-5.6-sol",
    "aura-gpt-5-6-terra": "gpt-5.6-terra",
    "aura-gpt-5-6-luna": "gpt-5.6-luna",
    "aura-kimi-k3": "kimi-k3",
    "aura-kimi-k2-7-code": "kimi-k2p7-code",
    "aura-kimi-k2-6": "kimi-k2p6",
    "aura-kimi-k2-5": "kimi-k2p5",
    "aura-oss-120b": "gpt-oss-120b",
    "aura-deepseek-v4-pro": "deepseek-v4-pro",
    "aura-deepseek-v4-flash": "deepseek-v4-flash",
    "aura-grok-4-6": "grok-4.6",
    "aura-grok-4-5": "grok-4.5",
    "aura-grok-4-3": "grok-4.3",
    "aura-grok-build-0-1": "grok-build-0.1",
    "grok-code-fast": "grok-build-0.1",
    "grok-code-fast-1": "grok-build-0.1",
    "grok-code-fast-1-0825": "grok-build-0.1",
    "aura-minimax-m3": "minimax-m3",
    "aura-minimax-m2-7": "minimax-m2p7",
    "aura-glm-5-2": "glm-5p2",
    "aura-glm-5-1": "glm-5p1",
    "aura-qwen3-7-plus": "qwen3p7-plus",
    "aura-qwen3-6-plus": "qwen3p6-plus",
    "aura-gemini-3-1-pro": "gemini-3.1-pro",
    "aura-gemini-3-5-flash": "gemini-3.5-flash",
    "aura-gemini-3-flash": "gemini-3-flash",
    "aura-gemini-3-1-flash-lite": "gemini-3.1-flash-lite",
    "aura-gemini-2-5-pro": "gemini-2.5-pro",
    "aura-gemini-2-5-flash": "gemini-2.5-flash",
    "aura-gemini-2-5-flash-lite": "gemini-2.5-flash-lite",
    // Upstream preview strings the router may report fold onto the flat
    // (stable) pricing key.
    "gemini-3.1-pro-preview": "gemini-3.1-pro",
    "gemini-3-flash-preview": "gemini-3-flash",
  };
  if (directAura[unprefixed]) return directAura[unprefixed];
  const auraClaude = unprefixed.match(/^aura-(claude-.+)$/);
  if (auraClaude) return auraClaude[1];
  const auraGpt = unprefixed.match(/^aura-gpt-(\d+)-(\d+)(.*)$/);
  if (auraGpt) return `gpt-${auraGpt[1]}.${auraGpt[2]}${auraGpt[3]}`;
  return unprefixed;
}

function inferProvider(model: string, provider?: string): PricingProvider {
  const rawModel = model.trim().toLowerCase();
  if (
    rawModel.startsWith("aura-deepseek-v4-") ||
    rawModel.startsWith("accounts/fireworks/")
  ) {
    return "fireworks";
  }
  const explicit = provider?.trim().toLowerCase();
  if (explicit === "anthropic" || explicit === "openai") return explicit;
  if (explicit === "xai") return explicit;
  if (explicit === "moonshot") return explicit;
  if (explicit === "fireworks" || explicit === "deepseek") return explicit;
  if (explicit === "google") return explicit;
  const key = normalizePricingKey(model);
  if (key.startsWith("claude")) return "anthropic";
  if (key.startsWith("grok")) return "xai";
  if (key.startsWith("deepseek")) return "deepseek";
  if (key.startsWith("gemini")) return "google";
  if (key === "kimi-k3") return "moonshot";
  if (
    key.startsWith("kimi") ||
    key.startsWith("gpt-oss") ||
    key.startsWith("minimax") ||
    key.startsWith("glm") ||
    key.startsWith("qwen")
  ) {
    return "fireworks";
  }
  if (key.startsWith("gpt") || key.startsWith("o1") || key.startsWith("o3")) {
    return "openai";
  }
  return "unknown";
}

/** Resolve base ($/Mtok) rates for a model + optional provider hint. */
export function resolvePricing(
  model: string,
  provider?: string,
  at: Date = new Date(),
): ResolvedPricing {
  const resolvedProvider = inferProvider(model, provider);
  const key = normalizePricingKey(model);
  if (resolvedProvider === "anthropic" && key === "claude-sonnet-5") {
    return {
      provider: resolvedProvider,
      model: key,
      source: resolvedProvider,
      ...sonnet5PricingAt(at),
    };
  }
  if (resolvedProvider !== "unknown") {
    const rates = PROVIDER_TABLES[resolvedProvider][key];
    if (rates) {
      return {
        provider: resolvedProvider,
        model: key,
        source: resolvedProvider,
        ...rates,
      };
    }
  }
  return {
    provider: resolvedProvider,
    model: key,
    source: "unknown-pricing",
    ...ZERO_RATES,
  };
}

/** Billed rates = base rates x {@link LLM_MARKUP_MULTIPLIER}. */
export function getBilledPricing(
  model: string,
  provider?: string,
  at: Date = new Date(),
): ResolvedPricing {
  const base = resolvePricing(model, provider, at);
  return {
    ...base,
    input: base.input * LLM_MARKUP_MULTIPLIER,
    output: base.output * LLM_MARKUP_MULTIPLIER,
    cacheWrite: base.cacheWrite * LLM_MARKUP_MULTIPLIER,
    cacheRead: base.cacheRead * LLM_MARKUP_MULTIPLIER,
  };
}

/** Apply provider-published prompt-length tiers to a resolved rate card. */
function applyLongContextPricing(
  pricing: ResolvedPricing,
  inputTokens: number,
): ResolvedPricing {
  const openAiLongContext =
    pricing.provider === "openai" &&
    inputTokens > 272_000 &&
    (pricing.model === "gpt-5.4" ||
      pricing.model === "gpt-5.5" ||
      pricing.model.startsWith("gpt-5.6"));
  const xaiLongContext = pricing.provider === "xai" && inputTokens >= 200_000;
  const googleLongContext =
    pricing.provider === "google" &&
    inputTokens > 200_000 &&
    (pricing.model === "gemini-3.1-pro" || pricing.model === "gemini-2.5-pro");

  if (!openAiLongContext && !xaiLongContext && !googleLongContext)
    return pricing;
  return {
    ...pricing,
    input: pricing.input * 2,
    cacheWrite: pricing.cacheWrite * 2,
    cacheRead: pricing.cacheRead * 2,
    output: pricing.output * (xaiLongContext ? 2 : 1.5),
  };
}

/** True when no rate is known for the model (unknown pricing). */
export function isUnknownPricing(pricing: ResolvedPricing): boolean {
  return (
    pricing.source === "unknown-pricing" ||
    (pricing.input === 0 && pricing.output === 0 && pricing.cacheRead === 0)
  );
}

export interface SessionCostBreakdown {
  readonly pricing: ResolvedPricing;
  readonly totalCostUsd: number;
  /** Token-count-weighted average billed cost, USD per 1M tokens. */
  readonly avgCostPerMillionUsd: number;
  readonly totalTokens: number;
  readonly unknown: boolean;
}

/**
 * Compute the billed session cost from cumulative token usage. Mirrors
 * `calculateEstimatedCostUsd` in benchmark-pricing.mjs, including its
 * DeepSeek handling where cache tokens are already counted in input.
 */
export function computeSessionCost(
  usage: SessionTokenUsage,
): SessionCostBreakdown {
  const pricing = applyLongContextPricing(
    getBilledPricing(usage.model, usage.provider),
    usage.inputTokens,
  );
  const cacheTokens = usage.cacheCreationTokens + usage.cacheReadTokens;
  // OpenAI-compatible providers and Google report cached tokens within the
  // prompt count. Anthropic reports only new input and separate cache buckets.
  const inputIncludesCacheTokens =
    pricing.provider === "openai" ||
    pricing.provider === "xai" ||
    pricing.provider === "moonshot" ||
    pricing.provider === "fireworks" ||
    pricing.provider === "deepseek" ||
    pricing.provider === "google";
  const billedInputTokens =
    inputIncludesCacheTokens && cacheTokens > 0
      ? Math.max(0, usage.inputTokens - cacheTokens)
      : usage.inputTokens;

  const totalCostUsd =
    (billedInputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output +
    (usage.cacheCreationTokens / 1_000_000) * pricing.cacheWrite +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead;

  // Weighted average across the token types actually consumed.
  const totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    (inputIncludesCacheTokens ? 0 : cacheTokens);
  const avgCostPerMillionUsd =
    totalTokens > 0 ? (totalCostUsd / totalTokens) * 1_000_000 : 0;

  return {
    pricing,
    totalCostUsd,
    avgCostPerMillionUsd,
    totalTokens,
    unknown: isUnknownPricing(pricing),
  };
}
