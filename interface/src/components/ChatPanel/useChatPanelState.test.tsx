import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { useChatPanelState } from "./useChatPanelState";

const mockHandleScroll = vi.fn();
const mockScrollToBottom = vi.fn();
const mockScrollToBottomIfPinned = vi.fn();
const mockEnqueue = vi.fn();
const mockChatUI = {
  selectedModel: "gpt-5.4",
  init: vi.fn(),
  syncAvailableModels: vi.fn(),
};

let mockIsStreaming = false;
let mockStreamMessages: Array<{ id: string }> = [];
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;

vi.mock("../../hooks/use-scroll-anchor", () => ({
  useScrollAnchor: () => ({
    handleScroll: mockHandleScroll,
    scrollToBottom: mockScrollToBottom,
    scrollToBottomIfPinned: mockScrollToBottomIfPinned,
    isAutoFollowing: true,
  }),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
  useStreamEvents: () => mockStreamMessages,
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: false }),
}));

vi.mock("../../constants/models", () => ({
  availableModelsForAdapter: () => [],
}));

vi.mock("../../stores/chat-ui-store", () => ({
  useChatUI: () => mockChatUI,
}));

vi.mock("../../stores/message-queue-store", () => ({
  useMessageQueueStore: {
    getState: () => ({
      enqueue: mockEnqueue,
      dequeue: vi.fn(),
      remove: vi.fn(),
      moveUp: vi.fn(),
    }),
  },
  useMessageQueue: () => [],
}));

vi.mock("../../constants/commands", () => ({
  isGenerationCommand: () => false,
}));

describe("useChatPanelState", () => {
  beforeEach(() => {
    mockIsStreaming = false;
    mockStreamMessages = [];
    mockHandleScroll.mockReset();
    mockScrollToBottom.mockReset();
    mockScrollToBottomIfPinned.mockReset();
    mockEnqueue.mockReset();
    mockChatUI.init.mockReset();
    mockChatUI.syncAvailableModels.mockReset();
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
});
