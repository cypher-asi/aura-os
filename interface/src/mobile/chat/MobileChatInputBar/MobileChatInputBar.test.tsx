import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MobileChatInputBar } from "./MobileChatInputBar";

const mockStopVoiceDictation = vi.hoisted(() => vi.fn());
const mockChatUI = vi.hoisted(() => ({
  selectedModel: "aura-claude-opus-4-6",
  selectedEffort: "medium",
  selectedMode: "code",
  imageQuality: "standard",
  pinnedSourceImage: null,
  setPinnedSourceImage: vi.fn(),
  setSelectedModel: vi.fn(),
  setImageQuality: vi.fn(),
  setSelectedMode: vi.fn(),
}));

vi.mock("../../../components/InputBarShell", () => ({
  ModeSelector: () => <div data-testid="mode-selector" />,
  ModelMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../features/chat-ui/ChatInputBar/CommandChips", () => ({
  CommandChips: () => null,
}));

vi.mock("../../../features/chat-ui/ChatInputBar/ContextUsageIndicator", () => ({
  ContextUsageIndicator: () => null,
}));

vi.mock("../../../features/chat-ui/ChatInputBar/VoiceDictationControl", () => ({
  VoiceDictationControl: () => null,
}));

vi.mock("../../../features/chat-ui/ChatInputBar/useVoiceDictation", () => ({
  useVoiceDictation: () => ({
    supported: false,
    listening: false,
    error: null,
    start: vi.fn(),
    stop: mockStopVoiceDictation,
  }),
}));

vi.mock("../../../features/chat-ui/ChatInputBar/PromptStash", () => ({
  PromptStashButton: () => null,
  PromptStashMenu: () => null,
  usePromptStashComposer: () => ({
    open: false,
    entries: [],
    error: null,
    close: vi.fn(),
    deleteEntry: vi.fn(),
    restoreEntry: vi.fn(),
    stashCurrent: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock("../../../features/chat-ui/ChatInputBar/SlashCommandMenu", () => ({
  SlashCommandMenu: () => null,
}));

vi.mock("../../../features/chat-ui/ChatInputBar/MentionMenu", () => ({
  MentionMenu: () => null,
}));

vi.mock("../../../features/chat-ui/ChatInputBar/useFileAttachments", () => ({
  useFileAttachments: () => ({
    canAddMore: true,
    addFiles: vi.fn(),
    handleRemove: vi.fn(),
  }),
}));

vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ remoteOnly: false }),
}));

vi.mock("../../../lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("../../../stores/chat-ui-store", () => ({
  useChatUI: () => mockChatUI,
}));

vi.mock("../../../apps/agents/components/AgentEnvironment", () => ({
  AgentEnvironment: ({ machineType }: { machineType?: string }) => (
    <span data-testid="agent-environment">{machineType === "local" ? "Local" : "Remote"}</span>
  ),
}));

function renderInputBar(
  overrides: Partial<React.ComponentProps<typeof MobileChatInputBar>> = {},
) {
  return render(
    <MobileChatInputBar
      input=""
      onInputChange={vi.fn()}
      onSend={vi.fn()}
      onStop={vi.fn()}
      streamKey="stream-1"
      adapterType="aura_harness"
      machineType="remote"
      agentId="agent-instance-1"
      {...overrides}
    />,
  );
}

describe("MobileChatInputBar", () => {
  beforeEach(() => {
    mockStopVoiceDictation.mockClear();
  });

  it("explains why a remote agent is required when mobile chat is disabled", () => {
    renderInputBar({
      machineType: "local",
      sendDisabled: true,
      sendDisabledReason: "This local agent needs the desktop app.",
    });

    expect(screen.getByPlaceholderText("Remote agent required")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Remote agent required");
    expect(screen.getByRole("status")).toHaveTextContent(
      "This local agent needs the desktop app.",
    );
    expect(screen.getByLabelText("Remote agent required")).toHaveTextContent(
      "Remote required",
    );
    expect(screen.queryByTestId("agent-environment")).not.toBeInTheDocument();
  });

  it("keeps the normal environment footer when sending is available", () => {
    renderInputBar({ machineType: "remote", sendDisabled: false });

    expect(screen.getByPlaceholderText("Message agent")).toBeEnabled();
    expect(screen.getByTestId("agent-environment")).toHaveTextContent("Remote");
  });

  it("submits exactly once when the mobile send button is tapped", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderInputBar({ input: "Hello agent", onSend });

    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Hello agent", undefined, undefined);
  });

  it("submits from the keyboard when Enter is pressed", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderInputBar({ input: "Keyboard send", onSend });

    await user.click(screen.getByPlaceholderText("Message agent"));
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Keyboard send", undefined, undefined);
  });
});
