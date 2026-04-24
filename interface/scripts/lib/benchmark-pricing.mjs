const ANTHROPIC_MODEL_PRICING_PER_MTOK = {
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
    input: 0.8,
    output: 4,
    cacheWrite: 1,
    cacheRead: 0.08,
  },
  "claude-haiku-4.5": {
    input: 0.8,
    output: 4,
    cacheWrite: 1,
    cacheRead: 0.08,
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

const FIREWORKS_MODEL_PRICING_PER_MTOK = {
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
  "deepseek-v3p2": {
    input: 0.56,
    output: 1.68,
    cacheWrite: 0.56,
    cacheRead: 0.28,
  },
  "gpt-oss-120b": {
    input: 0.15,
    output: 0.6,
    cacheWrite: 0.15,
    cacheRead: 0.01,
  },
};

function normalizeModelKey(model) {
  const modelKey = typeof model === "string" ? model.trim().toLowerCase() : "";
  const unprefixed = modelKey.startsWith("openai/") ? modelKey.slice("openai/".length) : modelKey;
  const fireworksModel = unprefixed.match(/^accounts\/fireworks\/models\/(.+)$/);
  if (fireworksModel) return fireworksModel[1];
  const fireworksRouter = unprefixed.match(/^accounts\/fireworks\/routers\/(.+)$/);
  if (fireworksRouter) return fireworksRouter[1];
  const auraFireworksModels = {
    "aura-kimi-k2-6": "kimi-k2p6",
    "aura-kimi-k2-5": "kimi-k2p5",
    "aura-deepseek-v3-2": "deepseek-v3p2",
    "aura-oss-120b": "gpt-oss-120b",
  };
  if (auraFireworksModels[unprefixed]) return auraFireworksModels[unprefixed];
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
  if (
    modelKey.startsWith("deepseek") ||
    modelKey.startsWith("kimi") ||
    modelKey.startsWith("gpt-oss")
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

  if (inferredProvider === "fireworks") {
    const pricing = findFireworksPricing(modelKey);
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

  const estimatedCostUsd =
    (usage.inputTokens / 1_000_000) * pricing.input
    + (usage.outputTokens / 1_000_000) * pricing.output
    + (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWrite
    + (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheRead;

  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    pricing,
  };
}
