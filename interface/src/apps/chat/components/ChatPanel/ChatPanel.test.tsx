import { render, screen } from "@testing-library/react";
import { act, useLayoutEffect, type ComponentProps } from "react";
import { vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { useMessageStore } from "../../../../stores/message-store";
import { useChatViewStore } from "../../../../stores/chat-view-store";

const mockUseAuraCapabilities = vi.fn();
let autoSignalInitialAnchorReady = false;
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
const sampleHistoryMessages: DisplaySessionEvent[] = [
  { id: "msg-1", role: "user", content: "Hello" },
];

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
  useStreamEvents: () => [],
  useStreamingText: () => "",
  useThinkingText: () => "",
  useProgressText: () => "",
  useActiveToolCalls: () => [],
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../ChatMessageList", () => ({
  ChatMessageList: ({
    messages,
    emptyState,
    onInitialAnchorReady,
  }: {
    messages?: Array<{ id: string; content: string }>;
    emptyState?: React.ReactNode;
    onInitialAnchorReady?: () => void;
  }) => {
    useLayoutEffect(() => {
      if (autoSignalInitialAnchorReady && messages?.length) {
        onInitialAnchorReady?.();
      }
    }, [messages, onInitialAnchorReady]);

    return (
      <div data-testid="chat-message-list">
        {messages?.length
          ? messages.map((message) => <div key={message.id}>{message.content}</div>)
          : emptyState}
      </div>
    );
  },
}));

vi.mock("../ChatInputBar", async () => {
  const React = await import("react");
  const MockChatInputBar = React.forwardRef(function MockChatInputBar(
    { isVisible, isCentered }: { isVisible?: boolean; isCentered?: boolean },
    ref: React.ForwardedRef<{ focus: () => void }>,
  ) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    return (
      <textarea
        ref={textareaRef}
        data-testid="chat-input-bar"
        data-visible={isVisible ? "true" : "false"}
        data-centered={isCentered ? "true" : "false"}
      />
    );
  });

  return {
    ChatInputBar: MockChatInputBar,
    DesktopChatInputBar: MockChatInputBar,
  };
});

vi.mock("../MessageQueue", () => ({
  MessageQueue: () => null,
}));

vi.mock("../../../../stores/message-queue-store", () => ({
  useMessageQueueStore: {
    getState: () => ({
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      remove: vi.fn(),
      moveUp: vi.fn(),
    }),
  },
  useMessageQueue: () => [],
}));

vi.mock("../../../../constants/models", () => ({
  loadPersistedModel: () => "gpt-5.4",
  availableModelsForAdapter: () => [],
  defaultModelForAdapter: () => "gpt-5.4",
  persistModel: vi.fn(),
}));

