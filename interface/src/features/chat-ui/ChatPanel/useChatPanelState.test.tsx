import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { useChatPanelState } from "./useChatPanelState";

const scrollAnchorMocks = vi.hoisted(() => {
  const handleScroll = vi.fn();
  const scrollToBottom = vi.fn();
  const useScrollAnchorV2 = vi.fn(() => ({
    handleScroll,
    scrollToBottom,
    isAutoFollowing: true,
  }));

  return { handleScroll, scrollToBottom, useScrollAnchorV2 };
});
const mockHandleScroll = scrollAnchorMocks.handleScroll;
const mockScrollToBottom = scrollAnchorMocks.scrollToBottom;
const mockUseScrollAnchorV2 = scrollAnchorMocks.useScrollAnchorV2;
const mockEnqueue = vi.fn();
const mockDequeue = vi.fn();
const mockRemove = vi.fn();
const mockSetDraft = vi.fn();
const mockChatUI: {
  selectedMode: "code" | "plan" | "image" | "3d" | "video";
  selectedModel: string | null;
  selectedEffort: null;
  imageQuality: "medium";
  pinnedSourceImage: { imageUrl: string; originalUrl?: string; prompt: string } | null;
  councilCount: 1;
  councilModels: [];
  councilMechanism: "synthesize";
  answerStrategy: "single";
  secondOpinionReference: null;
  init: ReturnType<typeof vi.fn>;
  syncAvailableModels: ReturnType<typeof vi.fn>;
  setSelectedMode: ReturnType<typeof vi.fn>;
  setSelectedModel: ReturnType<typeof vi.fn>;
  setCouncilCount: ReturnType<typeof vi.fn>;
  setCouncilModel: ReturnType<typeof vi.fn>;
  setCouncilMechanism: ReturnType<typeof vi.fn>;
  setAnswerStrategy: ReturnType<typeof vi.fn>;
  setSecondOpinionReference: ReturnType<typeof vi.fn>;
  setSelectedEffort: ReturnType<typeof vi.fn>;
  setImageQuality: ReturnType<typeof vi.fn>;
  setProjectId: ReturnType<typeof vi.fn>;
  setPinnedSourceImage: ReturnType<typeof vi.fn>;
} = {
  selectedMode: "code",
  selectedModel: "gpt-5.4",
  selectedEffort: null,
  imageQuality: "medium",
  pinnedSourceImage: null,
  councilCount: 1,
  councilModels: [],
  councilMechanism: "synthesize",
  answerStrategy: "single",
  secondOpinionReference: null,
  init: vi.fn(),
  syncAvailableModels: vi.fn(),
  setSelectedMode: vi.fn(),
  setSelectedModel: vi.fn(),
  setCouncilCount: vi.fn(),
  setCouncilModel: vi.fn(),
  setCouncilMechanism: vi.fn(),
  setAnswerStrategy: vi.fn(),
  setSecondOpinionReference: vi.fn(),
  setSelectedEffort: vi.fn(),
  setImageQuality: vi.fn(),
  setProjectId: vi.fn(),
  setPinnedSourceImage: vi.fn(),
};

let mockIsStreaming = false;
// Loosened from `Array<{ id: string }>` so individual tests can drive
// the snapshot through richer message shapes (e.g. assistant events
// with `toolCalls`) without fighting TypeScript at the call site.
let mockStreamMessages: Array<Record<string, unknown>> = [];
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;

vi.mock("../../../shared/hooks/use-scroll-anchor-v2", () => ({
  useScrollAnchorV2: scrollAnchorMocks.useScrollAnchorV2,
}));

vi.mock("../../../hooks/use-load-older-messages", () => ({
  useLoadOlderMessages: () => ({
    loadOlder: vi.fn(),
    isLoadingOlder: false,
    hasOlderMessages: false,
  }),
}));

