import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";

let mockIsStreaming = false;
let mockIsMobileLayout = false;
let mockLinkedWorkspace = true;
let mockRemoteStatuses: Record<string, string> = {};
const mockRegisterRemoteAgents = vi.fn();
vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
}));

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// The extracted slot components carry their own CSS modules; proxy them
// to their literal class names too so structural queries keep working.
vi.mock("./AttachmentPreviews/AttachmentPreviews.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./AttachControl/AttachControl.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./AgentInfoBar/AgentInfoBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./ChatModeBar/ChatModeBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./InputStatusHints/InputStatusHints.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./ModelControls/ModelControls.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./ProjectPicker/ProjectPicker.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../components/InputBarShell/InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../mobile/chat/MobileChatInputBar/MobileChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    isMobileLayout: mockIsMobileLayout,
    features: { linkedWorkspace: mockLinkedWorkspace },
  }),
}));

// AgentEnvironment now always mounts (it renders an inert placeholder while
// machineType is undefined to keep the bottom-bar slot stable). Stub out the
// async hook it depends on so tests don't trigger unwrapped-act warnings.
vi.mock("../../../hooks/use-environment-info", () => ({
  useEnvironmentInfo: () => ({ data: null, loading: false }),
}));

let mockSelectedModel: string | null = null;
let mockSelectedEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null = null;
let mockSelectedMode: "code" | "plan" | "image" | "video" | "3d" = "code";
let mockPinnedSourceImage: {
  imageUrl: string;
  originalUrl?: string;
  prompt: string;
} | null = null;
const mockSetSelectedModel = vi.fn();
const mockSetSelectedMode = vi.fn();
const mockSetPinnedSourceImage = vi.fn();
const mockAddFiles = vi.fn();
const mockHandleRemove = vi.fn();
vi.mock("../../../stores/chat-ui-store", () => ({
  useChatUI: () => ({
    selectedMode: mockSelectedMode,
    selectedModel: mockSelectedModel,
    selectedEffort: mockSelectedEffort,
    imageQuality: "medium",
    projectId: null,
    pinnedSourceImage: mockPinnedSourceImage,
    councilCount: 1,
    councilModels: [],
    councilMechanism: "synthesize",
    answerStrategy: "single",
    secondOpinionReference: null,
    setSelectedMode: mockSetSelectedMode,
    setSelectedModel: mockSetSelectedModel,
    setCouncilCount: vi.fn(),
    setCouncilModel: vi.fn(),
    setCouncilMechanism: vi.fn(),
    setAnswerStrategy: vi.fn(),
    setSecondOpinionReference: vi.fn(),
    setSelectedEffort: vi.fn(),
    setImageQuality: vi.fn(),
    setProjectId: vi.fn(),
    setPinnedSourceImage: mockSetPinnedSourceImage,
    init: vi.fn(),
    syncAvailableModels: vi.fn(),
  }),
}));

vi.mock("../../../stores/profile-status-store", () => ({
  useProfileStatusStore: (selector: (state: {
    statuses: Record<string, string>;
    registerRemoteAgents: typeof mockRegisterRemoteAgents;
  }) => unknown) =>
    selector({
      statuses: mockRemoteStatuses,
      registerRemoteAgents: mockRegisterRemoteAgents,
    }),
}));

vi.mock("./useFileAttachments", () => ({
  useFileAttachments: () => ({
    canAddMore: true,
    addFiles: mockAddFiles,
    addFileFromPath: vi.fn(),
    handleRemove: mockHandleRemove,
  }),
}));

import { ChatInputBar } from "../ChatInputBar";
import { MobileChatInputBar } from "../../../mobile/chat/MobileChatInputBar";
import { ENTER_SUBMIT_GRACE_MS } from "../../../components/InputBarShell/InputBarShell";
import type { AttachmentItem } from "../ChatInputBar";
import type { AgentInstance } from "../../../shared/types";

function makeProps(overrides: Partial<Parameters<typeof ChatInputBar>[0]> = {}) {
  return {
    input: "",
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    streamKey: "test-stream",
    ...overrides,
  };
}

function makeFileList(file: File): FileList {
  return {
    length: 1,
    0: file,
    item: (index: number) => (index === 0 ? file : null),
    [Symbol.iterator]: function* iterator() {
      yield file;
    },
  } as unknown as FileList;
}

/**
 * Stubs the heights of the shell's hidden wrap-measurement mirrors (see
 * `useInputAutosize`): the "content" mirror renders the prompt at the
 * single-line layout's width, the "baseline" mirror renders one line.
 * JSDOM runs no layout, so `scrollHeight` is shadowed per mirror kind.
 * `heights` is read live on every measurement, letting tests mutate it
 * between rerenders. Returns a restore function.
 */
function stubMirrorHeights(heights: { content: number; baseline: number }) {
  Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLDivElement) {
      const kind = this.getAttribute("data-autosize-mirror");
      if (kind === "content") return heights.content;
      if (kind === "baseline") return heights.baseline;
      return 0;
    },
  });
  return () => {
    delete (HTMLDivElement.prototype as { scrollHeight?: unknown })
      .scrollHeight;
  };
}

