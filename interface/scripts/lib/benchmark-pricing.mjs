const ANTHROPIC_MODEL_PRICING_PER_MTOK = {
  "claude-fable-5": {
    input: 10,
    output: 50,
    cacheWrite: 12.5,
    cacheRead: 1,
  },
  "claude-opus-4-8": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4.8": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4-7": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4.7": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4-6": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4.6": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4.5": {
    input: 5,
    output: 25,
    cacheWrite: 6.25,
    cacheRead: 0.5,
  },
  "claude-opus-4-1": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-opus-4.1": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-sonnet-4.6": {
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
  "claude-sonnet-4.5": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheRead: 0.1,
  },
  "claude-haiku-4.5": {
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheRead: 0.1,
  },
};

const OPENAI_MODEL_PRICING_PER_MTOK = {
  "gpt-5.5": {
    input: 5,
    output: 30,
    cacheWrite: 5,
    cacheRead: 0.5,
  },
  "gpt-5.4": {
    input: 2.5,
    output: 15,
    cacheWrite: 2.5,
    cacheRead: 0.25,
  },
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
  "gpt-5.3-codex": {
    input: 1.75,
    output: 14,
    cacheWrite: 1.75,
    cacheRead: 0.175,
  },
  "codex-mini-latest": {
    input: 1.5,
    output: 6,
    cacheWrite: 1.5,
    cacheRead: 0.375,
  },
};

// xAI publishes a discounted cached-input rate for Grok. It does not
// publish a separate cache-write rate for these models, so cache writes use
// the base input rate when a caller reports them.
const XAI_MODEL_PRICING_PER_MTOK = {
  "grok-4.3": {
    input: 1.25,
    output: 2.5,
    cacheWrite: 1.25,
    cacheRead: 0.2,
  },
  "grok-build-0.1": {
    input: 1.0,
    output: 2.0,
    cacheWrite: 1.0,
    cacheRead: 0.2,
  },
};

const FIREWORKS_MODEL_PRICING_PER_MTOK = {
  "kimi-k2p7-code": {
    input: 0.95,
    output: 4.0,
    cacheWrite: 0.95,
    cacheRead: 0.19,
  },
  "kimi-k2p6": {
    input: 0.95,
    output: 4.0,
    cacheWrite: 0.95,
    cacheRead: 0.16,
  },
  "kimi-k2p6-turbo": {
    input: 2.0,
    output: 8.0,
    cacheWrite: 2.0,
    cacheRead: 0.3,
  },
  "kimi-k2p5": {
    input: 0.6,
    output: 3.0,
    cacheWrite: 0.6,
    cacheRead: 0.1,
  },
  "kimi-k2p5-turbo": {
    input: 0.99,
    output: 4.94,
    cacheWrite: 0.99,
    cacheRead: 0.16,
  },
  "kimi-k2-thinking": {
    input: 0.6,
    output: 2.5,
    cacheWrite: 0.6,
    cacheRead: 0.3,
  },
  "kimi-k2-instruct-0905": {
    input: 0.6,
    output: 2.5,
    cacheWrite: 0.6,
    cacheRead: 0.3,
  },
  "gpt-oss-120b": {
    input: 0.15,
    output: 0.6,
    cacheWrite: 0.15,
    cacheRead: 0.01,
  },
  "minimax-m3": {
    input: 0.4,
    output: 1.6,
    cacheWrite: 0.4,
    cacheRead: 0.08,
  },
  "minimax-m2p7": {
    input: 0.3,
    output: 1.2,
    cacheWrite: 0.3,
    cacheRead: 0.06,
  },
  "glm-5p2": {
    input: 1.4,
    output: 4.4,
    cacheWrite: 1.4,
    cacheRead: 0.26,
  },
  "glm-5p1": {
    input: 1.4,
    output: 4.4,
    cacheWrite: 1.4,
    cacheRead: 0.26,
  },
  "qwen3p7-plus": {
    input: 0.4,
    output: 1.6,
    cacheWrite: 0.4,
    cacheRead: 0.08,
  },
  "qwen3p6-plus": {
    input: 0.5,
    output: 3.0,
    cacheWrite: 0.5,
    cacheRead: 0.1,
  },
};