vi.mock("../../../stores/chat-view-store", () => ({
  useChatViewStore: {
    getState: () => ({
      incrementUnread: vi.fn(),
      resetUnread: vi.fn(),
    }),
  },
  useThreadView: () => ({
    olderCursor: null,
    newerCursor: null,
    hasOlderMessages: false,
    pinnedToBottom: true,
    unreadCount: 0,
  }),
}));

vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
  useStreamEvents: () => mockStreamMessages,
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: false }),
}));

vi.mock("../../../constants/models", () => ({
  availableModelsForAdapter: () => [],
}));

vi.mock("../../../stores/chat-ui-store", () => ({
  useChatUI: () => mockChatUI,
  // The hook only writes drafts imperatively (clear-on-send, queue
  // edit); the live draft subscription lives in `DraftedInputBar`.
  useChatUIStore: {
    getState: () => ({ setDraft: mockSetDraft }),
  },
}));

vi.mock("../../../stores/message-queue-store", () => ({
  useMessageQueueStore: {
    getState: () => ({
      enqueue: mockEnqueue,
      dequeue: mockDequeue,
      remove: mockRemove,
      moveUp: vi.fn(),
    }),
  },
  useMessageQueue: () => [],
}));

vi.mock("../../../constants/commands", () => ({
  isGenerationCommand: (id: string) => id === "generate_image" || id === "generate_3d" || id === "generate_video",
}));

