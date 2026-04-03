import { describe, expect, it } from "vitest";

import {
  getExternalAgentScenario,
} from "../../scripts/external-agents/lib/external-agent-scenarios.mjs";
import {
  buildExternalBenchmarkResult,
  normalizeAdapterLabel,
} from "../../scripts/external-agents/lib/external-agent-utils.mjs";
import {
  extractClaudeCodeUsageFromStreamJson,
  extractCodexUsageFromJsonl,
} from "../../scripts/external-agents/lib/external-agent-usage.mjs";

describe("external agent benchmark helpers", () => {
  it("resolves the external static site scenario from existing fixtures", () => {
    const scenario = getExternalAgentScenario(process.cwd(), "external-static-site");

    expect(scenario.id).toBe("external-static-site");
    expect(scenario.fixtureDir).toContain("hello-world-static-site");
    expect(scenario.validationCommand?.command).toBe("node");
    expect(scenario.prompt).toContain("requirements.md");
  });

  it("builds a normalized benchmark result", () => {
    const result = buildExternalBenchmarkResult({
      adapterId: "codex",
      scenario: {
        id: "demo",
        title: "Demo",
        adapterMode: "single-shot",
      },
      command: { bin: "codex", args: ["exec", "-"] },
      processResult: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        wallClockMs: 1234,
        stdout: "done",
        stderr: "",
      },
      validation: {
        passed: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      },
      workspaceArtifacts: {
        patchPath: "/tmp/demo.patch",
        changedFiles: {
          created: ["index.html"],
          modified: ["styles.css"],
          deleted: [],
        },
      },
      transcriptPath: "/tmp/demo.jsonl",
      workspaceDir: "/tmp/work",
      usage: null,
      provider: "openai",
      model: "gpt-5.4",
    });

    expect(normalizeAdapterLabel("claude-code")).toBe("Claude Code");
    expect(result.success).toBe(true);
    expect(result.filesChanged.modified).toContain("styles.css");
    expect(result.usage.provider).toBe("openai");
  });

  it("extracts Claude Code cost and token usage from stream-json output", () => {
    const parsed = extractClaudeCodeUsageFromStreamJson([
      JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-4-6" }),
      JSON.stringify({
        type: "result",
        total_cost_usd: 0.123456,
        usage: {
          input_tokens: 11,
          output_tokens: 22,
          cache_creation_input_tokens: 33,
          cache_read_input_tokens: 44,
        },
        modelUsage: {
          "claude-sonnet-4-6": {},
        },
      }),
    ].join("\n"));

    expect(parsed?.model).toBe("claude-sonnet-4-6");
    expect(parsed?.usage.estimatedCostUsd).toBe(0.123456);
    expect(parsed?.usage.cacheReadInputTokens).toBe(44);
  });

  it("extracts Codex token usage and estimates cost when model is known", () => {
    const parsed = extractCodexUsageFromJsonl([
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 2000,
          output_tokens: 3000,
        },
      }),
    ].join("\n"), "gpt-5.3-codex");

    expect(parsed?.provider).toBe("openai");
    expect(parsed?.usage.inputTokens).toBe(1000);
    expect(parsed?.usage.cacheReadInputTokens).toBe(2000);
    expect(parsed?.usage.estimatedCostUsd).toBeCloseTo(0.0441, 6);
  });
});