// Gemini chat models. Pro tiers use the flat (<=200k prompt) rate; cached
// input is ~10% of the base input rate (no separate cache-write charge).
const GOOGLE_MODEL_PRICING_PER_MTOK = {
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
};

const DEEPSEEK_MODEL_PRICING_PER_MTOK = {
  "deepseek-v4-pro": {
    input: 1.74,
    output: 3.48,
    cacheWrite: 1.74,
    cacheRead: 0.145,
  },
  "deepseek-v4-flash": {
    input: 0.14,
    output: 0.28,
    cacheWrite: 0.14,
    cacheRead: 0.028,
  },
  "deepseek-chat": {
    input: 0.14,
    output: 0.28,
    cacheWrite: 0.14,
    cacheRead: 0.028,
  },
  "deepseek-reasoner": {
    input: 0.14,
    output: 0.28,
    cacheWrite: 0.14,
    cacheRead: 0.028,
  },
};

function normalizeModelKey(model) {
  const modelKey = typeof model === "string" ? model.trim().toLowerCase() : "";
  const unprefixed = modelKey.startsWith("openai/")
    ? modelKey.slice("openai/".length)
    : modelKey.startsWith("xai/")
      ? modelKey.slice("xai/".length)
    : modelKey.startsWith("deepseek/")
      ? modelKey.slice("deepseek/".length)
      : modelKey;
  const fireworksModel = unprefixed.match(/^accounts\/fireworks\/models\/(.+)$/);
  if (fireworksModel) return fireworksModel[1];
  const fireworksRouter = unprefixed.match(/^accounts\/fireworks\/routers\/(.+)$/);
  if (fireworksRouter) return fireworksRouter[1];
  const auraClaude = unprefixed.match(/^aura-(claude-.+)$/);
  if (auraClaude) return auraClaude[1];
  const auraFireworksModels = {
    "aura-kimi-k2-7-code": "kimi-k2p7-code",
    "aura-kimi-k2-6": "kimi-k2p6",
    "aura-kimi-k2-5": "kimi-k2p5",
    "aura-oss-120b": "gpt-oss-120b",
    "aura-minimax-m3": "minimax-m3",
    "aura-minimax-m2-7": "minimax-m2p7",
    "aura-glm-5-2": "glm-5p2",
    "aura-glm-5-1": "glm-5p1",
    "aura-qwen3-7-plus": "qwen3p7-plus",
    "aura-qwen3-6-plus": "qwen3p6-plus",
  };
  if (auraFireworksModels[unprefixed]) return auraFireworksModels[unprefixed];
  const auraDeepSeekModels = {
    "aura-deepseek-v4-pro": "deepseek-v4-pro",
    "aura-deepseek-v4-flash": "deepseek-v4-flash",
  };
  if (auraDeepSeekModels[unprefixed]) return auraDeepSeekModels[unprefixed];
  const auraXaiModels = {
    "aura-grok-4-3": "grok-4.3",
    "aura-grok-build-0-1": "grok-build-0.1",
  };
  if (auraXaiModels[unprefixed]) return auraXaiModels[unprefixed];
  const auraGoogleModels = {
    "aura-gemini-3-1-pro": "gemini-3.1-pro",
    "aura-gemini-3-5-flash": "gemini-3.5-flash",
    "aura-gemini-3-flash": "gemini-3-flash",
    "aura-gemini-3-1-flash-lite": "gemini-3.1-flash-lite",
    "aura-gemini-2-5-pro": "gemini-2.5-pro",
    "aura-gemini-2-5-flash": "gemini-2.5-flash",
    "aura-gemini-2-5-flash-lite": "gemini-2.5-flash-lite",
  };
  if (auraGoogleModels[unprefixed]) return auraGoogleModels[unprefixed];
  const auraGptMatch = unprefixed.match(/^aura-gpt-(\d+)-(\d+)(.*)$/);
  if (auraGptMatch) {
    return `gpt-${auraGptMatch[1]}.${auraGptMatch[2]}${auraGptMatch[3]}`;
  }
  return unprefixed;
}

