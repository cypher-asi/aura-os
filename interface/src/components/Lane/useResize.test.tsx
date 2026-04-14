import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { useResize } from "../../../../vendor/zui/src/lib/useResize";

vi.mock("../../../../vendor/zui/node_modules/react", async () => await import("react"));

describe("useResize", () => {
  it("uses the latest drag size when resize ends", () => {
    const onResizeEnd = vi.fn();
    const elementRef = { current: document.createElement("div") };
    const { result } = renderHook(() =>
      useResize({
        side: "left",
        minSize: 0,
        maxSize: 400,
        defaultSize: 240,
        elementRef,
        onResizeEnd,
      }),
    );

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => {},
        clientX: 200,
      } as unknown as Parameters<typeof result.current.handleMouseDown>[0]);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 260 }));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 320 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.size).toBe(360);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith(360);
  });
});