describe("useChatPanelState", () => {
  beforeEach(() => {
    mockIsStreaming = false;
    mockStreamMessages = [];
    mockChatUI.selectedModel = "gpt-5.4";
    mockChatUI.selectedMode = "code";
    mockChatUI.pinnedSourceImage = null;
    mockHandleScroll.mockReset();
    mockScrollToBottom.mockReset();
    mockUseScrollAnchorV2.mockClear();
    mockEnqueue.mockReset();
    mockDequeue.mockReset();
    mockRemove.mockReset();
    mockSetDraft.mockReset();
    mockChatUI.init.mockReset();
    mockChatUI.syncAvailableModels.mockReset();
    mockChatUI.setSelectedMode.mockReset();
    mockChatUI.setPinnedSourceImage.mockReset();
    requestAnimationFrameSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
  });

  afterEach(() => {
    requestAnimationFrameSpy?.mockRestore();
    requestAnimationFrameSpy = null;
  });

  it("re-anchors to the bottom when an idle send adds a new message", () => {
    const onSend = vi.fn();
    const { result, rerender } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
      }),
    );

    act(() => result.current.handleSend("Hello"));

    expect(onSend).toHaveBeenCalledWith(
      "Hello",
      null,
      "gpt-5.4",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);

    mockStreamMessages = [{ id: "msg-1", role: "assistant", content: "" }];
    act(() => {
      rerender();
    });

    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("does not re-arm auto-follow when a follow-up queues during the active response", () => {
    mockIsStreaming = true;
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
      }),
    );

    act(() => result.current.handleSend("Queued follow-up"));

    expect(onSend).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      "stream-1",
      expect.objectContaining({
        content: "Queued follow-up",
        action: null,
        attachments: undefined,
        commands: undefined,
      }),
    );
    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });

  it("blocks direct, queued, and send-now paths when sending is disabled", () => {
    mockIsStreaming = true;
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { result, rerender } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        onStop,
        sendDisabled: true,
      }),
    );

    act(() => result.current.handleSend("Blocked direct"));
    expect(onSend).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();

    act(() =>
      result.current.handleQueueSendNow({
        id: "q-1",
        content: "Blocked queued",
        action: null,
      }),
    );
    expect(mockRemove).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();

    mockDequeue.mockReturnValueOnce({
      id: "q-2",
      content: "Blocked dequeue",
      action: null,
    });
    mockIsStreaming = false;
    act(() => {
      rerender();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps image mode active after an idle send", () => {
    mockChatUI.selectedModel = "gpt-image-2";
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
      }),
    );

    act(() => {
      result.current.setCommands([
        {
          id: "generate_image",
          label: "Image",
          description: "Generate an image from a text prompt",
          category: "Generation",
        },
      ]);
    });

    act(() => result.current.handleSend("Draw a fox", undefined, undefined, "image"));

    expect(onSend).toHaveBeenCalledWith(
      "Draw a fox",
      null,
      "gpt-image-2",
      undefined,
      ["generate_image"],
      undefined,
      "image",
    );
    expect(result.current.commands.map((command) => command.id)).toEqual([
      "generate_image",
    ]);
  });

  it("preserves image model and generation mode for queued sends", () => {
    mockIsStreaming = true;
    mockChatUI.selectedModel = "gpt-image-2";
    const onSend = vi.fn();
    const { result, rerender } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        selectedProjectId: "project-1",
      }),
    );

    act(() => result.current.handleSend("Draw a fox", undefined, undefined, "image"));

    expect(mockEnqueue).toHaveBeenCalledWith(
      "stream-1",
      expect.objectContaining({
        content: "Draw a fox",
        action: null,
        model: "gpt-image-2",
        generationMode: "image",
      }),
    );

    mockDequeue.mockReturnValueOnce({
      id: "q-1",
      content: "Draw a fox",
      action: null,
      model: "gpt-image-2",
      commands: ["generate_image"],
      generationMode: "image",
    });
    mockIsStreaming = false;

    act(() => {
      rerender();
    });

    expect(onSend).toHaveBeenCalledWith(
      "Draw a fox",
      null,
      "gpt-image-2",
      undefined,
      ["generate_image"],
      "project-1",
      "image",
      undefined,
      undefined,
      "q-1",
    );
  });

  it("preserves exact agent bindings while a chat send is queued", () => {
    mockIsStreaming = true;
    const onSend = vi.fn();
    const mentions = [
      { agent_id: "agent-maya", agent_instance_id: "instance-maya" },
    ];
    const { result, rerender } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        selectedProjectId: "project-1",
      }),
    );

    act(() =>
      result.current.handleSend(
        "Ask @Maya to review",
        undefined,
        undefined,
        undefined,
        mentions,
      ),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      "stream-1",
      expect.objectContaining({ agentMentions: mentions }),
    );

    mockDequeue.mockReturnValueOnce({
      id: "q-agent",
      content: "Ask @Maya to review",
      action: null,
      model: "gpt-5.4",
      agentMentions: mentions,
    });
    mockIsStreaming = false;
    act(() => rerender());

    expect(onSend).toHaveBeenCalledWith(
      "Ask @Maya to review",
      null,
      "gpt-5.4",
      undefined,
      undefined,
      "project-1",
      undefined,
      undefined,
      mentions,
      "q-agent",
    );
  });

  it("3D model step: forwards the pinned source image URL from chat-ui-store (not from chat history)", () => {
    mockChatUI.selectedMode = "3d";
    mockChatUI.selectedModel = "tripo-v2";
    // The pin lives on the store; chat history is intentionally
    // populated with a *different* image to prove the resolver does
    // not derive from messages anymore.
    mockChatUI.pinnedSourceImage = {
      imageUrl: "https://cdn.example.com/owl-pinned.png",
      prompt: "an owl",
    };
    mockStreamMessages = [
      {
        id: "m-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-img",
            name: "generate_image",
            input: {},
            result: JSON.stringify({
              imageUrl: "https://cdn.example.com/different-image.png",
              artifactId: "art-other",
            }),
          },
        ],
      },
    ];
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        selectedProjectId: "project-1",
      }),
    );

    act(() => result.current.handleSend("optional refinement"));

    expect(onSend).toHaveBeenCalledWith(
      "optional refinement",
      null,
      null,
      undefined,
      ["generate_3d"],
      "project-1",
      "3d",
      "https://cdn.example.com/owl-pinned.png",
    );
  });

  it("3D image step: dispatches with no source URL when no thumb is pinned", () => {
    mockChatUI.selectedMode = "3d";
    mockChatUI.selectedModel = "tripo-v2";
    mockChatUI.pinnedSourceImage = null;
    // History contains a generated image; the resolver should NOT
    // pick it up — only the per-stream pin slot drives 3D source
    // resolution.
    mockStreamMessages = [
      {
        id: "m-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-img",
            name: "generate_image",
            input: {},
            result: JSON.stringify({
              imageUrl: "https://cdn.example.com/owl.png",
              artifactId: "art-owl",
            }),
          },
        ],
      },
    ];
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        selectedProjectId: "project-1",
      }),
    );

    act(() => result.current.handleSend("a brass robot"));

    expect(onSend).toHaveBeenCalledWith(
      "a brass robot",
      null,
      null,
      undefined,
      ["generate_3d"],
      "project-1",
      "3d",
      undefined,
    );
  });

  it("does not trigger an extra bottom scroll when streaming finishes without a queued send", () => {
    mockIsStreaming = true;
    const onSend = vi.fn();
    const { rerender } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
      }),
    );

    mockIsStreaming = false;

    act(() => {
      rerender();
    });

    expect(mockDequeue).toHaveBeenCalledWith("stream-1");
    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });

  it("passes reset scroll behavior through to the scroll anchor", () => {
    const onSend = vi.fn();

    renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        scrollResetKey: "agent-1",
        scrollToBottomOnReset: false,
      }),
    );

    expect(mockUseScrollAnchorV2).toHaveBeenCalledWith(
      expect.anything(),
      {
        resetKey: "agent-1",
        scrollToBottomOnReset: false,
      },
    );
  });

  // Force-send aborts the current turn AND dispatches inline. The
  // upstream `stopStreaming` clears the in-flight latch synchronously
  // (see `useAgentChatStream` / `use-chat-stream` `stopStreaming`),
  // so the chained `onSend` lands without being silently swallowed
  // by the sync re-entry guard. React 18 batches the
  // `setIsStreaming(false → true)` toggles, so there's no
  // `true → false` blip to race with the dequeue effect.
  it("handleQueueSendNow removes the item, calls onStop, then dispatches inline", () => {
    mockIsStreaming = true;
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        onStop,
        selectedProjectId: "project-1",
      }),
    );

    const queuedItem = {
      id: "q-1",
      content: "force me",
      action: null,
      model: "gpt-5.4",
      attachments: undefined,
      commands: undefined,
    };

    act(() => result.current.handleQueueSendNow(queuedItem));

    expect(mockRemove).toHaveBeenCalledWith("stream-1", "q-1");
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "force me",
      null,
      "gpt-5.4",
      undefined,
      undefined,
      "project-1",
      undefined,
      undefined,
      undefined,
      "q-1",
    );
    // Order matters: stop has to land before the dispatch so the
    // upstream latch is cleared before `sendMessage` re-enters.
    const stopOrder = onStop.mock.invocationCallOrder[0];
    const sendOrder = onSend.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(sendOrder);
  });

  it("handleQueueSendNow falls back to the selected model when the item omits one", () => {
    mockChatUI.selectedModel = "claude-fallback";
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
        onStop,
        selectedProjectId: "project-1",
      }),
    );

    act(() =>
      result.current.handleQueueSendNow({
        id: "q-2",
        content: "no model",
        action: null,
      }),
    );

    expect(onSend).toHaveBeenCalledWith(
      "no model",
      null,
      "claude-fallback",
      undefined,
      undefined,
      "project-1",
      undefined,
      undefined,
      undefined,
      "q-2",
    );
  });

  it("handleQueueSendNow no-ops the stop call when onStop is not provided", () => {
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useChatPanelState({
        streamKey: "stream-1",
        onSend,
      }),
    );

    expect(() =>
      act(() =>
        result.current.handleQueueSendNow({
          id: "q-3",
          content: "no stop wired",
          action: null,
        }),
      ),
    ).not.toThrow();

    expect(mockRemove).toHaveBeenCalledWith("stream-1", "q-3");
    expect(onSend).toHaveBeenCalledWith(
      "no stop wired",
      null,
      expect.any(String),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "q-3",
    );
  });
});
