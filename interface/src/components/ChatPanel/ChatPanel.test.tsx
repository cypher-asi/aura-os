import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

const mockUseAuraCapabilities = vi.fn();
const mockUseChatViewportPhase = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("./useChatViewportPhase", () => ({
  useChatViewportPhase: () => mockUseChatViewportPhase(),
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
  ChatMessageList: ({ emptyState }: { emptyState?: React.ReactNode }) => (
    <div data-testid="chat-message-list">{emptyState}</div>
  ),
}));

vi.mock("../ChatInputBar", () => ({
  ChatInputBar: ({ isVisible }: { isVisible?: boolean }) => (
    <div data-testid="chat-input-bar" data-visible={isVisible ? "true" : "false"} />
  ),
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
    mockUseAuraCapabilities.mockReset();
    mockUseChatViewportPhase.mockReset();
    mockUseChatViewportPhase.mockReturnValue({
      isReady: true,
    });
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

  it("can present a switch-style summary affordance on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    const onSwitch = vi.fn();

    render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        onMobileHeaderSummaryClick={onSwitch}
        mobileHeaderSummaryHint="Switch active agent · 2 in project"
        mobileHeaderSummaryLabel="Switch active project agent from Coca"
        mobileHeaderSummaryKind="switch"
      />,
    );

    expect(screen.getByRole("button", { name: "Switch active project agent from Coca" })).toBeInTheDocument();
    expect(screen.getByText("Switch active agent · 2 in project")).toBeInTheDocument();
  });

  it("does not show the inline agent header on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel();

    expect(screen.queryByText("Remote agent chat")).not.toBeInTheDocument();
  });

  it("keeps the shell visible while loading without showing a spinner", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ isLoading: true, historyResolved: false });

    expect(screen.getByTestId("chat-input-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-loading-state")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
  });

  it("does not show a second loading shell during a create-agent handoff", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({
      initialHandoff: "create-agent",
      isLoading: false,
      historyResolved: false,
    });

    expect(screen.getByTestId("chat-input-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-loading-state")).not.toBeInTheDocument();
  });

  it("keeps the message area visible even while the scroll hook is settling", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    mockUseChatViewportPhase.mockReturnValue({
      isReady: false,
    });

    const { container } = renderPanel();
    const messageArea = container.querySelector(".messageArea");

    expect(messageArea).not.toBeNull();
    expect(messageArea?.className).not.toContain("messageAreaHidden");
    expect(screen.getByTestId("chat-input-bar")).toHaveAttribute("data-visible", "false");
  });

  it("covers the message viewport with a veil while the first reveal is still settling", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
    mockUseChatViewportPhase.mockReturnValue({
      isReady: false,
    });

    const { container } = renderPanel();

    expect(container.querySelector(".messageAreaVeil")).not.toBeNull();
  });

  it("removes the viewport veil once the panel is ready", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    const { container } = renderPanel();

    expect(container.querySelector(".messageAreaVeil")).toBeNull();
  });

  it("shows an error state separately from loading and empty states", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ errorMessage: "History failed", isLoading: true, historyResolved: false });

    expect(screen.getByText("History failed")).toBeInTheDocument();
    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
  });

  it("shows the empty state once history is resolved and not loading", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel({ historyResolved: true, isLoading: false });

    expect(screen.getByText("Start chatting with Coca.")).toBeInTheDocument();
  });
});
