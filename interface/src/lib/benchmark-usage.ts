export interface RawStorageSessionEvent {
  event_type?: string | null;
  eventType?: string | null;
  type?: string | null;
  content?: unknown;
}

export interface SessionTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  estimatedContextTokens?: number;
  contextUtilization?: number;
  model?: string;
  provider?: string;
}

export interface SessionUsageBreakdown {
  source: "assistant_message_end" | "token_usage" | "none";
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  promptInputFootprintTokens: number;
  maxEstimatedContextTokens: number;
  maxContextUtilization: number;
  fileChangeCount: number;
  models: string[];
  providers: string[];
}

export interface AggregateUsageBreakdown {
  richUsageSessions: number;
  fallbackUsageSessions: number;
  richUsageTurns: number;
  fallbackUsageTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  promptInputFootprintTokens: number;
  maxEstimatedContextTokens: number;
  maxContextUtilization: number;
  fileChangeCount: number;
  models: string[];
  providers: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(record: Record<string, unknown>, snake: string, camel?: string): number | undefined {
  const value = record[snake] ?? (camel ? record[camel] : undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, snake: string, camel?: string): string | undefined {
  const value = record[snake] ?? (camel ? record[camel] : undefined);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readUsagePayload(content: unknown): Record<string, unknown> | null {
  const outer = asRecord(content);
  if (!outer) return null;
  const nested = asRecord(outer.usage);
  return nested ?? outer;
}

function extractTurnUsage(content: unknown): SessionTurnUsage | null {
  const usage = readUsagePayload(content);
  if (!usage) return null;

  const inputTokens = readNumber(usage, "input_tokens", "inputTokens");
  const outputTokens = readNumber(usage, "output_tokens", "outputTokens");
  if (inputTokens == null || outputTokens == null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: readNumber(
      usage,
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
    ) ?? 0,
    cacheReadInputTokens: readNumber(usage, "cache_read_input_tokens", "cacheReadInputTokens") ?? 0,
    estimatedContextTokens: readNumber(
      usage,
      "estimated_context_tokens",
      "estimatedContextTokens",
    ),
    contextUtilization: readNumber(usage, "context_utilization", "contextUtilization"),
    model: readString(usage, "model"),
    provider: readString(usage, "provider"),
  };
}

function countFilesChanged(content: unknown): number {
  const outer = asRecord(content);
  if (!outer) return 0;

  const filesChanged = outer.files_changed ?? outer.filesChanged;
  if (Array.isArray(filesChanged)) {
    return filesChanged.length;
  }

  const grouped = asRecord(filesChanged);
  if (!grouped) return 0;

  return ["created", "modified", "deleted"].reduce((count, key) => {
    const value = grouped[key];
    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function summarizeUsageEvents(
  events: RawStorageSessionEvent[],
  eventTypes: string[],
  source: SessionUsageBreakdown["source"],
): SessionUsageBreakdown {
  const summary = {
    source,
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    promptInputFootprintTokens: 0,
    maxEstimatedContextTokens: 0,
    maxContextUtilization: 0,
    fileChangeCount: 0,
    models: new Set<string>(),
    providers: new Set<string>(),
  };

  for (const event of events) {
    const eventType = event.event_type ?? event.eventType ?? event.type ?? "";
    if (!eventTypes.includes(eventType)) continue;

    const usage = extractTurnUsage(event.content);
    if (!usage) continue;

    summary.turnCount += 1;
    summary.inputTokens += usage.inputTokens;
    summary.outputTokens += usage.outputTokens;
    summary.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    summary.cacheReadInputTokens += usage.cacheReadInputTokens;
    summary.promptInputFootprintTokens +=
      usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
    summary.maxEstimatedContextTokens = Math.max(
      summary.maxEstimatedContextTokens,
      usage.estimatedContextTokens ?? 0,
    );
    summary.maxContextUtilization = Math.max(
      summary.maxContextUtilization,
      usage.contextUtilization ?? 0,
    );
    summary.fileChangeCount += countFilesChanged(event.content);

    if (usage.model) summary.models.add(usage.model);
    if (usage.provider) summary.providers.add(usage.provider);
  }

  return {
    source: summary.source,
    turnCount: summary.turnCount,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cacheCreationInputTokens: summary.cacheCreationInputTokens,
    cacheReadInputTokens: summary.cacheReadInputTokens,
    promptInputFootprintTokens: summary.promptInputFootprintTokens,
    maxEstimatedContextTokens: summary.maxEstimatedContextTokens,
    maxContextUtilization: summary.maxContextUtilization,
    fileChangeCount: summary.fileChangeCount,
    models: Array.from(summary.models).sort(),
    providers: Array.from(summary.providers).sort(),
  };
}

export function summarizeSessionUsage(events: RawStorageSessionEvent[]): SessionUsageBreakdown {
  const assistantSummary = summarizeUsageEvents(events, ["assistant_message_end"], "assistant_message_end");
  if (assistantSummary.turnCount > 0) {
    return assistantSummary;
  }

  const fallbackSummary = summarizeUsageEvents(events, ["token_usage"], "token_usage");
  if (fallbackSummary.turnCount > 0) {
    return fallbackSummary;
  }

  return {
    source: "none",
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    promptInputFootprintTokens: 0,
    maxEstimatedContextTokens: 0,
    maxContextUtilization: 0,
    fileChangeCount: 0,
    models: [],
    providers: [],
  };
}

export function aggregateUsageSummaries(
  summaries: SessionUsageBreakdown[],
): AggregateUsageBreakdown {
  const models = new Set<string>();
  const providers = new Set<string>();

  const total = summaries.reduce(
    (acc, summary) => {
      if (summary.source === "assistant_message_end") {
        acc.richUsageSessions += 1;
        acc.richUsageTurns += summary.turnCount;
      } else if (summary.source === "token_usage") {
        acc.fallbackUsageSessions += 1;
        acc.fallbackUsageTurns += summary.turnCount;
      }

      acc.inputTokens += summary.inputTokens;
      acc.outputTokens += summary.outputTokens;
      acc.cacheCreationInputTokens += summary.cacheCreationInputTokens;
      acc.cacheReadInputTokens += summary.cacheReadInputTokens;
      acc.promptInputFootprintTokens += summary.promptInputFootprintTokens;
      acc.maxEstimatedContextTokens = Math.max(
        acc.maxEstimatedContextTokens,
        summary.maxEstimatedContextTokens,
      );
      acc.maxContextUtilization = Math.max(
        acc.maxContextUtilization,
        summary.maxContextUtilization,
      );
      acc.fileChangeCount += summary.fileChangeCount;

      for (const model of summary.models) models.add(model);
      for (const provider of summary.providers) providers.add(provider);

      return acc;
    },
    {
      richUsageSessions: 0,
      fallbackUsageSessions: 0,
      richUsageTurns: 0,
      fallbackUsageTurns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      promptInputFootprintTokens: 0,
      maxEstimatedContextTokens: 0,
      maxContextUtilization: 0,
      fileChangeCount: 0,
    },
  );

  return {
    ...total,
    models: Array.from(models).sort(),
    providers: Array.from(providers).sort(),
  };
}
