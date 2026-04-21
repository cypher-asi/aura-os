import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockIsStreaming = false;
vi.mock("../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
}));

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

let mockSelectedModel: string | null = null;
const mockSetSelectedModel = vi.fn();
const mockAddFiles = vi.fn();
const mockHandleRemove = vi.fn();
vi.mock("../../stores/chat-ui-store", () => ({
  useChatUI: () => ({
    selectedModel: mockSelectedModel,
    projectId: null,
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

beforeEach(() => {
  mockIsStreaming = false;
  mockSelectedModel = null;
  mockSetSelectedModel.mockClear();
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
    expect(onSend).toHaveBeenCalledWith("Test message", undefined, undefined, undefined);
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
    expect(onSend).toHaveBeenCalledWith("click test", undefined, undefined, undefined);
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

  it("shows default model label when selectedModel set in store", () => {
    mockSelectedModel = "aura-claude-opus-4-6";
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getByText("Opus 4.6")).toBeInTheDocument();
  });

  it("shows selected model label", () => {
    mockSelectedModel = "aura-claude-sonnet-4-6";
    render(<ChatInputBar {...makeProps()} />);
    expect(screen.getByText("Sonnet 4.6")).toBeInTheDocument();
  });

  it("opens model dropdown on click and calls setSelectedModel", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-claude-opus-4-6";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getByText("Opus 4.6"));
    expect(screen.getByText("Kimi K2.6")).toBeInTheDocument();

    await user.click(screen.getByText("Sonnet 4.6"));
    expect(mockSetSelectedModel).toHaveBeenCalledWith(
      "test-stream",
      "aura-claude-sonnet-4-6",
      undefined,
      undefined,
    );
  });

  it("shows all models grouped by provider after expanding", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "aura-gpt-5-4";
    render(<ChatInputBar {...makeProps()} />);

    await user.click(screen.getByText("GPT-5.4"));
    await user.click(screen.getByText("Show all models"));

    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Open source")).toBeInTheDocument();
    expect(screen.getByText("GPT-OSS 120B")).toBeInTheDocument();
  });

  it("shows a fixed codex model without opening a dropdown", async () => {
    const user = userEvent.setup();
    mockSelectedModel = "codex";
    render(<ChatInputBar {...makeProps({ adapterType: "codex" })} />);

    await user.click(screen.getByText("Codex"));
    expect(screen.queryByText("Kimi K2.6")).not.toBeInTheDocument();
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

  it("preserves mixed text and image pastes for the browser to handle", () => {
    const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("What do you want to create?");
    const event = createEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => new File(["img"], "pasted.png", { type: "image/png" }),
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

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockAddFiles).not.toHaveBeenCalled();
  });

  it("intercepts pure image pastes and forwards them to attachments", () => {
    const originalDataTransfer = globalThis.DataTransfer;
    const fileList = {
      length: 1,
      0: new File(["img"], "pasted.png", { type: "image/png" }),
      item: (index: number) => (index === 0 ? fileList[0] : null),
      [Symbol.iterator]: function* iterator() {
        yield fileList[0];
      },
    } as unknown as FileList;

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
      const textarea = render(<ChatInputBar {...makeProps()} />).getByPlaceholderText("What do you want to create?");
      const event = createEvent.paste(textarea, {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => fileList[0],
            },
          ],
        },
      });

      event.preventDefault = vi.fn();
      fireEvent(textarea, event);

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(mockAddFiles).toHaveBeenCalledTimes(1);
      expect(mockAddFiles).toHaveBeenCalledWith(fileList);
    } finally {
      Object.defineProperty(globalThis, "DataTransfer", {
        configurable: true,
        value: originalDataTransfer,
      });
    }
  });
});
