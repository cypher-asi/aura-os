import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserViewport } from "./BrowserViewport";

describe("BrowserViewport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards wheel deltas without inverting them", () => {
    const onClientMsg = vi.fn();
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
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

    render(
      <BrowserViewport width={400} height={300} onClientMsg={onClientMsg} />,
    );

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

  it("selects an element instead of clicking the page in Design mode", () => {
    const onClientMsg = vi.fn();
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 150,
      width: 200,
      height: 150,
      toJSON: () => ({}),
    });

    render(
      <BrowserViewport
        width={400}
        height={300}
        designMode
        onClientMsg={onClientMsg}
      />,
    );

    fireEvent.mouseDown(screen.getByLabelText("Browser viewport"), {
      clientX: 100,
      clientY: 75,
      button: 0,
    });

    expect(onClientMsg).toHaveBeenCalledWith({
      type: "inspect",
      request_id: 1,
      kind: "select",
      x: 200,
      y: 150,
    });
    expect(onClientMsg).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "mouse" }),
    );
  });
});