function withMockDataTransfer(fileList: FileList, run: () => void) {
  const originalDataTransfer = globalThis.DataTransfer;

  class MockDataTransfer {
    files = fileList;
    items = {
      add: vi.fn(),
    };
  }

  // JSDOM does not provide a writable DataTransfer implementation for clipboard tests.
  Object.defineProperty(globalThis, "DataTransfer", {
    configurable: true,
    value: MockDataTransfer,
  });

  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "DataTransfer", {
      configurable: true,
      value: originalDataTransfer,
    });
  }
}

beforeEach(() => {
  mockIsStreaming = false;
  mockIsMobileLayout = false;
  mockLinkedWorkspace = true;
  mockSelectedModel = null;
  mockSelectedEffort = null;
  mockSelectedMode = "code";
  mockPinnedSourceImage = null;
  mockRemoteStatuses = {};
  mockRegisterRemoteAgents.mockClear();
  mockSetSelectedModel.mockClear();
  mockSetSelectedMode.mockClear();
  mockSetPinnedSourceImage.mockClear();
  mockAddFiles.mockClear();
  mockHandleRemove.mockClear();
});

describe("ChatInputBar", () => {
  it("renders the textarea with placeholder", () => {
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getByPlaceholderText("/ for commands, @ for context")).toBeInTheDocument();
  });

  it("uses chat-first copy when rendered by the Chat app", () => {
    render(<ChatInputBar {...makeProps({ composerTone: "chat" })} />);
    expect(screen.getByPlaceholderText("Ask Aura anything...")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Chat mode" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Code mode" })).not.toBeInTheDocument();
  });

  it("renders the current input value", () => {
    render(<ChatInputBar {...makeProps({ input: "Hello world" })} />);
    expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
  });

  it("calls onInputChange when typing", async () => {
    const user = userEvent.setup();
    const onInputChange = vi.fn();
    render(<ChatInputBar {...makeProps({ onInputChange })} />);

    await user.type(screen.getByPlaceholderText("/ for commands, @ for context"), "H");
    expect(onInputChange).toHaveBeenCalled();
  });

  it("opens slash commands only for the trailing token", () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    const onInputChange = vi.fn();
    try {
      render(<ChatInputBar {...makeProps({ onInputChange })} />);

      const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
      const promptWithPath = "inspect src/foo/bar";
      fireEvent.change(textarea, {
        target: {
          value: promptWithPath,
          selectionStart: promptWithPath.length,
          selectionEnd: promptWithPath.length,
        },
      });
      expect(screen.queryByText("Record Demo")).not.toBeInTheDocument();

      const promptWithCommand = "please /rec";
      fireEvent.change(textarea, {
        target: {
          value: promptWithCommand,
          selectionStart: promptWithCommand.length,
          selectionEnd: promptWithCommand.length,
        },
      });
      expect(screen.getByText("Record Demo")).toBeInTheDocument();
      expect(onInputChange).toHaveBeenLastCalledWith(promptWithCommand);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("does not open file mentions for a local workspace outside the desktop app", () => {
    mockLinkedWorkspace = false;
    const onInputChange = vi.fn();
    render(
      <ChatInputBar
        {...makeProps({
          onInputChange,
          workspacePath: "/Users/demo/project",
          machineType: "local",
        })}
      />,
    );

    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
    fireEvent.change(textarea, {
      target: {
        value: "@",
        selectionStart: 1,
        selectionEnd: 1,
      },
    });

    expect(onInputChange).toHaveBeenLastCalledWith("@");
    expect(screen.queryByText("No matching files")).not.toBeInTheDocument();
  });

  it("selects a project agent and sends its exact binding", async () => {
    const onSend = vi.fn();
    const maya = {
      agent_id: "agent-maya",
      agent_instance_id: "instance-maya",
      name: "Maya",
      role: "Product designer",
      status: "active",
      instance_role: "chat",
      source: "ui",
      machine_type: "remote",
    } as AgentInstance;
    mockRemoteStatuses = { "agent-maya": "running" };

    function ControlledComposer() {
      const [value, setValue] = useState("");
      return (
        <ChatInputBar
          {...makeProps({
            input: value,
            onInputChange: setValue,
            onSend,
            projectAgents: [maya],
            currentAgentInstanceId: "instance-current",
          })}
        />
      );
    }

    render(<ControlledComposer />);
    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
    fireEvent.change(textarea, {
      target: { value: "ask @ma", selectionStart: 7, selectionEnd: 7 },
    });
    expect(screen.getByText("Project agents")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Maya/i }));
    expect(screen.getByLabelText("Agents included in this message")).toHaveTextContent(
      "Maya",
    );

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(
      "ask @Maya ",
      undefined,
      undefined,
      undefined,
      [{ agent_id: "agent-maya", agent_instance_id: "instance-maya" }],
    );
  });

  it("shows an offline project agent but prevents selecting it", async () => {
    const onSend = vi.fn();
    const maya = {
      agent_id: "agent-maya",
      agent_instance_id: "instance-maya",
      name: "Maya",
      role: "Product designer",
      status: "idle",
      instance_role: "chat",
      source: "ui",
      machine_type: "remote",
    } as AgentInstance;
    mockRemoteStatuses = { "agent-maya": "stopped" };

    function ControlledComposer() {
      const [value, setValue] = useState("");
      return (
        <ChatInputBar
          {...makeProps({
            input: value,
            onInputChange: setValue,
            onSend,
            projectAgents: [maya],
            currentAgentInstanceId: "instance-current",
          })}
        />
      );
    }

    render(<ControlledComposer />);
    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
    fireEvent.change(textarea, {
      target: { value: "ask @ma", selectionStart: 7, selectionEnd: 7 },
    });

    const mayaOption = screen.getByRole("button", { name: /Maya/i });
    expect(mayaOption).toBeDisabled();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    await userEvent.click(mayaOption);
    expect(screen.queryByLabelText("Agents included in this message")).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onSend on Enter key (without shift)", () => {
    vi.useFakeTimers();
    const onSend = vi.fn();

    try {
      render(<ChatInputBar {...makeProps({ input: "Test message", onSend })} />);

      const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
      fireEvent.keyDown(textarea, { key: "Enter" });
      act(() => {
        vi.advanceTimersByTime(ENTER_SUBMIT_GRACE_MS);
      });
      // Mode is now read from the per-stream store inside `useChatPanelState.handleSend`,
      // so the input bar no longer threads `generationMode` through this callback.
      expect(onSend).toHaveBeenCalledWith("Test message", undefined, undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call onSend on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInputBar {...makeProps({ input: "Test message", onSend })} />);

    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
    await user.click(textarea);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables send button when input is empty and no attachments", () => {
    render(<ChatInputBar {...makeProps({ input: "" })} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("enables send button when input has text", () => {
    render(<ChatInputBar {...makeProps({ input: "Hey" })} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("calls onSend when send button is clicked", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInputBar {...makeProps({ input: "click test", onSend })} />);

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("click test", undefined, undefined);
  });

  it("routes /btw to an ephemeral aside instead of the main chat", async () => {
    const onSend = vi.fn();
    const onAside = vi.fn();
    const onInputChange = vi.fn();
    const onCommandsChange = vi.fn();
    render(
      <ChatInputBar
        {...makeProps({
          input: "  What does that acronym mean?  ",
          onInputChange,
          onSend,
          onAside,
          onCommandsChange,
          selectedCommands: [
            {
              id: "btw",
              label: "BTW",
              description: "Ask a quick side question",
              category: "Core",
            },
          ],
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAside).toHaveBeenCalledWith("What does that acronym mean?");
    expect(onSend).not.toHaveBeenCalled();
    expect(onInputChange).toHaveBeenCalledWith("");
    expect(onCommandsChange).toHaveBeenCalledWith([]);
  });

  it("shows stop button when streaming", () => {
    mockIsStreaming = true;
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("calls onStop when stop button is clicked", async () => {
    const user = userEvent.setup();
    mockIsStreaming = true;
    const onStop = vi.fn();
    render(<ChatInputBar {...makeProps({ onStop })} />);

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("shows stop button when externally busy even if chat is idle", () => {
    mockIsStreaming = false;
    render(<ChatInputBar {...makeProps({ isExternallyBusy: true })} />);
    const stop = screen.getByRole("button", { name: "Stop automation" });
    expect(stop).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("calls onStop when externally busy stop button is clicked", async () => {
    const user = userEvent.setup();
    mockIsStreaming = false;
    const onStop = vi.fn();
    render(
      <ChatInputBar
        {...makeProps({
          isExternallyBusy: true,
          externalBusyMessage: "Agent is running automation",
          onStop,
        })}
      />,
    );

    const stop = screen.getByRole("button", { name: "Stop automation" });
    expect(stop).toHaveAttribute("title", "Agent is running automation");
    await user.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("renders the queued hint when isQueued=true", () => {
    render(<ChatInputBar {...makeProps({ isQueued: true })} />);
    const hint = screen.getByRole("status");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent(/queued behind current turn/i);
  });

  it("uses the override copy when queuedHint is provided", () => {
    render(
      <ChatInputBar
        {...makeProps({ isQueued: true, queuedHint: "Hold tight — your turn is next" })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Hold tight — your turn is next",
    );
  });

  it("clears the queued hint when isQueued flips to false", () => {
    const { rerender } = render(
      <ChatInputBar {...makeProps({ isQueued: true })} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(<ChatInputBar {...makeProps({ isQueued: false })} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not render the queued hint by default", () => {
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows default model label when selectedModel set in store", () => {
    mockSelectedModel = "aura-claude-opus-4-6";
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getAllByText("Opus 4.6")[0]).toBeInTheDocument();
  });

  it("shows selected model label", () => {
    mockSelectedModel = "aura-claude-sonnet-4-6";
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getAllByText("Sonnet 4.6")[0]).toBeInTheDocument();
  });

  it("opens model dropdown on click and calls setSelectedModel", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-claude-opus-4-6";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("Opus 4.6")[0]);
    expect(screen.getAllByText("Anthropic")[0]).toBeInTheDocument();

    await user.click(screen.getAllByText("Sonnet 4.6")[0]);
    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "aura-claude-sonnet-4-6",
      undefined,
      undefined,
      undefined,
    );
  });

  it("groups chat models by provider with every section expanded by default", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("GPT-5.4")[0]);

    // Provider headers render immediately (no "Show all models" step).
    expect(screen.getAllByText("Anthropic")[0]).toBeInTheDocument();
    expect(screen.getAllByText("OpenAI")[0]).toBeInTheDocument();
    expect(screen.getAllByText("DeepSeek AI")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Moonshot AI")[0]).toBeInTheDocument();
    expect(screen.getAllByText("MiniMax")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Z.ai")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Alibaba Cloud")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Google")[0]).toBeInTheDocument();
    // The single "Open Source" header is now split per provider.
    expect(screen.queryByText("Open Source")).not.toBeInTheDocument();

    // Models that used to be hidden behind "Show all" are visible now.
    expect(screen.getAllByText("Kimi K2.6")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Haiku 4.5")[0]).toBeInTheDocument();
    // GPT-OSS 120B now lives in the OpenAI section.
    expect(screen.getAllByText("GPT-OSS 120B")[0]).toBeInTheDocument();
    expect(screen.getAllByText("GLM 5.1")[0]).toBeInTheDocument();
  });

  it("collapses and expands a provider section when its header is clicked", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("GPT-5.4")[0]);
    expect(screen.getAllByText("Opus 4.8")[0]).toBeInTheDocument();

    await user.click(screen.getAllByText("Anthropic")[0]);
    expect(screen.queryByText("Opus 4.8")).not.toBeInTheDocument();

    await user.click(screen.getAllByText("Anthropic")[0]);
    expect(screen.getAllByText("Opus 4.8")[0]).toBeInTheDocument();
  });

  it("relocates the model picker and send button into the bottom row when the prompt wraps", () => {
    // The shell decides single/multi-line by comparing two hidden mirror
    // divs (see useInputAutosize): the content mirror renders the prompt
    // at the single-line layout's width, the baseline mirror renders a
    // single line. JSDOM runs no layout, so stub the heights: 40px
    // content vs 20px baseline reads as "wrapped to a second line".
    const restoreMirrors = stubMirrorHeights({ content: 40, baseline: 20 });

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const { container } = render(
        <ChatInputBar
          {...makeProps({
            input:
              "a long prompt that pretends to wrap across multiple visual lines so the picker should drop into the footer",
          })}
        />,
      );

      // The chat surface wraps the relocated picker in `.bottomChromeRow`
      // (class names are string-proxied to their own names by the CSS
      // module mock). Two ModelPicker instances always render — the
      // hidden `.mobileModelBar` one and the desktop one — so query
      // by structural class instead of by accessible name to avoid
      // matching the mobile copy.
      const bottomRow = container.querySelector(".bottomChromeRow");
      expect(bottomRow).not.toBeNull();
      // The picker trigger lives under the bottom row and surfaces the
      // active model label.
      const trigger = bottomRow!.querySelector(
        '[data-agent-action="open-model-picker"]',
      );
      expect(trigger).not.toBeNull();
      expect(trigger?.textContent).toMatch(/Opus 4\.6/);
      // The single-line slot must be empty (no inline picker present).
      expect(container.querySelector(".inputRowEnd")).toBeNull();
      // The send button moves out of the input row and becomes a flex
      // child of the shell's bottom controls row, after the picker.
      const shellBottomRow = container.querySelector(".containerBottomRow");
      expect(shellBottomRow).not.toBeNull();
      expect(
        shellBottomRow!.querySelector('button[aria-label="Send"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('.inputRow button[aria-label="Send"]'),
      ).toBeNull();
    } finally {
      restoreMirrors();
    }
  });

  it("stays in the multi-line layout while the prompt would still wrap in the single-line layout", () => {
    // Regression: backspacing a still-wrapping prompt used to flip the
    // picker back inline because the wider multi-line layout briefly let
    // the text fit on one line. The mirrors always keep the single-line
    // layout's insets, so the decision cannot be affected by the
    // relocated controls — as long as the content mirror reports a
    // wrapped height, the layout must hold.
    const restoreMirrors = stubMirrorHeights({ content: 40, baseline: 20 });

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const longPrompt =
        "Create a three page branding guideline and marketing plan for a digital fashion brand";
      const { container, rerender } = render(
        <ChatInputBar {...makeProps({ input: longPrompt })} />,
      );
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();

      // Simulate one backspace; the prompt still wraps at the
      // single-line reference width, so the layout must not flap.
      rerender(
        <ChatInputBar
          {...makeProps({ input: longPrompt.slice(0, -1) })}
        />,
      );
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();
      expect(container.querySelector(".inputRowEnd")).toBeNull();
    } finally {
      restoreMirrors();
    }
  });

  it("collapses back to the single-line layout once the prompt fits one line again", () => {
    const heights = { content: 40, baseline: 20 };
    const restoreMirrors = stubMirrorHeights(heights);

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const { container, rerender } = render(
        <ChatInputBar
          {...makeProps({ input: "a prompt long enough to wrap" })}
        />,
      );
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();
      expect(
        container.querySelector('.inputRow button[aria-label="Send"]'),
      ).toBeNull();

      // The shortened prompt fits one line at the single-line reference
      // width: controls return inline (picker slot + corner send).
      heights.content = 20;
      rerender(<ChatInputBar {...makeProps({ input: "short" })} />);
      expect(container.querySelector(".bottomChromeRow")).toBeNull();
      expect(container.querySelector(".inputRowEnd")).not.toBeNull();
      expect(
        container.querySelector('.inputRow button[aria-label="Send"]'),
      ).not.toBeNull();
    } finally {
      restoreMirrors();
    }
  });

  it("keeps the multi-line layout when the ResizeObserver fires after the state swap", () => {
    // Regression guard for the historical picker bounce: flipping to
    // multi-line swaps the textarea's padding, which fires the
    // ResizeObserver, which re-measures. The mirrors are unaffected by
    // the swap (they keep the single-line insets), so the re-measure
    // must re-confirm the multi-line state instead of reversing it —
    // no lockout machinery required.
    let capturedCallback: ResizeObserverCallback | null = null;
    let observedTarget: HTMLTextAreaElement | null = null;
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        capturedCallback = cb;
      }
      observe(target: Element) {
        observedTarget = target as HTMLTextAreaElement;
      }
      unobserve() {}
      disconnect() {}
    }
    const originalRO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    // The hook batches ResizeObserver-driven re-measures through
    // requestAnimationFrame; run them synchronously so the assertion
    // below observes the post-fire state.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    const restoreMirrors = stubMirrorHeights({ content: 40, baseline: 20 });

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const longPrompt =
        "Build a modern marketing website for a SaaS product with a hero, feature grid, pricing, and FAQ. jjjj";
      const { container } = render(
        <ChatInputBar {...makeProps({ input: longPrompt })} />,
      );

      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();
      expect(container.querySelector(".inputRowEnd")).toBeNull();

      // Simulate the ResizeObserver fire the `data-multiline` padding
      // swap would trigger in a real browser.
      expect(capturedCallback).not.toBeNull();
      expect(observedTarget).not.toBeNull();
      const entry = {
        target: observedTarget,
        contentRect: { width: 600, height: 32 } as DOMRectReadOnly,
      } as unknown as ResizeObserverEntry;
      act(() => {
        capturedCallback!([entry], {} as ResizeObserver);
      });

      // The picker stays in the bottom chrome row — no flap back to
      // the inline slot.
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();
      expect(container.querySelector(".inputRowEnd")).toBeNull();
    } finally {
      restoreMirrors();
      rafSpy.mockRestore();
      if (originalRO) {
        (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalRO;
      } else {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      }
    }
  });

  it("keeps the model picker inline near the send button when the textarea fits on one line", () => {
    // Default JSDOM behavior: every mirror's scrollHeight is 0, so the
    // content mirror never exceeds the baseline and the picker stays in
    // the absolutely-positioned `inputRowEnd` slot to the left of the
    // send button (single-line layout).
    mockSelectedModel = "aura-claude-opus-4-6";
    const { container } = render(
      <ChatInputBar {...makeProps({ input: "short prompt" })} />,
    );

    const inlineSlot = container.querySelector(".inputRowEnd");
    expect(inlineSlot).not.toBeNull();
    const trigger = inlineSlot!.querySelector(
      '[data-agent-action="open-model-picker"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toMatch(/Opus 4\.6/);
    expect(container.querySelector(".bottomChromeRow")).toBeNull();
  });

  it("does not show image-only models in the chat model picker", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("GPT-5.4")[0]);

    expect(screen.queryByText("GPT Image 2")).not.toBeInTheDocument();
  });

  it("surfaces thinking effort directly in the model picker", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    mockSelectedEffort = "low";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("GPT-5.4 L")[0]);

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();

    await user.click(screen.getByText("Medium"));
    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "aura-gpt-5-4",
      undefined,
      undefined,
      "medium",
    );
  });

  it("shows image models when Image mode is active", async () => {
    const user = userEvent.setup();
    mockSelectedMode = "image";
    mockSelectedModel = "gpt-image-2";
    render(<ChatInputBar {...makeProps()} />);

    expect(screen.getAllByText("GPT Image 2")[0]).toBeInTheDocument();

    await user.click(screen.getAllByText("GPT Image 2")[0]);
    await user.click(screen.getAllByText("GPT Image 1")[0]);

    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "gpt-image-1",
      undefined,
      undefined,
      undefined,
    );
  });

  it("switches mode via the mode selector segmented control", async () => {
    const user = userEvent.setup();
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getByRole("radio", { name: "Image mode" }));
    expect(mockSetSelectedMode).toHaveBeenCalledWith(
      "test-stream",
      "image",
      undefined,
      undefined,
    );
  });

  it("supports locally controlled mode selection without updating the store", async () => {
    const user = userEvent.setup();
    const onSelectedModeOverrideChange = vi.fn();
    render(
      <ChatInputBar
        {...makeProps({
          selectedModeOverride: "plan",
          onSelectedModeOverrideChange,
        })}
      />,
    );

    expect(screen.getByRole("radio", { name: "Plan mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(screen.getByRole("radio", { name: "Image mode" }));
    expect(onSelectedModeOverrideChange).toHaveBeenCalledWith("image");
    expect(mockSetSelectedMode).not.toHaveBeenCalled();
  });

  it("keeps the prompt read-only while the controlled mode selector stays active", async () => {
    const user = userEvent.setup();
    const onInputChange = vi.fn();
    const onSelectedModeOverrideChange = vi.fn();
    render(
      <ChatInputBar
        {...makeProps({
          input: "Locked marketing prompt",
          onInputChange,
          inputReadOnly: true,
          selectedModeOverride: "code",
          onSelectedModeOverrideChange,
        })}
      />,
    );

    const textarea = screen.getByDisplayValue("Locked marketing prompt");
    expect(textarea).toHaveAttribute("readonly");

    await user.type(textarea, "!");
    expect(onInputChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "Plan mode" }));
    expect(onSelectedModeOverrideChange).toHaveBeenCalledWith("plan");
  });

  it("focuses the textarea after a mode pill click so the user can keep typing", async () => {
    // Reproduces the empty-state surface in the screenshot: the user
    // lands on the centered compose, taps `Image`, then expects the
    // textarea to be ready for typing without an extra click.
    const user = userEvent.setup();
    render(<ChatInputBar {...makeProps()} />);

    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
    expect(document.activeElement).not.toBe(textarea);

    await user.click(screen.getByRole("radio", { name: "Image mode" }));
    expect(document.activeElement).toBe(textarea);
  });

  it("keeps the textarea focused when re-clicking the active mode pill", async () => {
    // `SlidingPills` no-ops the onChange when the pill is already
    // active, but the mousedown preventDefault on the button must
    // still keep the textarea focused so the user does not lose their
    // typing target on a stray click.
    const user = userEvent.setup();
    render(<ChatInputBar {...makeProps()} />);

    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    await user.click(screen.getByRole("radio", { name: "Code mode" }));
    expect(document.activeElement).toBe(textarea);
  });

  it("renders the visible modes in the segmented selector", () => {
    render(<ChatInputBar {...makeProps()} />);

    expect(screen.getByRole("radio", { name: "Code mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Plan mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Image mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "3D mode" })).toBeInTheDocument();
  });

  it("3D image step (no thumb): shows the image-step placeholder and Send enables on text", () => {
    mockSelectedMode = "3d";
    mockPinnedSourceImage = null;
    render(<ChatInputBar {...makeProps({ input: "" })} />);

    expect(
      screen.getByPlaceholderText("Describe an image to generate\u2026"),
    ).toBeInTheDocument();
    // No persistent "generate an image first" hint anymore — the
    // textarea itself prompts the user to describe the image.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // Empty text → Send disabled.
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("3D image step (no thumb): Send enables once the user types a prompt", async () => {
    const user = userEvent.setup();
    mockSelectedMode = "3d";
    mockPinnedSourceImage = null;
    const onSend = vi.fn();
    render(
      <ChatInputBar
        {...makeProps({ input: "a brass robot", onSend })}
      />,
    );

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith("a brass robot", undefined, undefined);
  });

  it("hides the attach button in 3D mode (manual attachments are not a valid source)", () => {
    mockSelectedMode = "3d";
    render(<ChatInputBar {...makeProps()} />);

    expect(
      screen.queryByRole("button", { name: "Attach file" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the decorative attach well in static 3D mode", () => {
    render(
      <ChatInputBar
        {...makeProps({
          isStatic: true,
          selectedModeOverride: "3d",
          attachAccent: <span data-testid="mock-attach-accent" />,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Attach file" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-attach-accent")).toBeInTheDocument();
  });

  it("3D model step (with thumb): renders the pinned source thumb and Send is enabled even with empty text", async () => {
    const user = userEvent.setup();
    mockSelectedMode = "3d";
    mockPinnedSourceImage = {
      imageUrl: "https://cdn.example.com/owl.png",
      prompt: "an owl",
    };
    const onSend = vi.fn();
    render(<ChatInputBar {...makeProps({ onSend })} />);

    const thumb = screen.getByRole("img", { name: "an owl" });
    expect(thumb).toHaveAttribute("src", "https://cdn.example.com/owl.png");
    expect(
      screen.getByPlaceholderText("Refine your 3D model (optional)"),
    ).toBeInTheDocument();

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith("", undefined, undefined);
  });

  it("3D model step (with thumb): X button on the thumb clears the pinned source image", async () => {
    const user = userEvent.setup();
    mockSelectedMode = "3d";
    mockPinnedSourceImage = {
      imageUrl: "https://cdn.example.com/owl.png",
      prompt: "an owl",
    };
    render(<ChatInputBar {...makeProps()} />);

    await user.click(
      screen.getByRole("button", { name: "Remove source image" }),
    );
    expect(mockSetPinnedSourceImage).toHaveBeenCalledWith("test-stream", null);
  });

  it("renders selected slash commands on their own stacked row and removes them", async () => {
    const user = userEvent.setup();
    const selectedCommands = [
      {
        id: "find_files",
        label: "Find Files",
        description: "Find files by name or glob",
        category: "Core",
      },
    ];
    const onCommandsChange = vi.fn();
    const { container } = render(
      <ChatInputBar
        {...makeProps({ selectedCommands, onCommandsChange })}
      />,
    );

    // Chips now live on a dedicated full-width row (stacked) so the tag
    // text stays fully legible, never crammed into the inline slot.
    const stackedSurface = container.querySelector(
      '[data-agent-surface="command-chips-stacked"]',
    );
    expect(stackedSurface).toContainElement(screen.getByText("/Find Files"));
    expect(
      container.querySelector('[data-agent-surface="command-chips-inline"]'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Find Files" }));
    expect(onCommandsChange).toHaveBeenCalledWith([]);
  });

  it("keeps the environment slot and divider mounted while machineType is loading (with a project)", () => {
    // Simulates the brief window after switching agents, when
    // useAgentChatMeta returns machineType=undefined while the new
    // projectAgentInstance query is in flight. With a project selected,
    // the orbit indicator on the right of the divider WILL paint, so
    // the slot must remain in the DOM to keep the orbit indicator from
    // shifting once machineType resolves.
    const project = {
      project_id: "p1",
      name: "Demo Project",
    } as unknown as NonNullable<Parameters<typeof ChatInputBar>[0]["projects"]>[number];
    const { container } = render(
      <ChatInputBar
        {...makeProps({
          machineType: undefined,
          projects: [project],
          selectedProjectId: "p1",
        })}
      />,
    );

    expect(container.querySelector(".environmentWrap")).not.toBeNull();
    expect(container.querySelector(".infoDivider")).not.toBeNull();
    expect(container.querySelector('[data-loading="true"]')).not.toBeNull();
  });

  it("hides the info divider when there is no project to anchor the orbit indicator", () => {
    // The "·" divider previously rendered unconditionally between
    // AgentEnvironment and OrbitStatusIndicator, leaving a bare dot
    // floating in the info bar of projectless chats (most visibly on
    // the logged-out chat surface and the authenticated "General"
    // chat). The fix gates the divider on a selected project so it
    // only paints when the orbit indicator actually has content.
    const { container } = render(
      <ChatInputBar {...makeProps({ machineType: "local" })} />,
    );

    expect(container.querySelector(".environmentWrap")).not.toBeNull();
    expect(container.querySelector(".orbitWrap")).not.toBeNull();
    expect(container.querySelector(".infoDivider")).toBeNull();
  });

  it("opens the mobile model sheet and calls setSelectedModel", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-claude-opus-4-6";
    render(<MobileChatInputBar {...makeProps({ machineType: "local" })} />);

    await user.click(screen.getByRole("button", { name: /Opus 4\.6/i }));
    expect(screen.getByRole("dialog", { name: "Select model" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Sonnet 4\.6/i })[0]);
    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "aura-claude-sonnet-4-6",
      undefined,
      undefined,
    );
  });

  it("sends exact project-agent bindings from the mobile composer", async () => {
    const onSend = vi.fn();
    const maya = {
      agent_id: "agent-maya",
      agent_instance_id: "instance-maya",
      name: "Maya",
      role: "Product designer",
      status: "active",
      instance_role: "chat",
      source: "ui",
      machine_type: "remote",
    } as AgentInstance;

    function ControlledMobileComposer() {
      const [value, setValue] = useState("");
      return (
        <MobileChatInputBar
          {...makeProps({
            input: value,
            onInputChange: setValue,
            onSend,
            projectAgents: [maya],
            currentAgentInstanceId: "instance-current",
          })}
        />
      );
    }

    render(<ControlledMobileComposer />);
    const textarea = screen.getByPlaceholderText("Message agent");
    fireEvent.change(textarea, {
      target: { value: "ask @ma", selectionStart: 7, selectionEnd: 7 },
    });
    await userEvent.click(screen.getByRole("button", { name: /Maya/i }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith(
      "ask @Maya ",
      undefined,
      undefined,
      undefined,
      [{ agent_id: "agent-maya", agent_instance_id: "instance-maya" }],
    );
  });

  it("routes mobile /btw questions outside the main transcript", async () => {
    const onSend = vi.fn();
    const onAside = vi.fn();
    render(
      <MobileChatInputBar
        {...makeProps({
          input: "Is that API public?",
          onSend,
          onAside,
          onCommandsChange: vi.fn(),
          selectedCommands: [
            {
              id: "btw",
              label: "BTW",
              description: "Ask a quick side question",
              category: "Core",
            },
          ],
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAside).toHaveBeenCalledWith("Is that API public?");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("uses sendDisabled to block mobile local-agent sends", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <MobileChatInputBar
        {...makeProps({
          input: "hello",
          machineType: "local",
          onSend,
          sendDisabled: true,
        })}
      />,
    );

    expect(screen.getByPlaceholderText(/Remote agent required/)).toBeDisabled();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders attachment previews", () => {
    const attachment: AttachmentItem = {
      id: "a1",
      file: new File(["data"], "test.png", { type: "image/png" }),
      data: "base64data",
      mediaType: "image/png",
      name: "test.png",
      attachmentType: "image",
      preview: "blob:http://localhost/fake",
    };
    render(<ChatInputBar {...makeProps({ attachments: [attachment] })} />);
    expect(screen.getByText("test.png")).toBeInTheDocument();
  });

  it("calls onRemoveAttachment when remove button clicked", async () => {
    const user = userEvent.setup();
    const attachment: AttachmentItem = {
      id: "a1",
      file: new File(["data"], "test.png", { type: "image/png" }),
      data: "base64data",
      mediaType: "image/png",
      name: "test.png",
      attachmentType: "image",
    };
    render(
      <ChatInputBar
        {...makeProps({
          attachments: [attachment],
          onRemoveAttachment: vi.fn(),
          onAttachmentsChange: vi.fn(),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(mockHandleRemove).toHaveBeenCalledWith("a1");
  });

  it("enables send when no text but has attachments", () => {
    const attachment: AttachmentItem = {
      id: "a1",
      file: new File(["data"], "test.png", { type: "image/png" }),
      data: "base64data",
      mediaType: "image/png",
      name: "test.png",
      attachmentType: "image",
    };
    render(<ChatInputBar {...makeProps({ input: "", attachments: [attachment] })} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("keeps send enabled in image mode while attachment upload is pending", async () => {
    const user = userEvent.setup();
    mockSelectedMode = "image";
    const onSend = vi.fn();
    const attachment: AttachmentItem = {
      id: "a1",
      file: new File(["data"], "reference.png", { type: "image/png" }),
      data: "base64data",
      mediaType: "image/png",
      name: "reference.png",
      attachmentType: "image",
      uploading: true,
    };

    render(
      <ChatInputBar
        {...makeProps({ input: "", attachments: [attachment], onSend })}
      />,
    );

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith("", undefined, undefined);
  });

  it("keeps send disabled in chat mode while attachment upload is pending", () => {
    const attachment: AttachmentItem = {
      id: "a1",
      file: new File(["data"], "reference.png", { type: "image/png" }),
      data: "base64data",
      mediaType: "image/png",
      name: "reference.png",
      attachmentType: "image",
      uploading: true,
    };

    render(<ChatInputBar {...makeProps({ input: "", attachments: [attachment] })} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("disables local remote-only agents with a desktop-app banner", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <MemoryRouter>
        <ChatInputBar
          {...makeProps({
            input: "hello",
            machineType: "local",
            onSend,
            sendDisabled: true,
            sendDisabledReason: "This local agent runs in the desktop app.",
            sendDisabledAction: { label: "Get desktop app", to: "/download" },
          })}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("This local agent runs in the desktop app."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get desktop app" })).toHaveAttribute(
      "href",
      "/download",
    );
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("intercepts image pastes even when the clipboard includes text formats", () => {
    const file = new File(["img"], "pasted.png", { type: "image/png" });
    const fileList = makeFileList(file);

    withMockDataTransfer(fileList, () => {
      const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("/ for commands, @ for context");
      const event = createEvent.paste(textarea, {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => file,
            },
            {
              kind: "string",
              type: "text/plain",
              getAsFile: () => null,
            },
          ],
        },
      });

      event.preventDefault = vi.fn();
      fireEvent(textarea, event);

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(mockAddFiles).toHaveBeenCalledTimes(1);
      expect(mockAddFiles).toHaveBeenCalledWith(fileList);
    });
  });

  it("preserves text-only pastes for the browser to handle", () => {
    const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("/ for commands, @ for context");
    const event = createEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
      },
    });

    event.preventDefault = vi.fn();
    fireEvent(textarea, event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockAddFiles).not.toHaveBeenCalled();
  });

  it("intercepts pure image pastes and forwards them to attachments", () => {
    const file = new File(["img"], "pasted.png", { type: "image/png" });
    const fileList = makeFileList(file);

    withMockDataTransfer(fileList, () => {
      const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("/ for commands, @ for context");
      const event = createEvent.paste(textarea, {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => file,
            },
          ],
        },
      });

      event.preventDefault = vi.fn();
      fireEvent(textarea, event);

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(mockAddFiles).toHaveBeenCalledTimes(1);
      expect(mockAddFiles).toHaveBeenCalledWith(fileList);
    });
  });
});