vi.mock("./ChatPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseAuraCapabilities.mockReset();
    autoSignalInitialAnchorReady = false;
    useMessageStore.setState({ messages: {}, orderedIds: {} });
    useChatViewStore.setState({ threads: {} });
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
    vi.useRealTimers();
  });

  function renderPanel(overrides: Partial<ComponentProps<typeof ChatPanel>> = {}) {
    return render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        {...overrides}
      />,
    );
  }

  function getInputBar() {
    return screen.getByTestId("chat-input-bar");
  }

  it("renders caller-provided header content", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderPanel({ header: <div>Mobile-owned chat header</div> });

    expect(screen.getByText("Mobile-owned chat header")).toBeInTheDocument();
  });

  it("does not render a mobile header by default", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderPanel();

    expect(screen.queryByText("Remote agent chat")).not.toBeInTheDocument();
  });

  it("does not show the inline agent header on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderPanel();

    expect(screen.queryByText("Remote agent chat")).not.toBeInTheDocument();
  });

  it("keeps the shell visible while showing a loading placeholder", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container } = renderPanel({ isLoading: true, historyResolved: false });

    expect(getInputBar()).toHaveAttribute("data-visible", "true");
    expect(container.querySelector(".initialRevealOverlay")).not.toBeNull();
    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
  });

  it("shows the same loading placeholder during a create-agent handoff", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container } = renderPanel({
      initialHandoff: "create-agent",
      isLoading: false,
      historyResolved: false,
    });

    expect(getInputBar()).toHaveAttribute("data-visible", "true");
    expect(container.querySelector(".initialRevealOverlay")).not.toBeNull();
    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
  });

  it("reveals warm cached history immediately", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container } = renderPanel({
      historyResolved: true,
      historyMessages: [...sampleHistoryMessages],
    });
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(container.querySelector(".messageContentHidden")).toBeNull();
    expect(getInputBar()).toHaveAttribute("data-visible", "true");
  });

  it("reveals cold-load history once it resolves and fades the loading overlay", () => {
    // The proactive [historyResolved, messages.length] reveal effect
    // schedules a double-rAF reveal as soon as history resolves with
    // messages, instead of waiting for `ChatMessageList`'s one-shot
    // `onInitialAnchorReady` callback. Under the synchronous rAF mock
    // installed in `beforeEach`, the reveal completes inside the
    // first rerender flush -- so `.messageContentHidden` is already
    // gone by the time we assert. The loading overlay then fades out
    // on its own timer.
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container, rerender } = render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading
        historyResolved={false}
      />,
    );

    rerender(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        historyMessages={[...sampleHistoryMessages]}
      />,
    );

    expect(container.querySelector(".messageContentHidden")).toBeNull();
    expect(container.querySelector(".initialRevealOverlayFading")).not.toBeNull();

    act(() => {
      vi.runAllTimers();
    });

    expect(container.querySelector(".initialRevealOverlay")).toBeNull();
  });

  it("reveals the transcript when carry-over messages land before historyResolved (CEO/MEOW black-panel regression)", () => {
    // Regression: when ChatPanel mounts with `messages.length > 0` (a
    // persisted message-store thread carried over from a prior visit)
    // BEFORE `historyResolved` flips true, ChatMessageList's one-shot
    // `onInitialAnchorReady` gate fires immediately and latches. The
    // pre-fix code waited solely on that callback, so when history
    // resolved the gate never re-fired and `.messageContentHidden`
    // remained applied -- rendering the panel fully black even though
    // sidebar previews showed the last message correctly. The proactive
    // [historyResolved, messages.length] reveal effect closes that gap.
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    // Deliberately DO NOT auto-signal: simulate the latched-child case
    // where the gate already fired and consumed its one-shot.
    autoSignalInitialAnchorReady = false;

    const { container, rerender } = render(
      <ChatPanel
        streamKey="stream-ceo"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved={false}
        historyMessages={[...sampleHistoryMessages]}
        scrollResetKey="ceo"
      />,
    );

    // Carry-over messages present, but history not yet resolved: the
    // cold-load gate is up but `.messageContentHidden` is not applied
    // yet because `historyResolved=false`.
    expect(container.querySelector(".messageContentHidden")).toBeNull();

    // History resolves. Without the fix, `.messageContentHidden` would
    // be applied and stay applied because the child callback latched
    // earlier. With the fix, the proactive reveal effect schedules the
    // double rAF and `isInitialThreadRevealReady` flips to true.
    rerender(
      <ChatPanel
        streamKey="stream-ceo"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        historyMessages={[...sampleHistoryMessages]}
        scrollResetKey="ceo"
      />,
    );

    // requestAnimationFrame is mocked to fire synchronously in this
    // test file's beforeEach, so the double-rAF reveal completes
    // immediately and the hidden class is gone.
    expect(container.querySelector(".messageContentHidden")).toBeNull();
  });

  it("does not re-hide the transcript when historyResolved flaps mid-chat after the initial reveal", () => {
    // Regression: chat-history-store evicts non-current entries when
    // `MAX_HISTORY_ENTRIES = 8` is exceeded. After eviction, `useChatHistory`
    // returns `IDLE_HISTORY` (status `"idle"`), so `historyResolved` flips
    // false. The next WS-driven force-fetch transitions status `"loading"`
    // → `"ready"` and `historyResolved` flips back to true. Without the
    // `hasInitiallyRevealedRef` latch, that round-trip re-armed the
    // cold-load reveal: `initialColdLoadRef.current` went back to true and
    // `isInitialThreadRevealReady` to false, so `.messageContentHidden`
    // (`visibility: hidden`) was reapplied to the entire transcript --
    // which is exactly what the user perceived as "all messages flash"
    // a few times during a turn in the standalone agent chat.
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    autoSignalInitialAnchorReady = true;

    const { container, rerender } = render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        historyMessages={[...sampleHistoryMessages]}
      />,
    );

    expect(container.querySelector(".messageContentHidden")).toBeNull();

    // Simulate the eviction → IDLE_HISTORY round-trip: history briefly
    // becomes unresolved, then resolves again with the same messages.
    rerender(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved={false}
        historyMessages={[...sampleHistoryMessages]}
      />,
    );

    rerender(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        historyMessages={[...sampleHistoryMessages]}
      />,
    );

    expect(container.querySelector(".messageContentHidden")).toBeNull();
    expect(container.querySelector(".initialRevealOverlay")).toBeNull();
  });

  it("re-arms cold-load when the user actually switches chats", () => {
    // The latch must not block legitimate cold-load reveals on a real
    // chat switch. Switching is signalled by `scrollResetKey` (and/or
    // `initialHandoff`); the mount/reset effect resets the latch so the
    // new chat gets its own cold-load → reveal cycle.
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container, rerender } = render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        historyMessages={[...sampleHistoryMessages]}
        scrollResetKey="agent-a"
      />,
    );

    expect(container.querySelector(".messageContentHidden")).toBeNull();

    rerender(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading
        historyResolved={false}
        scrollResetKey="agent-b"
      />,
    );

    rerender(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        historyMessages={[...sampleHistoryMessages]}
        scrollResetKey="agent-b"
      />,
    );

    // Cold-load was correctly re-armed during the chat switch (verified
    // by the loading overlay appearing on the intermediate render). With
    // the proactive [historyResolved, messages.length] reveal effect, the
    // transcript reveals as soon as both conditions are true again --
    // previously this assertion checked `.messageContentHidden` was
    // present, but that was the latched-child bug surface, not desired
    // UX. The mocked synchronous rAF flushes the double-rAF reveal
    // immediately, so by the time we assert `.messageContentHidden` is
    // gone.
    expect(container.querySelector(".messageContentHidden")).toBeNull();
  });

  it("does not hide an empty conversation while history is already resolved", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel();

    expect(getInputBar()).toHaveAttribute("data-visible", "true");
  });

  it("focuses the input when the desktop thread is ready", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ historyResolved: true, isLoading: false });

    expect(getInputBar()).toHaveFocus();
  });

  it("re-focuses the input when switching desktop chats", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { rerender } = render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        historyResolved
        scrollResetKey="chat-a"
      />,
    );

    const inputBar = getInputBar();
    expect(inputBar).toHaveFocus();

    inputBar.blur();
    expect(inputBar).not.toHaveFocus();

    rerender(
      <ChatPanel
        streamKey="stream-2"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        historyResolved
        scrollResetKey="chat-b"
      />,
    );

    expect(getInputBar()).toHaveFocus();
  });

  it("can skip desktop input autofocus when the thread becomes ready", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({
      historyResolved: true,
      isLoading: false,
      focusInputOnThreadReady: false,
    });

    expect(getInputBar()).not.toHaveFocus();
  });

  it("does not auto-focus the input on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderPanel({ historyResolved: true, isLoading: false });

    expect(getInputBar()).not.toHaveFocus();
  });

  it("shows an error state separately from loading and empty states", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ errorMessage: "History failed", isLoading: true, historyResolved: false });

    expect(screen.getByText("History failed")).toBeInTheDocument();
    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
  });

  it("renders no default empty prompt once history is resolved and not loading", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ historyResolved: true, isLoading: false });

    expect(screen.queryByText("Start chatting with Coca.")).not.toBeInTheDocument();
  });

  it("centers the input when the thread is empty and history is resolved", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ historyResolved: true, isLoading: false });

    expect(getInputBar()).toHaveAttribute("data-centered", "true");
  });

  it("docks the input at the bottom once messages are present", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({
      historyResolved: true,
      isLoading: false,
      historyMessages: [...sampleHistoryMessages],
    });

    expect(getInputBar()).toHaveAttribute("data-centered", "false");
  });

  it("does not center the input while history is still loading", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ isLoading: true, historyResolved: false });

    expect(getInputBar()).toHaveAttribute("data-centered", "false");
  });

  it("does not center the input when an error is shown", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({
      historyResolved: true,
      isLoading: false,
      errorMessage: "History failed",
    });

    expect(getInputBar()).toHaveAttribute("data-centered", "false");
  });
});
