import { describe, expect, it } from "vitest";

import {
  getExternalAgentScenario,
} from "../../scripts/external-agents/lib/external-agent-scenarios.mjs";
import {
  buildExternalBenchmarkResult,
  normalizeAdapterLabel,
} from "../../scripts/external-agents/lib/external-agent-utils.mjs";

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
});
