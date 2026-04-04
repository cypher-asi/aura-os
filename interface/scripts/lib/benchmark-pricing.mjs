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
