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

function normalizeModelKey(model) {
  return typeof model === "string" ? model.trim().toLowerCase() : "";
}

function inferProvider(model, provider) {
  if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  const modelKey = normalizeModelKey(model);
  if (modelKey.startsWith("claude")) return "anthropic";
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
