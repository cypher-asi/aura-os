import { beforeEach, describe, expect, it } from "vitest";
import { emptyDraft, useAgentOnboardingStore } from "./agent-onboarding-store";

function reset(): void {
  useAgentOnboardingStore.setState({
    isOpen: false,
    source: null,
    currentStep: 0,
    draft: emptyDraft(),
    pendingApply: false,
  });
}

const store = () => useAgentOnboardingStore.getState();

describe("useAgentOnboardingStore", () => {
  beforeEach(reset);

  it("opens with a source and navigates between steps with clamping", () => {
    store().open("hero");
    expect(store().isOpen).toBe(true);
    expect(store().source).toBe("hero");
    expect(store().currentStep).toBe(0);

    store().next();
    expect(store().currentStep).toBe(1);
    store().back();
    expect(store().currentStep).toBe(0);
    store().back();
    expect(store().currentStep).toBe(0);

    store().goTo(99);
    expect(store().currentStep).toBe(2);
  });

  it("toggles skill selection on and off", () => {
    store().toggleSkill("github");
    expect(store().draft.skills).toEqual(["github"]);
    store().toggleSkill("tavily");
    expect(store().draft.skills).toEqual(["github", "tavily"]);
    store().toggleSkill("github");
    expect(store().draft.skills).toEqual(["tavily"]);
  });

  it("only returns a draft from consumePendingDraft when an apply is pending", () => {
    expect(store().consumePendingDraft()).toBeNull();

    store().setPersonality("Sharp Analyst");
    store().markPendingApply();
    expect(store().pendingApply).toBe(true);

    const draft = store().consumePendingDraft();
    expect(draft?.personality).toBe("Sharp Analyst");
    expect(store().pendingApply).toBe(false);
    expect(store().consumePendingDraft()).toBeNull();
  });
});
