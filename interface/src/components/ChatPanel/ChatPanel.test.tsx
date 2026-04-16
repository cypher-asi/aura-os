import { render, screen } from "@testing-library/react";
import { act, forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ComponentProps, type ForwardedRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { DisplaySessionEvent } from "../../types/stream";
import { useMessageStore } from "../../stores/message-store";
import { useChatViewStore } from "../../stores/chat-view-store";

const mockUseAuraCapabilities = vi.fn();
let autoSignalInitialAnchorReady = false;
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
const sampleHistoryMessages: DisplaySessionEvent[] = [
  { id: "msg-1", role: "user", content: "Hello" },
];

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
  useStreamEvents: () => [],
  useStreamingText: () => "",
  useThinkingText: () => "",
  useProgressText: () => "",
  useActiveToolCalls: () => [],
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
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

vi.mock("../ChatInputBar", () => ({
  ChatInputBar: forwardRef(function MockChatInputBar(
    { isVisible }: { isVisible?: boolean },
    ref: ForwardedRef<{ focus: () => void }>,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    return (
      <textarea
        ref={textareaRef}
        data-testid="chat-input-bar"
        data-visible={isVisible ? "true" : "false"}
      />
    );
  }),
}));

vi.mock("../MessageQueue", () => ({
  MessageQueue: () => null,
}));

vi.mock("../../stores/message-queue-store", () => ({
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

vi.mock("../../constants/models", () => ({
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

  it("shows the inline agent header on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderPanel();

    expect(screen.getByText("Coca")).toBeInTheDocument();
    expect(screen.getByText("Remote agent chat")).toBeInTheDocument();
  });

  it("makes the agent summary actionable on mobile when details are available", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    const onDetails = vi.fn();

    render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        onMobileHeaderSummaryClick={onDetails}
      />,
    );

    expect(screen.getByRole("button", { name: "Open details for Coca" })).toBeInTheDocument();
    expect(screen.getByText("Open skills and runtime")).toBeInTheDocument();
  });

  it("can present a project-count summary affordance on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    render(
      <MemoryRouter>
        <ChatPanel
          streamKey="stream-1"
          onSend={vi.fn()}
          onStop={vi.fn()}
          agentName="Coca"
          machineType="remote"
          mobileHeaderSummaryTo="/projects/proj-1/agents/agent-inst-1/details"
          mobileHeaderSummaryHint="2 agents in project"
          mobileHeaderSummaryLabel="Open details for Coca"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Open details for Coca" })).toBeInTheDocument();
    expect(screen.getByText("2 agents in project")).toBeInTheDocument();
  });

  it("does not show the inline agent header on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel();

    expect(screen.queryByText("Remote agent chat")).not.toBeInTheDocument();
  });

  it("keeps the shell visible while showing a loading placeholder", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container } = renderPanel({ isLoading: true, historyResolved: false });

    expect(screen.getByTestId("chat-input-bar")).toBeInTheDocument();
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

    expect(screen.getByTestId("chat-input-bar")).toBeInTheDocument();
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

  it("keeps cold-load history hidden until the initial anchor is ready", () => {
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

    expect(container.querySelector(".messageContentHidden")).not.toBeNull();
    expect(container.querySelector(".initialRevealOverlay")).not.toBeNull();

    autoSignalInitialAnchorReady = true;

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
});
