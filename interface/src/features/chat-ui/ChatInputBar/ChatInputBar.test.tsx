import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockIsStreaming = false;
let mockIsMobileLayout = false;
vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => mockIsStreaming,
}));

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../components/InputBarShell/InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../mobile/chat/MobileChatInputBar/MobileChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: mockIsMobileLayout }),
}));

// AgentEnvironment now always mounts (it renders an inert placeholder while
// machineType is undefined to keep the bottom-bar slot stable). Stub out the
// async hook it depends on so tests don't trigger unwrapped-act warnings.
vi.mock("../../../hooks/use-environment-info", () => ({
  useEnvironmentInfo: () => ({ data: null, loading: false }),
}));

let mockSelectedModel: string | null = null;
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
    projectId: null,
    pinnedSourceImage: mockPinnedSourceImage,
    setSelectedMode: mockSetSelectedMode,
    setSelectedModel: mockSetSelectedModel,
    setProjectId: vi.fn(),
    setPinnedSourceImage: mockSetPinnedSourceImage,
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
import { MobileChatInputBar } from "../../../mobile/chat/MobileChatInputBar";
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
  mockPinnedSourceImage = null;
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

  it("calls onSend on Enter key (without shift)", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInputBar {...makeProps({ input: "Test message", onSend })} />);

    const textarea = screen.getByPlaceholderText("/ for commands, @ for context");
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

  it("relocates the model picker into the bottom chrome row when the textarea wraps to multi-line", async () => {
    // The shell measures multi-line state via `textarea.scrollHeight` against
    // a single-line baseline (~32px); JSDOM doesn't run real layout, so stub
    // the property to simulate a textarea tall enough to clear the threshold.
    // 80px is unambiguously > the 36px (32 + 4) cutoff in `autoResize`.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 80;
      },
    });

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
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          originalDescriptor,
        );
      } else {
        // @ts-expect-error - delete a custom getter we installed above
        delete HTMLTextAreaElement.prototype.scrollHeight;
      }
    }
  });

  it("stays in the multi-line layout while the prompt would still wrap if the picker were inline", () => {
    // Regression: backspacing a still-wrapping prompt used to flip the
    // picker back inline because the wider multi-line layout briefly let
    // the text fit on one line. The shell now re-measures with the
    // single-line padding-right reserve to confirm the prompt would
    // truly fit before collapsing — otherwise an entire keystroke loop
    // pad↔wrap↔unpad happens per character.
    //
    // Stub `scrollHeight` to mirror the wrap behavior. JSDOM doesn't run
    // layout, so we synthesize "would this text wrap?" from two signals
    // the shell controls during measurement:
    //   1. The shell applies an inline `padding-right: min(220px, 42%)`
    //      while doing its anti-oscillation re-measurement → wrap (80px).
    //   2. Otherwise we mirror what real CSS would do based on whether
    //      the parent input row has the `.inputRowHasEnd` class (the
    //      proxied CSS-module name): if it does, the inline-picker
    //      padding-right is reserved and the prompt wraps (80px); if it
    //      doesn't (multi-line state hides the inline slot), the prompt
    //      gets the full width and fits on one line (32px).
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        const inline = this.style.paddingRight ?? "";
        if (inline.includes("220") || inline.includes("42%")) return 80;
        if (
          this.parentElement?.className.includes("inputRowHasEnd")
        ) {
          return 80;
        }
        return 32;
      },
    });

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const longPrompt =
        "Create a three page branding guideline and marketing plan for a digital fashion brand";
      const { container, rerender } = render(
        <ChatInputBar {...makeProps({ input: longPrompt })} />,
      );
      // Initial render lands in multi-line because narrow padding wraps.
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();

      // Simulate one backspace. Layout-only scrollHeight at the now-wide
      // textarea would say single-line, but narrow re-measurement keeps
      // it multi-line.
      rerender(
        <ChatInputBar
          {...makeProps({ input: longPrompt.slice(0, -1) })}
        />,
      );
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();
      expect(container.querySelector(".inputRowEnd")).toBeNull();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          originalDescriptor,
        );
      } else {
        // @ts-expect-error - delete the custom getter we installed above
        delete HTMLTextAreaElement.prototype.scrollHeight;
      }
    }
  });

  it("stays in the single-line layout when the prompt would still fit if the picker dropped to the footer", () => {
    // Regression: at the wrap boundary, a prompt that wraps at single-line
    // padding-right (220px reserve) but would fit at multi-line padding
    // (32px reserve) used to cause the entire input bar to jitter
    // vertically in the centered empty-thread state. Flipping to multi-line
    // widened the textarea (dropped the picker reserve), the prompt fit on
    // one line, the bar collapsed back, the picker re-appeared, the
    // textarea narrowed, the prompt wrapped — per-frame oscillation. The
    // centered wrapper's `bottom: 50%; transform: translateY(50%)`
    // anchoring made the ~44px height delta visible as a fast up/down
    // shift of the whole bar. The shell now re-measures with the
    // multi-line padding-right reserve before entering multi-line and
    // only flips when the prompt would still wrap at the wider width.
    //
    // Stub `scrollHeight` to mirror the boundary behavior:
    //   1. Wide simulation (inline `padding-right: 32px`, the new
    //      single→multi anti-osc branch) → fits (32px).
    //   2. Narrow simulation (inline `padding-right: min(220px, 42%)`,
    //      the existing multi→single anti-osc branch) → wraps (80px).
    //   3. Otherwise mirror real CSS based on whether the parent input
    //      row carries `.inputRowHasEnd`: single-line layout reserves
    //      the inline picker padding → wraps (80px); multi-line layout
    //      releases it → fits (32px).
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        const inline = this.style.paddingRight ?? "";
        if (inline === "32px") return 32;
        if (inline.includes("220") || inline.includes("42%")) return 80;
        if (this.parentElement?.className.includes("inputRowHasEnd")) {
          return 80;
        }
        return 32;
      },
    });

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const boundaryPrompt =
        "A prompt right at the wrap boundary that fits when the picker drops";
      const { container } = render(
        <ChatInputBar {...makeProps({ input: boundaryPrompt })} />,
      );

      expect(container.querySelector(".inputRowEnd")).not.toBeNull();
      expect(container.querySelector(".bottomChromeRow")).toBeNull();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          originalDescriptor,
        );
      } else {
        // @ts-expect-error - delete the custom getter we installed above
        delete HTMLTextAreaElement.prototype.scrollHeight;
      }
    }
  });

  it("does not flap the model picker when the ResizeObserver fires after a multi-line toggle", () => {
    // Regression for the per-frame picker bounce that the centered
    // empty-thread state surfaces as a fast vertical jitter of the
    // entire input bar. At specific prompt lengths (e.g. the
    // 100-character "Build a modern marketing website..." prompt) the
    // anti-oscillation prediction in `autoResize` can disagree with
    // the actual layout by a sub-pixel: the narrow simulation says
    // "would fit single-line" while the actual narrow CSS layout
    // wraps (or vice-versa for the wide simulation). Pre-fix, the
    // `data-multiline` swap fired `ResizeObserver`, autoResize re-ran
    // at the new layout, the disagreement flipped the state back, the
    // CSS swapped again, `ResizeObserver` fired again — picker bounces
    // inline↔footer forever. Post-fix, the transition lockout
    // consumes exactly one `ResizeObserver` fire after every state
    // toggle so the self-induced reflow cannot undo the toggle.
    //
    // We can't reproduce the sub-pixel disagreement directly in
    // JSDOM (no real layout), so we install a `ResizeObserver` mock
    // that captures the callback + asymmetric `scrollHeight` stubs
    // where the simulation values are intentionally inconsistent
    // with the "actual" values for the same padding-right. Without
    // the lockout, the manual `ResizeObserver` fire below would flip
    // the picker back to the inline slot; with the lockout, the
    // picker stays in the bottom chrome row.
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

    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        const inline = this.style.paddingRight ?? "";
        // Wide simulation (anti-osc single→multi branch) says wraps,
        // so the initial render enters multi-line.
        if (inline === "32px") return 80;
        // Narrow simulation (anti-osc multi→single branch) says FITS.
        // This is the asymmetry that pre-fix triggers the loop: at the
        // multi-line layout, naturalMulti=false and the narrow sim
        // agrees → state flips back to single → cycle repeats.
        if (inline.includes("220") || inline.includes("42%")) return 32;
        // Actual single-line layout (inputRow has .inputRowHasEnd
        // because the picker is inline) → wraps. Drives the initial
        // single→multi transition.
        if (this.parentElement?.className.includes("inputRowHasEnd")) {
          return 80;
        }
        // Actual multi-line layout (no .inputRowHasEnd because the
        // picker dropped to the footer) → fits. This is what the
        // `ResizeObserver` callback measures after the state swap.
        return 32;
      },
    });

    try {
      mockSelectedModel = "aura-claude-opus-4-6";
      const longPrompt =
        "Build a modern marketing website for a SaaS product with a hero, feature grid, pricing, and FAQ. jjjj";
      const { container } = render(
        <ChatInputBar {...makeProps({ input: longPrompt })} />,
      );

      // The initial render lands in multi-line because both the actual
      // narrow layout and the wide simulation say "wraps".
      expect(container.querySelector(".bottomChromeRow")).not.toBeNull();
      expect(container.querySelector(".inputRowEnd")).toBeNull();

      // Simulate the `ResizeObserver` fire that the `data-multiline`
      // CSS swap would trigger in a real browser. Pre-fix this fire
      // would re-run autoResize, see naturalMulti=false at the wide
      // actual layout, narrow-sim would (incorrectly) say "fits", and
      // the picker would slide back to the inline slot. Post-fix the
      // transition lockout swallows the fire.
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
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          originalDescriptor,
        );
      } else {
        // @ts-expect-error - delete the custom getter we installed above
        delete HTMLTextAreaElement.prototype.scrollHeight;
      }
      if (originalRO) {
        (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalRO;
      } else {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      }
    }
  });

  it("keeps the model picker inline near the send button when the textarea fits on one line", () => {
    // Default JSDOM behavior: scrollHeight is 0, well under the 36px multi-line
    // threshold, so the picker stays in the absolutely-positioned `inputRowEnd`
    // slot to the left of the send button (single-line layout).
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
      <ChatInputBar
        {...makeProps({
          input: "hello",
          machineType: "local",
          onSend,
          sendDisabled: true,
          sendDisabledReason: "This is a local agent and can only be used in the desktop app.",
        })}
      />,
    );

    expect(
      screen.getByText("This is a local agent and can only be used in the desktop app."),
    ).toBeInTheDocument();
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
