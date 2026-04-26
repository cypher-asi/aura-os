import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserViewport } from "./BrowserViewport";

describe("BrowserViewport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards wheel deltas without inverting them", () => {
    const onClientMsg = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });

    render(<BrowserViewport width={400} height={300} onClientMsg={onClientMsg} />);

    fireEvent.wheel(screen.getByLabelText("Browser viewport"), {
      clientX: 120,
      clientY: 80,
      deltaX: 15,
      deltaY: 40,
    });

    expect(onClientMsg).toHaveBeenCalledWith({
      type: "wheel",
      x: 120,
      y: 80,
      delta_x: 15,
      delta_y: 40,
    });
  });
});
