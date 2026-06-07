/**
 * Smoke test for `TypewriterText`. Pins the streaming-character
 * behaviour at the unit level so the MockAuraApp suite stays
 * focused on the timeline orchestrator while the per-character
 * stream contract lives next to its component.
 *
 *  - The caret is rendered while the stream is in progress and
 *    is visually hidden (but kept mounted) once the last character
 *    has rolled in. Keeping the inline-block caret in the line at
 *    completion preserves the line box's baseline strut, which
 *    avoids a ~1px vertical jump of the message text in the
 *    surrounding DM bubble. The `data-state` attribute lets this
 *    test pin "blinking" vs "hidden" without depending on the
 *    hashed CSS module class names.
 *  - `prefers-reduced-motion: reduce` does NOT short-circuit the
 *    stream. The only current consumer is the decorative
 *    `MockAuraApp` (via its DM windows), which is explicitly
 *    designed to play every animation regardless of the media query
 *    (see the mock app's
 *    file-level comment) — pinning the message to "appear instantly"
 *    for reduced-motion users made the demo loop read as broken.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TypewriterText } from "./TypewriterText";

afterEach(() => {
  vi.useRealTimers();
});

describe("TypewriterText", () => {
  it("streams characters and hides (but keeps) the caret at completion", () => {
    vi.useFakeTimers();
    render(<TypewriterText text="hi" speedMs={10} />);
    // Caret rendered + blinking at start (no characters streamed yet).
    const initialCaret = document.querySelector("span > span");
    expect(initialCaret).not.toBeNull();
    expect(initialCaret?.getAttribute("data-state")).toBe("blinking");
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(screen.getByText("hi")).toBeInTheDocument();
    // After the stream completes the caret stays mounted (so the
    // inline-block keeps contributing to the line box and the text
    // doesn't subpixel-jump ~1px) but is flagged hidden.
    const settledCaret = document.querySelector("span > span");
    expect(settledCaret).not.toBeNull();
    expect(settledCaret?.getAttribute("data-state")).toBe("hidden");
  });

  it("omits the caret entirely when showCaret is false", () => {
    vi.useFakeTimers();
    render(<TypewriterText text="hi" speedMs={10} showCaret={false} />);
    // No trailing caret span is rendered at the start of the stream...
    expect(document.querySelector("span > span")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(40);
    });
    // ...nor after the stream completes (the marketing hero look).
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(document.querySelector("span > span")).toBeNull();
  });

  it("streams characters even when prefers-reduced-motion matches", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: query.includes("reduce"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });

    vi.useFakeTimers();
    render(<TypewriterText text="hello" speedMs={20} />);
    // At t=0 nothing has streamed yet — the bubble is empty save
    // for the caret. If the reduced-motion shortcircuit were back,
    // the full text would already be in the DOM at this point.
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("ignores `text` and types the first phrase in loop mode, caret blinking", () => {
    vi.useFakeTimers();
    render(
      <TypewriterText
        text="ignored"
        phrases={["AB", "CD"]}
        speedMs={10}
        holdMs={100}
        eraseMs={10}
      />,
    );
    // `text` is ignored in loop mode — only the phrase stream paints.
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(screen.getByText("AB")).toBeInTheDocument();
    // The caret never settles to hidden while the loop is running.
    expect(
      document.querySelector("span > span")?.getAttribute("data-state"),
    ).toBe("blinking");
  });

  it("holds, erases, and advances to the next phrase in loop mode", () => {
    vi.useFakeTimers();
    render(
      <TypewriterText
        text="ignored"
        phrases={["AB", "CD"]}
        speedMs={10}
        holdMs={100}
        eraseMs={10}
      />,
    );

    // One continuous advance so the chained type -> hold -> erase ->
    // next-phrase timers all flush inside a single fake-timer pass:
    //   t10 "A", t20 "AB", hold→t120, erase t130 "A" / t140 "",
    //   next phrase t150 "C", t160 "CD".
    act(() => {
      vi.advanceTimersByTime(170);
    });
    expect(screen.getByText("CD")).toBeInTheDocument();
    expect(
      document.querySelector("span > span")?.getAttribute("data-state"),
    ).toBe("blinking");
  });
});
