import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeQuickPromptDraft,
  useQuickPromptStore,
} from "./quick-prompt-store";

describe("quick-prompt-store", () => {
  beforeEach(() => {
    useQuickPromptStore.setState({
      isOpen: false,
      preferredAgentId: null,
      pendingPrompt: null,
    });
  });

  it("hands a queued prompt to its selected agent exactly once", () => {
    useQuickPromptStore.getState().queue("agent-1", "Investigate the failure");

    expect(useQuickPromptStore.getState().takeForAgent("agent-2")).toBeNull();
    expect(useQuickPromptStore.getState().takeForAgent("agent-1")).toBe(
      "Investigate the failure",
    );
    expect(useQuickPromptStore.getState().takeForAgent("agent-1")).toBeNull();
  });

  it("drops an abandoned handoff when the palette is opened again", () => {
    useQuickPromptStore.getState().queue("agent-1", "Stale thought");

    useQuickPromptStore.getState().open("agent-2");

    expect(useQuickPromptStore.getState().pendingPrompt).toBeNull();
  });

  it("preserves an existing composer draft when applying a quick prompt", () => {
    expect(mergeQuickPromptDraft("Existing notes  ", "New thought")).toBe(
      "Existing notes\n\nNew thought",
    );
    expect(mergeQuickPromptDraft("", "New thought")).toBe("New thought");
  });
});
