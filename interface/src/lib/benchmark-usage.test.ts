import { describe, expect, it } from "vitest";

import { aggregateUsageSummaries, summarizeSessionUsage } from "./benchmark-usage";

describe("summarizeSessionUsage", () => {
  it("prefers assistant_message_end usage and counts cache/context fields", () => {
    const summary = summarizeSessionUsage([
      {
        event_type: "assistant_message_end",
        content: {
          usage: {
            input_tokens: 1200,
            output_tokens: 450,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 800,
            estimated_context_tokens: 42000,
            context_utilization: 0.42,
            model: "claude-sonnet-4-5",
            provider: "anthropic",
          },
          files_changed: {
            created: ["src/app.ts"],
            modified: ["README.md"],
            deleted: [],
          },
        },
      },
      {
        event_type: "token_usage",
        content: {
          input_tokens: 99,
          output_tokens: 11,
        },
      },
    ]);

    expect(summary.source).toBe("assistant_message_end");
    expect(summary.turnCount).toBe(1);
    expect(summary.inputTokens).toBe(1200);
    expect(summary.outputTokens).toBe(450);
    expect(summary.cacheCreationInputTokens).toBe(200);
    expect(summary.cacheReadInputTokens).toBe(800);
    expect(summary.promptInputFootprintTokens).toBe(2200);
    expect(summary.maxEstimatedContextTokens).toBe(42000);
    expect(summary.maxContextUtilization).toBe(0.42);
    expect(summary.fileChangeCount).toBe(2);
    expect(summary.models).toEqual(["claude-sonnet-4-5"]);
    expect(summary.providers).toEqual(["anthropic"]);
  });

  it("falls back to token_usage when rich usage is unavailable", () => {
    const summary = summarizeSessionUsage([
      {
        event_type: "token_usage",
        content: {
          input_tokens: 500,
          output_tokens: 120,
        },
      },
    ]);

    expect(summary.source).toBe("token_usage");
    expect(summary.turnCount).toBe(1);
    expect(summary.inputTokens).toBe(500);
    expect(summary.outputTokens).toBe(120);
    expect(summary.promptInputFootprintTokens).toBe(500);
  });

  it("understands DeepSeek/OpenAI-style token and cache usage fields", () => {
    const summary = summarizeSessionUsage([
      {
        event_type: "assistant_message_end",
        content: {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 250,
            prompt_cache_miss_tokens: 300,
            prompt_cache_hit_tokens: 700,
            model: "deepseek-v4-pro",
            provider: "deepseek",
          },
        },
      },
    ]);

    expect(summary.source).toBe("assistant_message_end");
    expect(summary.inputTokens).toBe(1000);
    expect(summary.outputTokens).toBe(250);
    expect(summary.cacheCreationInputTokens).toBe(300);
    expect(summary.cacheReadInputTokens).toBe(700);
    expect(summary.promptInputFootprintTokens).toBe(2000);
    expect(summary.models).toEqual(["deepseek-v4-pro"]);
    expect(summary.providers).toEqual(["deepseek"]);
  });

  it("recognizes storage rows that use type instead of event_type", () => {
    const summary = summarizeSessionUsage([
      {
        type: "assistant_message_end",
        content: {
          usage: {
            input_tokens: 42,
            output_tokens: 9,
            cache_creation_input_tokens: 7,
            cache_read_input_tokens: 11,
            estimated_context_tokens: 1234,
            context_utilization: 0.12,
            model: "claude-sonnet-4-5-20260331",
            provider: "anthropic",
          },
          files_changed: {
            created: [],
            modified: ["server.js"],
            deleted: [],
          },
        },
      },
    ]);

    expect(summary.source).toBe("assistant_message_end");
    expect(summary.turnCount).toBe(1);
    expect(summary.inputTokens).toBe(42);
    expect(summary.outputTokens).toBe(9);
    expect(summary.cacheCreationInputTokens).toBe(7);
    expect(summary.cacheReadInputTokens).toBe(11);
    expect(summary.promptInputFootprintTokens).toBe(60);
    expect(summary.maxEstimatedContextTokens).toBe(1234);
    expect(summary.maxContextUtilization).toBe(0.12);
    expect(summary.fileChangeCount).toBe(1);
    expect(summary.models).toEqual(["claude-sonnet-4-5-20260331"]);
    expect(summary.providers).toEqual(["anthropic"]);
  });
});

describe("aggregateUsageSummaries", () => {
  it("merges session summaries into a benchmark-level total", () => {
    const aggregate = aggregateUsageSummaries([
      summarizeSessionUsage([
        {
          event_type: "assistant_message_end",
          content: {
            usage: {
              input_tokens: 1000,
              output_tokens: 300,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 400,
              estimated_context_tokens: 22000,
              context_utilization: 0.22,
              model: "claude-sonnet-4-5",
              provider: "anthropic",
            },
          },
        },
      ]),
      summarizeSessionUsage([
        {
          event_type: "token_usage",
          content: {
            input_tokens: 200,
            output_tokens: 50,
          },
        },
      ]),
    ]);

    expect(aggregate.richUsageSessions).toBe(1);
    expect(aggregate.fallbackUsageSessions).toBe(1);
    expect(aggregate.richUsageTurns).toBe(1);
    expect(aggregate.fallbackUsageTurns).toBe(1);
    expect(aggregate.inputTokens).toBe(1200);
    expect(aggregate.outputTokens).toBe(350);
    expect(aggregate.cacheCreationInputTokens).toBe(100);
    expect(aggregate.cacheReadInputTokens).toBe(400);
    expect(aggregate.promptInputFootprintTokens).toBe(1700);
    expect(aggregate.maxEstimatedContextTokens).toBe(22000);
    expect(aggregate.maxContextUtilization).toBe(0.22);
    expect(aggregate.models).toEqual(["claude-sonnet-4-5"]);
    expect(aggregate.providers).toEqual(["anthropic"]);
  });
});
