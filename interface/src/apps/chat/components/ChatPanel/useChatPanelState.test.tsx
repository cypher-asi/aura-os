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
const mockChatUI: {
  selectedMode: "code" | "plan" | "image" | "3d";
  selectedModel: string | null;
  init: ReturnType<typeof vi.fn>;
  syncAvailableModels: ReturnType<typeof vi.fn>;
  setSelectedMode: ReturnType<typeof vi.fn>;
} = {
  selectedMode: "code",
  selectedModel: "gpt-5.4",
  init: vi.fn(),
  syncAvailableModels: vi.fn(),
  setSelectedMode: vi.fn(),
};

let mockIsStreaming = false;
let mockStreamMessages: Array<{ id: string }> = [];
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;

vi.mock("../../../../shared/hooks/use-scroll-anchor-v2", () => ({
  useScrollAnchorV2: scrollAnchorMocks.useScrollAnchorV2,
}));

vi.mock("../../../../hooks/use-load-older-messages", () => ({
  useLoadOlderMessages: () => ({
    loadOlder: vi.fn(),
    isLoadingOlder: false,
    hasOlderMessages: false,
  }),
}));

vi.mock("../../../../stores/chat-view-store", () => ({
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

vi.mock("../../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
  useStreamEvents: () => mockStreamMessages,
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: false }),
}));

vi.mock("../../../../constants/models", () => ({
  availableModelsForAdapter: () => [],
}));

vi.mock("../../../../stores/chat-ui-store", () => ({
  useChatUI: () => mockChatUI,
}));

vi.mock("../../../../stores/message-queue-store", () => ({
  useMessageQueueStore: {
    getState: () => ({
      enqueue: mockEnqueue,
      dequeue: mockDequeue,
      remove: vi.fn(),
      moveUp: vi.fn(),
    }),
  },
  useMessageQueue: () => [],
}));

vi.mock("../../../../constants/commands", () => ({
  isGenerationCommand: (id: string) => id === "generate_image" || id === "generate_3d",
}));

describe("useChatPanelState", () => {
  beforeEach(() => {
    mockIsStreaming = false;
    mockStreamMessages = [];
    mockChatUI.selectedModel = "gpt-5.4";
    mockChatUI.selectedMode = "code";
    mockHandleScroll.mockReset();
    mockScrollToBottom.mockReset();
    mockUseScrollAnchorV2.mockClear();
    mockEnqueue.mockReset();
    mockDequeue.mockReset();
    mockChatUI.init.mockReset();
    mockChatUI.syncAvailableModels.mockReset();
    mockChatUI.setSelectedMode.mockReset();
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
    );
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);

    mockStreamMessages = [{ id: "msg-1" }];
    act(() => {
      rerender();
    });

    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("keeps queued sends bottom-anchored while a response is already streaming", () => {
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
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
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
});
