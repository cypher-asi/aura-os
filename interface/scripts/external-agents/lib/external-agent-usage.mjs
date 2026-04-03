import { calculateEstimatedCostUsd } from "../../lib/benchmark-pricing.mjs";

function parseJsonl(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeModel(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\u001b\[[0-9;]*m/g, "");
  const match = normalized.match(/([a-z0-9.-]+(?:\[[0-9;]*m\])?)/i);
  if (!match) return normalized || null;
  return match[1].replace(/\[[0-9;]*m\]$/g, "") || null;
}

export function extractClaudeCodeUsageFromStreamJson(text) {
  const events = parseJsonl(text);
  const init = events.find((event) => event?.type === "system" && event?.subtype === "init");
  const result = [...events].reverse().find((event) => event?.type === "result");
  const assistantMessage = [...events].reverse().find((event) => event?.message?.model);
  if (!result) return null;

  const usage = result.usage ?? {};
  const totalCostUsd = numberOrNull(result.total_cost_usd);
  const model =
    sanitizeModel(assistantMessage?.message?.model)
    || sanitizeModel(Object.keys(result.modelUsage ?? {})[0])
    || sanitizeModel(init?.model);
  const normalized = {
    inputTokens: numberOrNull(usage.input_tokens) ?? 0,
    outputTokens: numberOrNull(usage.output_tokens) ?? 0,
    cacheCreationInputTokens: numberOrNull(usage.cache_creation_input_tokens) ?? 0,
    cacheReadInputTokens: numberOrNull(usage.cache_read_input_tokens) ?? 0,
    estimatedCostUsd: totalCostUsd,
  };

  if (normalized.estimatedCostUsd == null && model) {
    normalized.estimatedCostUsd = calculateEstimatedCostUsd({
      model,
      provider: "anthropic",
      inputTokens: normalized.inputTokens,
      outputTokens: normalized.outputTokens,
      cacheCreationInputTokens: normalized.cacheCreationInputTokens,
      cacheReadInputTokens: normalized.cacheReadInputTokens,
    }).estimatedCostUsd;
  }

  return {
    usage: normalized,
    provider: "anthropic",
    model,
  };
}

export function extractCodexUsageFromJsonl(text, model = null) {
  const events = parseJsonl(text);
  const turnCompleted = [...events].reverse().find((event) => event?.type === "turn.completed");
  if (!turnCompleted?.usage) {
    return {
      usage: null,
      provider: "openai",
      model,
    };
  }

  const usage = {
    inputTokens: numberOrNull(turnCompleted.usage.input_tokens) ?? 0,
    outputTokens: numberOrNull(turnCompleted.usage.output_tokens) ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: numberOrNull(turnCompleted.usage.cached_input_tokens) ?? 0,
    estimatedCostUsd: null,
  };

  if (model) {
    usage.estimatedCostUsd = calculateEstimatedCostUsd({
      model,
      provider: "openai",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
    }).estimatedCostUsd;
  }

  return {
    usage,
    provider: "openai",
    model,
  };
}
