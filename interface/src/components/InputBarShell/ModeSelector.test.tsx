import { act, render } from "@testing-library/react";
import { ModeSelector } from "./ModeSelector";

const rects: Record<string, { left: number; width: number }> = {
  code: { left: 10, width: 40 },
  plan: { left: 52, width: 44 },
  image: { left: 100, width: 56 },
  "3d": { left: 158, width: 32 },
};

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

function flushAnimationFrames(frames: FrameRequestCallback[]) {
  const pending = frames.splice(0);
  act(() => {
    pending.forEach((frame) => frame(performance.now()));
  });
}

describe("ModeSelector", () => {
  let frames: FrameRequestCallback[];
  let originalResizeObserver: typeof ResizeObserver;

  beforeEach(() => {
    frames = [];
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ paddingLeft: "2px" }) as CSSStyleDeclaration,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const mode = this.dataset.agentModeOption;
        if (mode && rects[mode]) {
          const { left, width } = rects[mode];
          return { left, width } as DOMRect;
        }
        return { left: 8, width: 220 } as DOMRect;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("moves the indicator from its previous position to the selected mode on the next frame", () => {
    const { container, rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const indicator = container.querySelector(
      "span[aria-hidden='true']",
    ) as HTMLSpanElement;

    expect(indicator.style.transform).toBe("translate3d(0px, 0, 0)");
    expect(indicator.style.width).toBe("40px");

    flushAnimationFrames(frames);
    expect(indicator.dataset.ready).toBe("true");
    expect(indicator.dataset.motion).toBe("on");

    rerender(<ModeSelector selectedMode="image" onChange={vi.fn()} />);

    expect(indicator.dataset.motion).toBe("off");
    expect(indicator.style.transform).toBe("translate3d(0px, 0, 0)");
    expect(indicator.style.width).toBe("40px");

    flushAnimationFrames(frames);
    expect(indicator.dataset.motion).toBe("on");
    expect(indicator.style.transform).toBe("translate3d(90px, 0, 0)");
    expect(indicator.style.width).toBe("56px");
  });
});
