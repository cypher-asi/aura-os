import { fireEvent, render, screen } from "@testing-library/react";
import { act, useLayoutEffect, type ComponentProps } from "react";
import { vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { useMessageStore } from "../../../stores/message-store";
import { useChatUIStore } from "../../../stores/chat-ui-store";
import { useChatViewStore } from "../../../stores/chat-view-store";
import { useSubAgentPaneStore } from "../../../stores/subagent-pane-store";
import type { SubAgentPaneDescriptor } from "../../../stores/subagent-pane-store";
import {
  _resetAllPartitionSendControl,
  getPartitionSendControl,
} from "../../../hooks/use-chat-stream/partition-send-control";

const mockSubagentOnSend = vi.hoisted(() => vi.fn());
const mockSubagentOnStop = vi.hoisted(() => vi.fn());
const mockModelPersistence = vi.hoisted(() => {
  let selectedModel = "gpt-5.4";
  const persistModel = vi.fn((model: string) => {
    selectedModel = model;
  });
  return {
    getSelectedModel: () => selectedModel,
    persistModel,
    reset: () => {
      selectedModel = "gpt-5.4";
      persistModel.mockClear();
    },
  };
});

const mockUseAuraCapabilities = vi.fn();
const mockClearQueue = vi.hoisted(() => vi.fn());
let autoSignalInitialAnchorReady = false;
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
const sampleHistoryMessages: DisplaySessionEvent[] = [
  { id: "msg-1", role: "user", content: "Hello" },
];

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../hooks/use-subagent-chat-stream", () => ({
  subagentStreamKey: (childRunId: string) => `subagent:${childRunId}`,
  useSubagentChatStream: () => ({
    streamKey: "subagent:child-1",
    status: "live",
    onSend: mockSubagentOnSend,
    onStop: mockSubagentOnStop,
  }),
}));

vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
  useStreamEvents: () => [],
  useStreamingText: () => "",
  useThinkingText: () => "",
  useProgressText: () => "",
  useActiveToolCalls: () => [],
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../ChatMessageList", () => ({
  ChatMessageList: ({
    messages,
    emptyState,
    onInitialAnchorReady,
    onRetry,
  }: {
    messages?: Array<{
      id: string;
      content: string;
      displayVariant?: string;
      errorMessage?: string;
    }>;
    emptyState?: React.ReactNode;
    onInitialAnchorReady?: () => void;
    onRetry?: () => void;
  }) => {
    useLayoutEffect(() => {
      if (autoSignalInitialAnchorReady && messages?.length) {
        onInitialAnchorReady?.();
      }
    }, [messages, onInitialAnchorReady]);

    return (
      <div data-testid="chat-message-list">
        {messages?.some(
          (message) => message.displayVariant || message.errorMessage,
        ) && onRetry ? (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {messages?.length
          ? messages.map((message) => <div key={message.id}>{message.content}</div>)
          : emptyState}
      </div>
    );
  },
}));

// Render-count probe — exposed so individual tests can assert how often
// the (memoized) input bar re-renders. We store the counter on an object
// (rather than a `let` binding) so the mock body can mutate `count` in
// place without tripping `react-hooks/globals`, which forbids reassigning
// outer variables during render.
const inputBarRenderProbe = { count: 0 };
function resetInputBarRenderCount() {
  inputBarRenderProbe.count = 0;
}

vi.mock("../ChatInputBar", async () => {
  const React = await import("react");
  const InnerInputBar = React.forwardRef(function InnerInputBar(
    {
      input,
      onInputChange,
      onNewChat,
      isVisible,
      isCentered,
    }: {
      input?: string;
      onInputChange?: (value: string) => void;
      onNewChat?: () => void;
      isVisible?: boolean;
      isCentered?: boolean;
    },
    ref: React.ForwardedRef<{ focus: () => void }>,
  ) {
    // Test-only render probe: deliberately mutate during render to count
    // how often the memoized component is invoked, which is the property
    // under test.
    // eslint-disable-next-line react-hooks/immutability
    inputBarRenderProbe.count += 1;
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      isFocused: () => document.activeElement === textareaRef.current,
    }));

    return (
      <>
        <textarea
          ref={textareaRef}
          data-testid="chat-input-bar"
          data-visible={isVisible ? "true" : "false"}
          data-centered={isCentered ? "true" : "false"}
          value={input ?? ""}
          onChange={(event) => onInputChange?.(event.currentTarget.value)}
        />
        {onNewChat ? (
          <button type="button" onClick={onNewChat}>
            new chat
          </button>
        ) : null}
      </>
    );
  });
  // `React.memo` mirrors the production `DesktopChatInputBar` wrapper so
  // the assertion below exercises the same shallow-prop-compare path that
  // gates render skipping in real usage.
  const MockChatInputBar = React.memo(InnerInputBar);

  return {
    ChatInputBar: MockChatInputBar,
    DesktopChatInputBar: MockChatInputBar,
  };
});