function inferProvider(model, provider) {
  if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  const modelKey = normalizeModelKey(model);
  if (modelKey.startsWith("claude")) return "anthropic";
  if (modelKey.startsWith("grok")) return "xai";
  if (modelKey.startsWith("deepseek-v4") || modelKey === "deepseek-chat" || modelKey === "deepseek-reasoner") {
    return "deepseek";
  }
  if (modelKey.startsWith("gemini")) return "google";
  if (
    modelKey.startsWith("kimi") ||
    modelKey.startsWith("gpt-oss") ||
    modelKey.startsWith("minimax") ||
    modelKey.startsWith("glm") ||
    modelKey.startsWith("qwen")
  ) {
    return "fireworks";
  }
  if (modelKey.startsWith("gpt") || modelKey.startsWith("o1") || modelKey.startsWith("o3")) {
    return "openai";
  }
  return null;
}

function findAnthropicPricing(modelKey) {
  const exactMatch = ANTHROPIC_MODEL_PRICING_PER_MTOK[modelKey];
  if (exactMatch) {
    return {
      model: modelKey,
      source: "anthropic-pricing",
      ...exactMatch,
    };
  }

  const partialEntry = Object.entries(ANTHROPIC_MODEL_PRICING_PER_MTOK).find(([candidate]) =>
    modelKey.startsWith(candidate) || candidate.startsWith(modelKey),
  );
  if (!partialEntry) return null;

  const [matchedModel, pricing] = partialEntry;
  return {
    model: matchedModel,
    source: "anthropic-pricing-family-match",
    ...pricing,
  };
}

function findOpenAIPricing(modelKey) {
  const exactMatch = OPENAI_MODEL_PRICING_PER_MTOK[modelKey];
  if (exactMatch) {
    return {
      model: modelKey,
      source: "openai-pricing",
      ...exactMatch,
    };
  }

  const partialEntry = Object.entries(OPENAI_MODEL_PRICING_PER_MTOK).find(([candidate]) =>
    modelKey.startsWith(candidate) || candidate.startsWith(modelKey),
  );
  if (!partialEntry) return null;

  const [matchedModel, pricing] = partialEntry;
  return {
    model: matchedModel,
    source: "openai-pricing-family-match",
    ...pricing,
  };
}

function findXaiPricing(modelKey) {
  const exactMatch = XAI_MODEL_PRICING_PER_MTOK[modelKey];
  if (exactMatch) {
    return {
      model: modelKey,
      source: "xai-pricing",
      ...exactMatch,
    };
  }

  const partialEntry = Object.entries(XAI_MODEL_PRICING_PER_MTOK).find(([candidate]) =>
    modelKey.startsWith(candidate) || candidate.startsWith(modelKey),
  );
  if (!partialEntry) return null;

  const [matchedModel, pricing] = partialEntry;
  return {
    model: matchedModel,
    source: "xai-pricing-family-match",
    ...pricing,
  };
}

function findFireworksPricing(modelKey) {
  const exactMatch = FIREWORKS_MODEL_PRICING_PER_MTOK[modelKey];
  if (exactMatch) {
    return {
      model: modelKey,
      source: "fireworks-pricing",
      ...exactMatch,
    };
  }

  const partialEntry = Object.entries(FIREWORKS_MODEL_PRICING_PER_MTOK).find(([candidate]) =>
    modelKey.startsWith(candidate) || candidate.startsWith(modelKey),
  );
  if (!partialEntry) return null;

  const [matchedModel, pricing] = partialEntry;
  return {
    model: matchedModel,
    source: "fireworks-pricing-family-match",
    ...pricing,
  };
}

