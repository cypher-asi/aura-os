import { describe, expect, it } from "vitest";
import {
  persistedReasoningEffort,
  supportedReasoningEffort,
} from "./model-effort";

describe("model effort wire helpers", () => {
  it("keeps supported efforts for reasoning-capable models", () => {
    expect(supportedReasoningEffort("aura-gpt-6-astra", "max")).toBe("max");
    expect(supportedReasoningEffort("aura-gpt-6-sol", "minimal")).toBe(
      "minimal",
    );
    expect(supportedReasoningEffort("aura-claude-opus-5-5", "xhigh")).toBe(
      "xhigh",
    );
    expect(supportedReasoningEffort("aura-grok-4-7", "xhigh")).toBe("xhigh");
    expect(supportedReasoningEffort("aura-grok-4-6", "xhigh")).toBe("xhigh");
    expect(supportedReasoningEffort("aura-grok-4-5", "high")).toBe("high");
    expect(supportedReasoningEffort("aura-grok-4-3", "high")).toBe("high");
  });

  it("omits unsupported GPT-6 Astra no-reasoning effort", () => {
    expect(supportedReasoningEffort("aura-gpt-6-astra", "minimal")).toBe(
      undefined,
    );
  });

  it("omits unsupported Grok 4.5 reasoning efforts", () => {
    expect(supportedReasoningEffort("aura-grok-4-5", "minimal")).toBe(
      undefined,
    );
  });

  it("omits unsupported Grok 4.6 reasoning efforts", () => {
    expect(supportedReasoningEffort("aura-grok-4-6", "minimal")).toBe(
      undefined,
    );
    expect(supportedReasoningEffort("aura-grok-4-6", "max")).toBe(undefined);
  });

  it("omits stale efforts for models without effort controls", () => {
    expect(supportedReasoningEffort("aura-grok-build-0-1", "high")).toBe(
      undefined,
    );
    expect(persistedReasoningEffort("aura-grok-build-0-1")).toBe(undefined);
  });
});