vi.mock("../MessageQueue", () => ({
  MessageQueue: () => null,
}));

vi.mock("../../../stores/message-queue-store", () => ({
  useMessageQueueStore: {
    getState: () => ({
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      remove: vi.fn(),
      moveUp: vi.fn(),
      clear: mockClearQueue,
    }),
  },
  useMessageQueue: () => [],
}));

vi.mock("../../../constants/models", () => ({
  loadPersistedModel: () => mockModelPersistence.getSelectedModel(),
  loadPersistedImageModel: () => "gpt-image-2",
  loadPersistedVideoModel: () => "veo-3.1-fast-generate-preview",
  loadPersistedThreeDModel: () => "tripo-v2",
  loadPersistedModelEffort: () => null,
  persistModelEffort: vi.fn(),
  DEFAULT_IMAGE_QUALITY: "medium",
  loadPersistedImageQuality: () => "medium",
  persistImageQuality: vi.fn(),
  availableModelsForAdapter: () => [
    { id: "gpt-5.4", label: "GPT-5.4", tier: "gpt", mode: "chat" },
    {
      id: "aura-claude-opus-4-8",
      label: "Opus 4.8",
      tier: "opus",
      mode: "chat",
    },
  ],
  defaultModelForAdapter: () => "gpt-5.4",
  hasAgentScopedModel: () => false,
  persistModel: mockModelPersistence.persistModel,
}));

