import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPersistedModel, persistModel } from "./models";

describe("model persistence", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(store)) delete store[k];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persistModel writes both an agent-scoped and adapter-scoped key", () => {
    persistModel("aura-claude-sonnet-4-6", "default", "agent-1");
    expect(store["aura-selected-model:agent:agent-1"]).toBe(
      "aura-claude-sonnet-4-6",
    );
    expect(store["aura-selected-model:default"]).toBe("aura-claude-sonnet-4-6");
  });

  it("persistModel without agentId only writes adapter key", () => {
    persistModel("aura-claude-opus-4-6", "default");
    expect(Object.keys(store)).toEqual(["aura-selected-model:default"]);
    expect(store["aura-selected-model:default"]).toBe("aura-claude-opus-4-6");
  });

  it("loadPersistedModel prefers the agent-scoped key over the adapter key", () => {
    persistModel("aura-claude-opus-4-6", "default");
    persistModel("aura-gpt-5-4", "default", "agent-a");
    expect(loadPersistedModel("default", null, "agent-a")).toBe("aura-gpt-5-4");
  });

  it("loadPersistedModel falls back to the adapter-scoped key when no agent value is stored", () => {
    persistModel("aura-claude-opus-4-6", "default");
    expect(loadPersistedModel("default", null, "new-agent")).toBe(
      "aura-claude-opus-4-6",
    );
  });

  it("different agents keep independent remembered models", () => {
    persistModel("aura-claude-sonnet-4-6", "default", "agent-a");
    persistModel("aura-gpt-5-4-mini", "default", "agent-b");
    expect(loadPersistedModel("default", null, "agent-a")).toBe(
      "aura-claude-sonnet-4-6",
    );
    expect(loadPersistedModel("default", null, "agent-b")).toBe(
      "aura-gpt-5-4-mini",
    );
  });

  it("ignores an agent value that isn't valid for the adapter", () => {
    persistModel("codex", "codex", "agent-codex");
    // The codex model id is invalid for the default adapter's model list,
    // so loadPersistedModel should fall through to the default.
    expect(loadPersistedModel("default", null, "agent-codex")).not.toBe("codex");
  });
});