function findDeepSeekPricing(modelKey) {
  const exactMatch = DEEPSEEK_MODEL_PRICING_PER_MTOK[modelKey];
  if (exactMatch) {
    return {
      model: modelKey,
      source: "deepseek-pricing",
      ...exactMatch,
    };
  }

  const partialEntry = Object.entries(DEEPSEEK_MODEL_PRICING_PER_MTOK).find(([candidate]) =>
    modelKey.startsWith(candidate) || candidate.startsWith(modelKey),
  );
  if (!partialEntry) return null;

  const [matchedModel, pricing] = partialEntry;
  return {
    model: matchedModel,
    source: "deepseek-pricing-family-match",
    ...pricing,
  };
}

function findGooglePricing(modelKey) {
  const exactMatch = GOOGLE_MODEL_PRICING_PER_MTOK[modelKey];
  if (exactMatch) {
    return {
      model: modelKey,
      source: "google-pricing",
      ...exactMatch,
    };
  }

  // Preview strings (e.g. `gemini-3.1-pro-preview`) fold onto the flat
  // stable pricing key via this prefix match.
  const partialEntry = Object.entries(GOOGLE_MODEL_PRICING_PER_MTOK).find(([candidate]) =>
    modelKey.startsWith(candidate) || candidate.startsWith(modelKey),
  );
  if (!partialEntry) return null;

  const [matchedModel, pricing] = partialEntry;
  return {
    model: matchedModel,
    source: "google-pricing-family-match",
    ...pricing,
  };
}

export function resolvePricing(model, provider) {
  const inferredProvider = inferProvider(model, provider);
  const modelKey = normalizeModelKey(model);
  if (inferredProvider === "anthropic") {
    const pricing = findAnthropicPricing(modelKey);
    if (pricing) {
      return {
        provider: inferredProvider,
        ...pricing,
      };
    }
  }

  if (inferredProvider === "openai") {
    const pricing = findOpenAIPricing(modelKey);
    if (pricing) {
      return {
        provider: inferredProvider,
        ...pricing,
      };
    }
  }

  if (inferredProvider === "xai") {
    const pricing = findXaiPricing(modelKey);
    if (pricing) {
      return {
        provider: inferredProvider,
        ...pricing,
      };
    }
  }

  if (inferredProvider === "fireworks") {
    const pricing = findFireworksPricing(modelKey);
    if (pricing) {
      return {
        provider: inferredProvider,
        ...pricing,
      };
    }
  }

  if (inferredProvider === "deepseek") {
    const pricing = findDeepSeekPricing(modelKey);
    if (pricing) {
      return {
        provider: inferredProvider,
        ...pricing,
      };
    }
  }

  if (inferredProvider === "google") {
    const pricing = findGooglePricing(modelKey);
    if (pricing) {
      return {
        provider: inferredProvider,
        ...pricing,
      };
    }
  }

  return {
    provider: inferredProvider ?? "unknown",
    model: modelKey,
    source: "unknown-pricing",
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
  };
}

export function calculateEstimatedCostUsd(usage) {
  const pricing = resolvePricing(usage.model, usage.provider);
  const cacheInputTokens =
    usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  // DeepSeek, xAI, and Google report cached tokens within the prompt token count.
  const inputIncludesCacheTokens =
    pricing.provider === "deepseek" || pricing.provider === "xai" || pricing.provider === "google";
  const inputTokens =
    inputIncludesCacheTokens && cacheInputTokens > 0
      ? Math.max(0, usage.inputTokens - cacheInputTokens)
      : usage.inputTokens;

  const estimatedCostUsd =
    (inputTokens / 1_000_000) * pricing.input
    + (usage.outputTokens / 1_000_000) * pricing.output
    + (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWrite
    + (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheRead;

  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    pricing,
  };
}
