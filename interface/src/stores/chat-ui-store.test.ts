import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChatUIStore } from "./chat-ui-store";

const mockLoadPersistedModel = vi.fn(
  (_adapterType?: string, _defaultModel?: string | null, _agentId?: string) =>
    "claude-opus-4-6",
);
const mockHasAgentScopedModel = vi.fn((_agentId: string) => false);
const mockLoadPersistedImageModel = vi.fn((_agentId?: string) => "gpt-image-2");

vi.mock("../constants/models", () => ({
  availableModelsForAdapter: (_adapterType?: string) => [
    { id: "claude-opus-4-6", label: "Opus 4.6", tier: "opus", mode: "chat" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "sonnet", mode: "chat" },
  ],
  defaultModelForAdapter: (_adapterType?: string) => "claude-opus-4-6",
  loadPersistedModel: (
    adapterType?: string,
    defaultModel?: string | null,
    agentId?: string,
  ) => mockLoadPersistedModel(adapterType, defaultModel, agentId),
  loadPersistedImageModel: (agentId?: string) =>
    mockLoadPersistedImageModel(agentId),
  persistModel: vi.fn(),
  hasAgentScopedModel: (agentId: string) => mockHasAgentScopedModel(agentId),
}));

function resetStore() {
  useChatUIStore.setState({ streams: {} });
}

