import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChatUIStore } from "./chat-ui-store";

vi.mock("../constants/models", () => ({
  availableModelsForAdapter: (adapterType?: string) =>
    adapterType === "codex"
      ? [{ id: "codex", label: "Codex", tier: "sonnet", mode: "chat" }]
      : [
          { id: "claude-opus-4-6", label: "Opus 4.6", tier: "opus", mode: "chat" },
          { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "sonnet", mode: "chat" },
        ],
  defaultModelForAdapter: (adapterType?: string) =>
    adapterType === "codex" ? "codex" : "claude-opus-4-6",
  loadPersistedModel: (_adapterType?: string, _defaultModel?: string | null) => "claude-opus-4-6",
  persistModel: vi.fn(),
}));

function resetStore() {
  useChatUIStore.setState({ streams: {} });
}

describe("chat-ui-store", () => {
  beforeEach(() => {
    resetStore();
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
    expect(persistModel).toHaveBeenCalledWith("claude-sonnet-4-6", "default");
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
});
