import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingRow } from "./ThinkingRow";

describe("ThinkingRow", () => {
  let rafCallbacks: Array<FrameRequestCallback>;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelRafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
    cancelRafSpy = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((id: number) => {
        rafCallbacks[id - 1] = () => {};
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
  });

  const flushNextRaf = () => {
    const next = rafCallbacks.shift();
    if (next) {
      act(() => {
        next(performance.now());
      });
    }
  };

  it("renders thinking content expanded when defaultExpanded is true, then collapses after two RAFs", () => {
    const { queryByText, getByText } = render(
      <ThinkingRow
        text="Considering options"
        isStreaming={false}
        defaultExpanded
      />,
    );

    expect(getByText("Considering options")).toBeInTheDocument();

    flushNextRaf();
    expect(queryByText("Considering options")).toBeInTheDocument();

    flushNextRaf();
    expect(queryByText("Considering options")).not.toBeInTheDocument();
  });

  it("renders collapsed from frame 0 for historical (non-streaming, no default) messages", () => {
    const { queryByText } = render(
      <ThinkingRow text="Considering options" isStreaming={false} />,
    );
    expect(queryByText("Considering options")).not.toBeInTheDocument();
  });

  it("stays expanded while streaming", () => {
    const { getByText } = render(
      <ThinkingRow text="Considering options" isStreaming />,
    );
    expect(getByText("Considering options")).toBeInTheDocument();

    flushNextRaf();
    flushNextRaf();
    expect(getByText("Considering options")).toBeInTheDocument();
  });
});