describe("chat-ui-store", () => {
  beforeEach(() => {
    resetStore();
    try {
      localStorage.clear();
    } catch {
      // localStorage may be unavailable
    }
    mockLoadPersistedModel.mockImplementation(
      (_adapterType?: string, _defaultModel?: string | null, _agentId?: string) =>
        "claude-opus-4-6",
    );
    mockHasAgentScopedModel.mockImplementation(() => false);
    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");
  });

  it("init populates selectedModel from persisted value", () => {
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-opus-4-6");
  });

  it("init is idempotent when model already set", () => {
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "claude-sonnet-4-6");
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-sonnet-4-6");
  });

  it("setSelectedModel updates the stream and persists", async () => {
    const { persistModel } = await import("../constants/models");
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "claude-sonnet-4-6", "default");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-sonnet-4-6");
    expect(persistModel).toHaveBeenCalledWith("claude-sonnet-4-6", "default", undefined);
  });

  it("setSelectedModel forwards agentId to persistModel", async () => {
    const { persistModel } = await import("../constants/models");
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    useChatUIStore
      .getState()
      .setSelectedModel("stream-1", "claude-sonnet-4-6", "default", "agent-xyz");
    expect(persistModel).toHaveBeenCalledWith(
      "claude-sonnet-4-6",
      "default",
      "agent-xyz",
    );
  });

  it("getSelectedModel returns null for unknown stream", () => {
    expect(useChatUIStore.getState().getSelectedModel("unknown")).toBeNull();
  });

  it("setProjectId stores and retrieves project id", () => {
    useChatUIStore.getState().setProjectId("stream-1", "proj-abc");
    expect(useChatUIStore.getState().streams["stream-1"]?.projectId).toBe("proj-abc");
  });

  it("setProjectId with null clears the value", () => {
    useChatUIStore.getState().setProjectId("stream-1", "proj-abc");
    useChatUIStore.getState().setProjectId("stream-1", null);
    expect(useChatUIStore.getState().streams["stream-1"]?.projectId).toBeNull();
  });

  it("syncAvailableModels keeps current model if still valid", () => {
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "claude-sonnet-4-6");
    useChatUIStore.getState().syncAvailableModels("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-sonnet-4-6");
  });

  it("syncAvailableModels resets to default when current model is unavailable", () => {
    useChatUIStore.getState().init("stream-1");
    useChatUIStore.getState().setSelectedModel("stream-1", "nonexistent-model");
    useChatUIStore.getState().syncAvailableModels("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe("claude-opus-4-6");
  });

  it("multiple streams are independent", () => {
    useChatUIStore.getState().init("stream-a");
    useChatUIStore.getState().init("stream-b");
    useChatUIStore.getState().setSelectedModel("stream-a", "claude-sonnet-4-6");
    expect(useChatUIStore.getState().streams["stream-a"]?.selectedModel).toBe("claude-sonnet-4-6");
    expect(useChatUIStore.getState().streams["stream-b"]?.selectedModel).toBe("claude-opus-4-6");
  });

  it("init re-reads the per-agent value on a later pass after agent metadata resolves", () => {
    // Pass 1: adapter metadata not yet available, so the persisted lookup
    // returns the adapter default.
    mockLoadPersistedModel.mockImplementation(() => "claude-opus-4-6");
    useChatUIStore.getState().init("stream-1", undefined, null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-opus-4-6",
    );

    // Pass 2: the agent's real per-agent value is now discoverable. init
    // must replace the earlier adapter-default install.
    mockHasAgentScopedModel.mockImplementation(() => true);
    mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("init leaves an existing selection alone when the agent has no per-agent key", () => {
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    useChatUIStore
      .getState()
      .setSelectedModel("stream-1", "claude-sonnet-4-6", "default", "agent-xyz");
    // No agent-scoped key recorded; a later init pass must not overwrite
    // the user's current in-memory pick with some stale persisted value.
    mockHasAgentScopedModel.mockImplementation(() => false);
    mockLoadPersistedModel.mockImplementation(() => "claude-opus-4-6");
    useChatUIStore.getState().init("stream-1", "default", null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("syncAvailableModels upgrades to the per-agent value when it differs from current", () => {
    // Current selection is valid for the adapter but is the adapter
    // default that init installed before metadata resolved. The agent
    // actually has its own remembered value; sync should upgrade to it.
    mockLoadPersistedModel.mockImplementation(() => "claude-opus-4-6");
    useChatUIStore.getState().init("stream-1", undefined, null, "agent-xyz");

    mockHasAgentScopedModel.mockImplementation(() => true);
    mockLoadPersistedModel.mockImplementation(() => "claude-sonnet-4-6");
    useChatUIStore
      .getState()
      .syncAvailableModels("stream-1", "default", null, "agent-xyz");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("init seeds the image model when the persisted mode is `image`", () => {
    // The persisted mode lives in localStorage; the real
    // `loadPersistedAgentMode` reads from there. Setting the default
    // mode key to "image" must steer init through the image-model
    // branch (not the chat fallback that would land on Sonnet/Opus).
    localStorage.setItem("aura-selected-mode:default", "image");
    mockLoadPersistedImageModel.mockClear();
    mockLoadPersistedModel.mockClear();
    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");

    useChatUIStore.getState().init("stream-1");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe("image");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );
    // The chat-model loader must NOT have been consulted on the
    // image path; otherwise a stale Sonnet id leaks through.
    expect(mockLoadPersistedModel).not.toHaveBeenCalled();
    expect(mockLoadPersistedImageModel).toHaveBeenCalled();
  });

  it("setSelectedMode switching from chat to image installs the image default", () => {
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe("code");

    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");
    useChatUIStore.getState().setSelectedMode("stream-1", "image");

    expect(useChatUIStore.getState().streams["stream-1"]?.selectedMode).toBe("image");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );
  });

  it("syncAvailableModels keeps the image model when in image mode", () => {
    localStorage.setItem("aura-selected-mode:default", "image");
    mockLoadPersistedImageModel.mockImplementation(() => "gpt-image-2");
    useChatUIStore.getState().init("stream-1");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );

    // A chat-adapter sync arrives later (e.g. when adapter metadata
    // resolves). It MUST NOT clobber the image model with a chat one.
    useChatUIStore.getState().syncAvailableModels("stream-1", "default");
    expect(useChatUIStore.getState().streams["stream-1"]?.selectedModel).toBe(
      "gpt-image-2",
    );
  });
});
