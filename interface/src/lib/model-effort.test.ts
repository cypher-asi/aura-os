import { describe, expect, it } from "vitest";
import {
  persistedReasoningEffort,
  supportedReasoningEffort,
} from "./model-effort";

describe("model effort wire helpers", () => {
  it("keeps supported efforts for reasoning-capable models", () => {
    expect(supportedReasoningEffort("aura-grok-4-3", "high")).toBe("high");
  });

  it("omits stale efforts for models without effort controls", () => {
    expect(supportedReasoningEffort("aura-grok-build-0-1", "high")).toBe(
      undefined,
    );
    expect(persistedReasoningEffort("aura-grok-build-0-1")).toBe(undefined);
  });
});
