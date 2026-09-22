import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MobileChatInputBar } from "./MobileChatInputBar";

const mockStopVoiceDictation = vi.hoisted(() => vi.fn());
const mockStreaming = vi.hoisted(() => ({ value: false }));
const mockRefreshAuraRuntimeCapabilities = vi.hoisted(() => vi.fn(async () => undefined));
const mockRefreshRemoteAgentStatus = vi.hoisted(() => vi.fn(async () => undefined));
const mockOpenHostSettings = vi.hoisted(() => vi.fn());
const mockCapabilities = vi.hoisted(() => ({
  remoteOnly: false,
  supportsHostRetargeting: false,
}));
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
  useIsStreaming: () => mockStreaming.value,
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  refreshAuraRuntimeCapabilities: mockRefreshAuraRuntimeCapabilities,
  useAuraCapabilities: () => mockCapabilities,
}));

vi.mock("../../../stores/profile-status-store", () => ({
  refreshRemoteAgentStatus: mockRefreshRemoteAgentStatus,
}));

vi.mock("../../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (state: { openHostSettings: typeof mockOpenHostSettings }) => unknown) =>
    selector({ openHostSettings: mockOpenHostSettings }),
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
    mockRefreshAuraRuntimeCapabilities.mockClear();
    mockRefreshRemoteAgentStatus.mockClear();
    mockOpenHostSettings.mockClear();
    mockCapabilities.remoteOnly = false;
    mockCapabilities.supportsHostRetargeting = false;
    mockStreaming.value = false;
  });

  it("keeps a local conversation readable while its desktop runtime is unavailable", () => {
    renderInputBar({
      machineType: "local",
      sendDisabled: true,
      sendDisabledReason: "This local agent needs the desktop app.",
    });

    expect(screen.getByPlaceholderText("Runtime unavailable")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved conversation · Desktop runtime unavailable",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "This local agent needs the desktop app.",
    );
    expect(screen.getByLabelText("Runtime unavailable")).toHaveTextContent("Read only");
    expect(screen.getByTestId("agent-environment")).toHaveTextContent("Local");
  });

  it("checks a remote runtime again without replaying a prompt", async () => {
    const user = userEvent.setup();
    renderInputBar({
      machineType: "remote",
      templateAgentId: "remote-template-1",
      sendDisabled: true,
      sendDisabledReason: "This remote agent is offline.",
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved conversation · Remote runtime unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(mockRefreshRemoteAgentStatus).toHaveBeenCalledWith("remote-template-1");
  });

  it("offers host recovery for a disconnected local runtime", async () => {
    const user = userEvent.setup();
    mockCapabilities.supportsHostRetargeting = true;
    renderInputBar({ machineType: "local", sendDisabled: true });

    await user.click(screen.getByRole("button", { name: "Check again" }));
    await user.click(screen.getByRole("button", { name: "Host settings" }));

    expect(mockRefreshAuraRuntimeCapabilities).toHaveBeenCalledTimes(1);
    expect(mockOpenHostSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal environment footer when sending is available", () => {
    renderInputBar({ machineType: "remote", sendDisabled: false });

    expect(screen.getByPlaceholderText("Message agent")).toBeEnabled();
    expect(screen.getByTestId("agent-environment")).toHaveTextContent("Remote");
  });

  it("shows an external queue-persistence failure inline without losing the draft", () => {
    renderInputBar({
      input: "Keep this unsent prompt",
      externalValidationMessage: "Could not save the queued follow-up. Your draft is still here.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save the queued follow-up");
    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-agent-surface",
      "mobile-chat-input-validation-hint",
    );
    expect(screen.getByPlaceholderText("Message agent")).toHaveValue("Keep this unsent prompt");
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

  it("queues a follow-up by touch or Enter during an active chat turn", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    mockStreaming.value = true;
    renderInputBar({ input: "Follow up after this turn", onSend });

    expect(screen.getByRole("button", { name: "Queue follow-up" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Queue follow-up" }));
    expect(onSend).toHaveBeenCalledTimes(1);

    await user.click(screen.getByPlaceholderText("Message agent"));
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("Follow up after this turn", undefined, undefined);
  });

  it("does not offer a chat follow-up queue for an unrelated automation", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderInputBar({ input: "Do not queue this", isExternallyBusy: true, onSend });

    expect(screen.queryByRole("button", { name: "Queue follow-up" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop automation" })).toBeInTheDocument();
    await user.click(screen.getByPlaceholderText("Message agent"));
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });
});
