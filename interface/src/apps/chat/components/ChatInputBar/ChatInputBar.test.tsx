import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockIsStreaming = false;
let mockIsMobileLayout = false;
vi.mock("../../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
}));

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../../components/InputBarShell/InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../../mobile/chat/MobileChatInputBar/MobileChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: mockIsMobileLayout }),
}));

let mockSelectedModel: string | null = null;
let mockSelectedMode: "code" | "plan" | "image" | "3d" = "code";
const mockSetSelectedModel = vi.fn();
const mockSetSelectedMode = vi.fn();
const mockAddFiles = vi.fn();
const mockHandleRemove = vi.fn();
vi.mock("../../../../stores/chat-ui-store", () => ({
  useChatUI: () => ({
    selectedMode: mockSelectedMode,
    selectedModel: mockSelectedModel,
    projectId: null,
    setSelectedMode: mockSetSelectedMode,
    setSelectedModel: mockSetSelectedModel,
    setProjectId: vi.fn(),
    init: vi.fn(),
    syncAvailableModels: vi.fn(),
  }),
}));

vi.mock("./useFileAttachments", () => ({
  useFileAttachments: () => ({
    canAddMore: true,
    addFiles: mockAddFiles,
    handleRemove: mockHandleRemove,
  }),
}));

import { ChatInputBar } from "../ChatInputBar";
import { MobileChatInputBar } from "../../../../mobile/chat/MobileChatInputBar";
import type { AttachmentItem } from "../ChatInputBar";

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
  mockSelectedModel = null;
  mockSelectedMode = "code";
  mockSetSelectedModel.mockClear();
  mockSetSelectedMode.mockClear();
  mockAddFiles.mockClear();
  mockHandleRemove.mockClear();
});

describe("ChatInputBar", () => {
  it("renders the textarea with placeholder", () => {
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getByPlaceholderText("What do you want to create?")).toBeInTheDocument();
  });

  it("renders the current input value", () => {
    render(<ChatInputBar {...makeProps({ input: "Hello world" })} />);
    expect(screen.getByDisplayValue("Hello world")).toBeInTheDocument();
  });

  it("calls onInputChange when typing", async () => {
    const user = userEvent.setup();
    const onInputChange = vi.fn();
    render(<ChatInputBar {...makeProps({ onInputChange })} />);

    await user.type(screen.getByPlaceholderText("What do you want to create?"), "H");
    expect(onInputChange).toHaveBeenCalled();
  });

  it("calls onSend on Enter key (without shift)", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInputBar {...makeProps({ input: "Test message", onSend })} />);

    const textarea = screen.getByPlaceholderText("What do you want to create?");
    await user.click(textarea);
    await user.keyboard("{Enter}");
    // Mode is now read from the per-stream store inside `useChatPanelState.handleSend`,
    // so the input bar no longer threads `generationMode` through this callback.
    expect(onSend).toHaveBeenCalledWith("Test message", undefined, undefined);
  });

  it("does not call onSend on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInputBar {...makeProps({ input: "Test message", onSend })} />);

    const textarea = screen.getByPlaceholderText("What do you want to create?");
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
    expect(screen.getAllByText("Show all models")[0]).toBeInTheDocument();

    await user.click(screen.getAllByText("Sonnet 4.6")[0]);
    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "aura-claude-sonnet-4-6",
      undefined,
      undefined,
    );
  });

  it("shows all chat models grouped under Aura after expanding", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("GPT-5.4")[0]);
    await user.click(screen.getAllByText("Show all models")[0]);

    expect(screen.getAllByText("Aura")[0]).toBeInTheDocument();
    expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    expect(screen.queryByText("Anthropic")).not.toBeInTheDocument();
    expect(screen.queryByText("Open source")).not.toBeInTheDocument();
    expect(screen.getAllByText("GPT-OSS 120B")[0]).toBeInTheDocument();
  });

  it("does not show image-only models in the chat model picker", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getAllByText("GPT-5.4")[0]);
    await user.click(screen.getAllByText("Show all models")[0]);

    expect(screen.queryByText("GPT Image 2")).not.toBeInTheDocument();
  });

  it("shows image models when Image mode is active", async () => {
    const user = userEvent.setup();
    mockSelectedMode = "image";
    mockSelectedModel = "gpt-image-2";
    render(<ChatInputBar {...makeProps()} />);

    expect(screen.getByText("/image mode")).toBeInTheDocument();
    expect(screen.getAllByText("GPT Image 2")[0]).toBeInTheDocument();

    await user.click(screen.getAllByText("GPT Image 2")[0]);
    await user.click(screen.getAllByText("GPT Image 1")[0]);

    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "gpt-image-1",
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

  it("renders the visible modes in the segmented selector", () => {
    render(<ChatInputBar {...makeProps()} />);

    expect(screen.getByRole("radio", { name: "Code mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Plan mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Image mode" })).toBeInTheDocument();
    // 3D mode is temporarily hidden from the selector.
    expect(
      screen.queryByRole("radio", { name: "3D mode" }),
    ).not.toBeInTheDocument();
  });

  it("renders selected slash commands inline and removes them", async () => {
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

    const inlineSurface = container.querySelector(
      '[data-agent-surface="command-chips-inline"]',
    );
    expect(inlineSurface).toContainElement(screen.getByText("/Find Files"));
    expect(
      container.querySelector('[data-agent-surface="command-chips-stacked"]'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Find Files" }));
    expect(onCommandsChange).toHaveBeenCalledWith([]);
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

  it("intercepts image pastes even when the clipboard includes text formats", () => {
    const file = new File(["img"], "pasted.png", { type: "image/png" });
    const fileList = makeFileList(file);

    withMockDataTransfer(fileList, () => {
      const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("What do you want to create?");
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
    const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("What do you want to create?");
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
      const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("What do you want to create?");
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
