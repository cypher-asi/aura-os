import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuraDesktopWindowPersistence,
  applyAuraCaptureSeedPlan,
  persistAuraCaptureTarget,
  readAuraCaptureBridgeState,
  resolveAuraCaptureTargetAppId,
  resolveAuraCaptureTargetPath,
  shouldApplyAgentChatSeed,
} from "./capture-bridge";

function installLocalStorageStub() {
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
}

function makeVisible(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    throw new Error(`Missing test element for selector ${selector}`);
  }
  element.getBoundingClientRect = vi.fn(() => ({
    width: 120,
    height: 80,
    top: 0,
    right: 120,
    bottom: 80,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })) as unknown as typeof element.getBoundingClientRect;
}

describe("capture-bridge helpers", () => {
  beforeEach(() => {
    installLocalStorageStub();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/agents");
    vi.restoreAllMocks();
  });

  it("prefers an explicit target path when it is a valid shell route", () => {
    expect(
      resolveAuraCaptureTargetPath({
        targetAppId: "feedback",
        targetPath: "/agents/agent-1?host=test",
      }),
    ).toBe("/agents/agent-1");
  });

  it("maps a known target app id to its base path", () => {
    expect(resolveAuraCaptureTargetPath({ targetAppId: "feedback" })).toBe("/feedback");
  });

  it("derives the target app id from a target path when the id is omitted", () => {
    expect(resolveAuraCaptureTargetAppId({ targetPath: "/notes/doc-1" })).toBe("notes");
  });

  it("persists the capture target so a refresh re-enters the same shell route", () => {
    persistAuraCaptureTarget("/feedback", "feedback");
    expect(window.localStorage.getItem("aura-previous-path")).toBe("/feedback");
    expect(window.localStorage.getItem("aura-last-app")).toBe("feedback");
  });

  it("clears persisted desktop windows for a clean shell reset", () => {
    window.localStorage.setItem("aura:desktopWindows", JSON.stringify({ some: "window" }));
    clearAuraDesktopWindowPersistence();
    expect(window.localStorage.getItem("aura:desktopWindows")).toBeNull();
  });

  it("reads the visible shell state and validates the requested target", () => {
    window.history.replaceState({}, "", "/feedback");
    document.body.innerHTML = `
      <button data-agent-role="app-launcher">Feedback</button>
      <main
        data-agent-surface="main-panel"
        data-agent-active-app-id="feedback"
        data-agent-active-app-label="Feedback"
      ></main>
      <aside data-agent-surface="sidekick-panel"></aside>
    `;
    makeVisible('[data-agent-role="app-launcher"]');
    makeVisible('[data-agent-surface="main-panel"]');
    makeVisible('[data-agent-surface="sidekick-panel"]');

    const state = readAuraCaptureBridgeState({
      targetAppId: "feedback",
      targetPath: "/feedback",
    });

    expect(state.shellVisible).toBe(true);
    expect(state.routeMatched).toBe(true);
    expect(state.activeAppMatched).toBe(true);
    expect(state.activeAppId).toBe("feedback");
  });

  it("reports non-matching state when the current route does not match the requested target", () => {
    window.history.replaceState({}, "", "/agents");
    document.body.innerHTML = `
      <main
        data-agent-surface="main-panel"
        data-agent-active-app-id="agents"
        data-agent-active-app-label="Agents"
      ></main>
    `;
    makeVisible('[data-agent-surface="main-panel"]');

    const state = readAuraCaptureBridgeState({
      targetAppId: "feedback",
      targetPath: "/feedback",
    });

    expect(state.routeMatched).toBe(false);
    expect(state.activeAppMatched).toBe(false);
  });

  it("uses proof and context boundaries when deciding whether to seed agent chat", () => {
    expect(
      shouldApplyAgentChatSeed({
        capabilities: ["desktop proof"],
        proofBoundary: ["The chat model picker menu shows GPT-5.5"],
        contextBoundary: ["The agent chat input remains visible"],
      }, null),
    ).toBe(true);
  });

  it("resolves requested chat seed models from the live model catalog", async () => {
    const result = await applyAuraCaptureSeedPlan({
      capabilities: ["app:agents", "agent-chat-ready", "model-picker-open"],
      proofBoundary: ["Show DeepSeek V4 Pro in the model picker"],
      contextBoundary: ["The chat input remains visible"],
    }, "agents");

    expect(result.applied).toContain("agent-chat-demo-model-picker:aura-deepseek-v4-pro");
  });
});