vi.mock("./ChatPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseAuraCapabilities.mockReset();
    autoSignalInitialAnchorReady = false;
    resetInputBarRenderCount();
    mockClearQueue.mockReset();
    mockSubagentOnSend.mockReset();
    mockSubagentOnStop.mockReset();
    mockModelPersistence.reset();
    _resetAllPartitionSendControl();
    useMessageStore.setState({ messages: {}, orderedIds: {} });
    useChatUIStore.setState({ streams: {}, drafts: {} });
    useChatViewStore.setState({ threads: {} });
    useSubAgentPaneStore.setState({ panes: {} });
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

  it("clears the draft and queued messages before starting a new chat", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    const onNewChat = vi.fn();

    renderPanel({ onNewChat });
    const input = getInputBar() as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "draft message" } });
    expect(input.value).toBe("draft message");

    fireEvent.click(screen.getByRole("button", { name: "new chat" }));

    expect(input.value).toBe("");
    expect(mockClearQueue).toHaveBeenCalledWith("stream-1");
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("focuses the input after pressing the new-chat button on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    const onNewChat = vi.fn();

    renderPanel({
      onNewChat,
      historyResolved: true,
      isLoading: false,
      historyMessages: [...sampleHistoryMessages],
    });

    const input = getInputBar() as HTMLTextAreaElement;
    input.blur();
    expect(input).not.toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "new chat" }));

    expect(getInputBar()).toHaveFocus();
  });

  it("does not auto-focus the input on the new-chat button on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    const onNewChat = vi.fn();

    renderPanel({
      onNewChat,
      historyResolved: true,
      isLoading: false,
      historyMessages: [...sampleHistoryMessages],
    });

    const input = getInputBar() as HTMLTextAreaElement;
    expect(input).not.toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "new chat" }));

    expect(getInputBar()).not.toHaveFocus();
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

  it("focuses the input when switching between desktop chats", () => {
    // Navigating between agents/sessions/projects should drop the
    // cursor straight into the input so users can start typing without
    // a manual click. Mirrors ChatGPT-style chat-switch UX.
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

  it("focuses the input on a create-agent handoff even when focus left the textarea", () => {
    // Repro for the "+" next to a project name in the left menu: the
    // click moves focus from the previous chat's textarea to the "+"
    // button before the new agent's panel mounts. The standard
    // "don't steal focus when switching chats" latch should NOT
    // suppress focus in this case because the user explicitly asked
    // to start a new agent.
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
        isLoading={false}
        historyResolved={false}
        scrollResetKey="chat-b"
        initialHandoff="create-agent"
      />,
    );

    rerender(
      <ChatPanel
        streamKey="stream-2"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        isLoading={false}
        historyResolved
        scrollResetKey="chat-b"
        initialHandoff="create-agent"
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

  it("retries a failed chat turn with the currently selected model, not the cached failed model", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    const onSend = vi.fn();
    const onStop = vi.fn();
    getPartitionSendControl("stream-1").lastSendArgs = {
      content: "Build Launch Brief",
      action: null,
      selectedModel: "aura-claude-fable-5",
    };

    renderPanel({
      onSend,
      onStop,
      historyResolved: true,
      historyMessages: [
        {
          id: "assistant-error-1",
          role: "assistant",
          content: "",
          displayVariant: "streamDropped",
          errorMessage: "Claude Fable 5 is not available.",
        } as DisplaySessionEvent,
      ],
    });

    act(() => {
      useChatUIStore.getState().setSelectedModel(
        "stream-1",
        "aura-claude-opus-4-8",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "Build Launch Brief",
      null,
      "aura-claude-opus-4-8",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("keeps a cached generation model when retrying a failed generation turn", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    const onSend = vi.fn();
    const onStop = vi.fn();
    getPartitionSendControl("stream-1").lastSendArgs = {
      content: "Draw a launch dashboard",
      action: null,
      selectedModel: "gpt-image-2",
      generationMode: "image",
    };

    renderPanel({
      onSend,
      onStop,
      historyResolved: true,
      historyMessages: [
        {
          id: "assistant-error-2",
          role: "assistant",
          content: "",
          displayVariant: "streamDropped",
          errorMessage: "Image generation interrupted.",
        } as DisplaySessionEvent,
      ],
    });

    act(() => {
      useChatUIStore.getState().setSelectedModel(
        "stream-1",
        "aura-claude-opus-4-8",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "Draw a launch dashboard",
      null,
      "gpt-image-2",
      undefined,
      undefined,
      undefined,
      "image",
      undefined,
    );
  });

  it("does not re-render the input bar when only scrollResetKey changes (same-agent session switch)", () => {
    // Regression: clicking a different session in the agents-shell "Chats"
    // sidekick used to re-render the entire chat input bar even though the
    // bar is wrapped in `React.memo` and `streamKey` (= `projectId:agentInstanceId`)
    // is *unchanged* across same-agent session switches. The cause was prop
    // identity churn (fresh `[]` arrays from the panel-state reset effect,
    // and `handleSend`/`onNewChat` callbacks re-created on each render).
    // After stabilizing those refs at module level / behind ref-mirrors,
    // the bar's memo should short-circuit and skip the render entirely.
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const sharedSend = vi.fn();
    const sharedStop = vi.fn();
    const sharedOnNewChat = vi.fn();

    const { rerender } = render(
      <ChatPanel
        streamKey="stream-1"
        onSend={sharedSend}
        onStop={sharedStop}
        agentName="Coca"
        machineType="remote"
        historyResolved
        scrollResetKey="session-a"
        onNewChat={sharedOnNewChat}
      />,
    );

    const initialRenders = inputBarRenderProbe.count;
    expect(initialRenders).toBeGreaterThan(0);

    rerender(
      <ChatPanel
        streamKey="stream-1"
        onSend={sharedSend}
        onStop={sharedStop}
        agentName="Coca"
        machineType="remote"
        historyResolved
        scrollResetKey="session-b"
        onNewChat={sharedOnNewChat}
      />,
    );

    // The input bar must not be re-rendered as a result of the
    // session switch alone. `React.memo` short-circuits on identical
    // shallow props, and after the stabilization fix every prop that
    // changes per-session (the empty `attachments` / `selectedCommands`
    // resets, `handleSend`'s identity, etc.) is held stable per
    // streamKey.
    expect(inputBarRenderProbe.count).toBe(initialRenders);
  });

  it("mounts the subagent slide-over on open and unmounts it after the slide-out", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const descriptor: SubAgentPaneDescriptor = {
      childRunId: "child-1",
      parentToolUseId: "tool-1",
      subagentType: "explore",
      prompt: "Look around the repo",
      state: "running",
    };

    renderPanel({ historyResolved: true, isLoading: false });

    // No pane yet: the slide-over and its back button are absent.
    expect(
      screen.queryByRole("button", { name: "Back to parent thread" }),
    ).not.toBeInTheDocument();

    // Opening a pane pushes the subagent slide-over over the parent.
    act(() => {
      useSubAgentPaneStore.getState().openPane("stream-1", descriptor);
    });
    expect(
      screen.getByRole("button", { name: "Back to parent thread" }),
    ).toBeInTheDocument();

    // Closing keeps the layer mounted while the slide-out plays...
    fireEvent.click(
      screen.getByRole("button", { name: "Back to parent thread" }),
    );
    expect(
      screen.getByRole("button", { name: "Back to parent thread" }),
    ).toBeInTheDocument();

    // ...then the fallback timer (animationend never fires in jsdom)
    // drops it, restoring the parent thread alone.
    act(() => {
      vi.runAllTimers();
    });
    expect(
      screen.queryByRole("button", { name: "Back to parent thread" }),
    ).not.toBeInTheDocument();
  });
});
