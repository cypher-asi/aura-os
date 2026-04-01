import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

const mockUseAuraCapabilities = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../hooks/use-scroll-anchor", () => ({
  useScrollAnchor: () => ({
    handleScroll: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollToBottomIfPinned: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
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
  ChatInputBar: () => <div data-testid="chat-input-bar" />,
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
  persistModel: vi.fn(),
}));

vi.mock("../ChatView/ChatView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("ChatPanel", () => {
  beforeEach(() => {
    mockUseAuraCapabilities.mockReset();
  });

  function renderPanel() {
    return render(
      <ChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
      />,
    );
  }

  it("shows the inline agent header on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderPanel();

    expect(screen.getByText("Coca")).toBeInTheDocument();
    expect(screen.getByText("Remote agent chat")).toBeInTheDocument();
  });

  it("does not show the inline agent header on desktop", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderPanel();

    expect(screen.queryByText("Remote agent chat")).not.toBeInTheDocument();
  });
});
