import { act, fireEvent, render } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("./InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import {
  ENTER_SUBMIT_GRACE_MS,
  InputBarShell,
  type InputBarShellProps,
} from "./InputBarShell";

function makeProps(
  overrides: Partial<InputBarShellProps> = {},
): InputBarShellProps {
  return {
    value: "",
    onValueChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

/**
 * Stubs the heights of the hidden wrap-measurement mirrors (see
 * `useInputAutosize`): the "content" mirror renders the value at the
 * single-line layout's width, the "baseline" mirror renders one line.
 * JSDOM runs no layout, so `scrollHeight` is shadowed per mirror kind.
 * Returns a restore function.
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

describe("InputBarShell", () => {
  it("keeps the start slot, end slot, and send button inline while the value fits one line", () => {
    // Default JSDOM: mirror scrollHeights are 0, so the content mirror
    // never exceeds the baseline → single-line layout.
    const { container } = render(
      <InputBarShell
        {...makeProps({
          value: "short",
          inputRowStart: <button type="button" aria-label="Attach" />,
          inputRowEnd: <span data-testid="end-slot" />,
        })}
      />,
    );

    const row = container.querySelector(".inputRow");
    expect(row).not.toBeNull();
    expect(row!.querySelector('button[aria-label="Send"]')).not.toBeNull();
    expect(row!.querySelector('button[aria-label="Attach"]')).not.toBeNull();
    expect(container.querySelector(".inputRowEnd")).not.toBeNull();
    expect(container.querySelector(".containerBottomRow")).toBeNull();
    // An inline end slot reserves its width in the wrap measurement.
    expect(
      container.querySelector('[data-autosize-mirror="content"]')!.className,
    ).toContain("sizeMirrorHasEnd");
  });

  it("moves the start slot and send button into the bottom row when the value wraps", () => {
    const restoreMirrors = stubMirrorHeights({ content: 40, baseline: 20 });
    const onMultiLineChange = vi.fn();

    try {
      const { container } = render(
        <InputBarShell
          {...makeProps({
            value: "a prompt long enough to wrap to a second visual line",
            inputRowStart: <button type="button" aria-label="Attach" />,
            inputRowEnd: <span data-testid="end-slot" />,
            onMultiLineChange,
          })}
        />,
      );

      const bottomRow = container.querySelector(".containerBottomRow");
      expect(bottomRow).not.toBeNull();
      expect(
        bottomRow!.querySelector('button[aria-label="Send"]'),
      ).not.toBeNull();
      expect(
        bottomRow!.querySelector('button[aria-label="Attach"]'),
      ).not.toBeNull();
      // The input row above holds only the (full-width) textarea now.
      const row = container.querySelector(".inputRow");
      expect(row!.querySelector('button[aria-label="Send"]')).toBeNull();
      expect(row!.querySelector('button[aria-label="Attach"]')).toBeNull();
      expect(container.querySelector(".inputRowEnd")).toBeNull();
      expect(
        container.querySelector('[data-multiline="true"]'),
      ).not.toBeNull();
      expect(onMultiLineChange).toHaveBeenLastCalledWith(true);
    } finally {
      restoreMirrors();
    }
  });

  it("renders the stop button in the bottom row while streaming in the multi-line state", () => {
    const restoreMirrors = stubMirrorHeights({ content: 40, baseline: 20 });

    try {
      const { container } = render(
        <InputBarShell
          {...makeProps({
            value: "a wrapping prompt while a response is streaming",
            isStreaming: true,
            onStop: vi.fn(),
          })}
        />,
      );

      const bottomRow = container.querySelector(".containerBottomRow");
      expect(bottomRow).not.toBeNull();
      expect(
        bottomRow!.querySelector('button[aria-label="Stop"]'),
      ).not.toBeNull();
    } finally {
      restoreMirrors();
    }
  });

  it("keeps the wrap-measurement reserve when the consumer relocates the end slot", () => {
    // Chat's multi-line case: `inputRowEnd` is null (the picker moved to
    // `containerBottom`), but `reserveInlineEnd` keeps the measurement
    // anchored to the single-line layout so the decision cannot shift
    // with the state it drives.
    const { container } = render(
      <InputBarShell
        {...makeProps({ value: "x", reserveInlineEnd: true })}
      />,
    );

    expect(
      container.querySelector('[data-autosize-mirror="content"]')!.className,
    ).toContain("sizeMirrorHasEnd");
  });

  it("grows the textarea's inline height to its content height", () => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 120,
    });

    try {
      const { container } = render(
        <InputBarShell {...makeProps({ value: "tall content" })} />,
      );
      const textarea = container.querySelector("textarea");
      expect(textarea!.style.height).toBe("120px");
    } finally {
      if (original) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          original,
        );
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollHeight?: unknown })
          .scrollHeight;
      }
    }
  });

  it("submits on Enter after a short grace period", () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();

    try {
      const { container } = render(
        <InputBarShell {...makeProps({ value: "send me", onSubmit })} />,
      );
      const textarea = container.querySelector("textarea")!;
      textarea.setSelectionRange(7, 7);

      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(ENTER_SUBMIT_GRACE_MS);
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not double-submit when Send is clicked during the Enter grace period", () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();

    try {
      const { container } = render(
        <InputBarShell {...makeProps({ value: "send me", onSubmit })} />,
      );
      const textarea = container.querySelector("textarea")!;
      textarea.setSelectionRange(7, 7);

      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.click(container.querySelector('button[aria-label="Send"]')!);
      act(() => {
        vi.advanceTimersByTime(ENTER_SUBMIT_GRACE_MS);
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats rapid text after Enter as a multiline input burst", () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const onValueChange = vi.fn();

    try {
      const { container } = render(
        <InputBarShell
          {...makeProps({
            value: "Line one",
            onSubmit,
            onValueChange,
          })}
        />,
      );
      const textarea = container.querySelector("textarea")!;
      textarea.setSelectionRange("Line one".length, "Line one".length);

      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, {
        target: { value: "Line oneLine two" },
      });
      act(() => {
        vi.advanceTimersByTime(ENTER_SUBMIT_GRACE_MS);
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(onValueChange).toHaveBeenLastCalledWith("Line one\nLine two");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("native autosize path (field-sizing: content supported)", () => {
    let capturedCallback: ResizeObserverCallback | null = null;
    let observedTargets: Element[] = [];

    beforeEach(() => {
      capturedCallback = null;
      observedTargets = [];
      // The hook samples support once per mount via CSS.supports.
      vi.stubGlobal("CSS", {
        supports: (property: string) => property === "field-sizing",
      });
      class MockResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          capturedCallback = cb;
        }
        observe(target: Element) {
          observedTargets.push(target);
        }
        unobserve() {}
        disconnect() {}
      }
      vi.stubGlobal(
        "ResizeObserver",
        MockResizeObserver as unknown as typeof ResizeObserver,
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** Delivers mirror sizes the way the browser's layout pass would. */
    function fireMirrorSizes(heights: { content: number; baseline: number }) {
      const entries = observedTargets.map((target) => ({
        target,
        contentRect: {
          height:
            target.getAttribute("data-autosize-mirror") === "content"
              ? heights.content
              : heights.baseline,
        },
      })) as unknown as ResizeObserverEntry[];
      act(() => {
        capturedCallback!(entries, {} as ResizeObserver);
      });
    }

    it("drives the wrap state from observed mirror sizes without touching the textarea height", () => {
      const { container } = render(
        <InputBarShell
          {...makeProps({
            value: "a prompt",
            inputRowStart: <button type="button" aria-label="Attach" />,
          })}
        />,
      );

      // The native path observes exactly the two mirrors (the fallback's
      // textarea observer is not installed).
      expect(observedTargets).toHaveLength(2);

      fireMirrorSizes({ content: 20, baseline: 20 });
      expect(container.querySelector('[data-multiline="true"]')).toBeNull();

      // The content mirror wrapping to a second line flips the layout.
      fireMirrorSizes({ content: 40, baseline: 20 });
      expect(
        container.querySelector('[data-multiline="true"]'),
      ).not.toBeNull();
      const bottomRow = container.querySelector(".containerBottomRow");
      expect(
        bottomRow!.querySelector('button[aria-label="Send"]'),
      ).not.toBeNull();
      // The browser owns the height — the hook must never write one.
      expect(container.querySelector("textarea")!.style.height).toBe("");

      // Fitting on one line again collapses back to the inline layout.
      fireMirrorSizes({ content: 20, baseline: 20 });
      expect(container.querySelector('[data-multiline="true"]')).toBeNull();
    });
  });
});
