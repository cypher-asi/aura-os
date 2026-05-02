import { renderHook, act } from "@testing-library/react";
import { useChatStream } from "./use-chat-stream";
import { useStreamStore, streamMetaMap } from "./stream/store";
import { EventType } from "../shared/types/aura-events";

const mockSetStreamingAgentInstanceId = vi.fn();
const mockSetAgentStreaming = vi.fn();
const mockClearGeneratedArtifacts = vi.fn();
const mockSetActiveTab = vi.fn();
const mockPushSpec = vi.fn();
const mockPushTask = vi.fn();
const mockRemoveSpec = vi.fn();
const mockRemoveTask = vi.fn();
const mockNotifyAgentInstanceUpdate = vi.fn();

const mockSidekickState = {
  previewItem: null,
  streamingAgentInstanceIds: [] as string[],
  streamingAgentInstanceId: null as string | null,
  setStreamingAgentInstanceId: mockSetStreamingAgentInstanceId,
  setAgentStreaming: mockSetAgentStreaming,
  clearGeneratedArtifacts: mockClearGeneratedArtifacts,
  setActiveTab: mockSetActiveTab,
  pushSpec: mockPushSpec,
  pushTask: mockPushTask,
  removeSpec: mockRemoveSpec,
  removeTask: mockRemoveTask,
  notifyAgentInstanceUpdate: mockNotifyAgentInstanceUpdate,
};
vi.mock("../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../stores/project-action-store", () => ({
  useProjectActions: () => ({
    setProject: vi.fn(),
  }),
}));

vi.mock("../api/client", () => ({
  api: {
    sendEventStream: vi.fn().mockResolvedValue(undefined),
    getAgentInstance: vi.fn().mockResolvedValue({}),
  },
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => null),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
}));

vi.mock("../api/streams", () => ({
  generateImageStream: vi.fn().mockResolvedValue(undefined),
}));

import { api } from "../api/client";
import { generateImageStream } from "../api/streams";

describe("useChatStream", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    vi.clearAllMocks();
    vi.mocked(api.sendEventStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generateImageStream).mockReset().mockResolvedValue(undefined);
  });

  it("returns streamKey, sendMessage, stopStreaming, resetEvents", () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    expect(result.current.streamKey).toBeTruthy();
    expect(typeof result.current.sendMessage).toBe("function");
    expect(typeof result.current.stopStreaming).toBe("function");
    expect(typeof result.current.resetEvents).toBe("function");
  });

  it("does nothing when projectId is undefined", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: undefined, agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
  });

  it("does nothing when agentInstanceId is undefined", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: undefined }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
  });

  it("sends a message and creates a user message", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.sendEventStream).toHaveBeenCalled();
    const entry = useStreamStore.getState().entries[result.current.streamKey];
    expect(entry.events[0].role).toBe("user");
    expect(entry.events[0].content).toBe("hello");
  });

  it("routes image generation through the dedicated image stream", async () => {
    const attachments = [
      {
        type: "image" as const,
        media_type: "image/png",
        data: "abc123",
        name: "reference.png",
      },
    ];
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "draw a fox",
        null,
        "gpt-image-2",
        attachments,
        ["generate_image"],
        undefined,
        "image",
      );
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
    expect(
      useStreamStore.getState().entries[result.current.streamKey]?.progressText,
    ).toBe("Generating image...");
    expect(generateImageStream).toHaveBeenCalledWith(
      "draw a fox",
      "gpt-image-2",
      attachments,
      expect.any(Object),
      expect.any(AbortSignal),
      "p-1",
    );
  });

  it("persists completed image generation as a generated image tool card", async () => {
    vi.mocked(generateImageStream).mockImplementation(
      async (_prompt, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.GenerationCompleted,
          content: {
            mode: "image",
            imageUrl: "https://cdn.example.com/cat.png",
            originalUrl: "https://cdn.example.com/cat-original.png",
            artifactId: "artifact-cat",
          },
        } as any);
      },
    );

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "draw a cat",
        null,
        "gpt-image-2",
        undefined,
        ["generate_image"],
        undefined,
        "image",
      );
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const assistantEvent = entry.events.find((event) => event.role === "assistant");
    const imageTool = assistantEvent?.toolCalls?.find((tool) => tool.name === "generate_image");

    expect(imageTool).toMatchObject({
      pending: false,
      isError: false,
    });
    expect(JSON.parse(imageTool?.result ?? "{}")).toMatchObject({
      imageUrl: "https://cdn.example.com/cat.png",
      artifactId: "artifact-cat",
    });
    expect(entry.activeToolCalls).toHaveLength(0);
  });

  it("does nothing for empty content without action", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("   ");
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
  });

  it("sets streaming agent instance ID during send", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockSetAgentStreaming).toHaveBeenCalledWith("ai-1", true);
  });

  it("handles generate_specs action", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("", "generate_specs");
    });

    expect(mockClearGeneratedArtifacts).toHaveBeenCalled();
    expect(mockSetActiveTab).toHaveBeenCalledWith("specs");
  });

  it("handles stream errors gracefully", async () => {
    vi.mocked(api.sendEventStream).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const errorMsg = entry.events.find((m) => m.content.includes("Error"));
    expect(errorMsg).toBeTruthy();
  });

  it("ignores AbortError", async () => {
    vi.mocked(api.sendEventStream).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const errorMsgs = entry.events.filter((m) => m.content.includes("Error"));
    expect(errorMsgs).toHaveLength(0);
  });

  it("clears streaming agent ID after completion", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockSetAgentStreaming).toHaveBeenCalledWith("ai-1", false);
  });

  it("marks only the next project send as a new session", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage("first");
      await result.current.sendMessage("second");
    });

    expect(api.sendEventStream).toHaveBeenNthCalledWith(
      1,
      "p-1",
      "ai-1",
      "first",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      true,
    );
    expect(api.sendEventStream).toHaveBeenNthCalledWith(
      2,
      "p-1",
      "ai-1",
      "second",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      false,
    );
  });
});
