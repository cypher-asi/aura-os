import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSidekickItemContextMenu } from "./useSidekickItemContextMenu";

function makeEvent(targetId: string, clientX = 10, clientY = 20): ReactMouseEvent {
  const button = document.createElement("button");
  button.id = targetId;
  document.body.appendChild(button);
  const preventDefault = vi.fn();
  return {
    target: button,
    clientX,
    clientY,
    preventDefault,
  } as unknown as ReactMouseEvent;
}

describe("useSidekickItemContextMenu", () => {
  it("opens menu when contextmenu target resolves to an item", () => {
    const resolveItem = (id: string) => (id === "node-1" ? { id } : null);
    const { result } = renderHook(() => useSidekickItemContextMenu({ resolveItem }));

    const event = makeEvent("node-1", 111, 222);
    act(() => {
      result.current.handleContextMenu(event);
    });

    expect(result.current.menu).toEqual({ x: 111, y: 222, item: { id: "node-1" } });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not open menu when target cannot be resolved", () => {
    const resolveItem = () => null;
    const { result } = renderHook(() => useSidekickItemContextMenu({ resolveItem }));

    const event = makeEvent("node-unknown");
    act(() => {
      result.current.handleContextMenu(event);
    });

    expect(result.current.menu).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("closeMenu clears state", () => {
    const resolveItem = (id: string) => ({ id });
    const { result } = renderHook(() => useSidekickItemContextMenu({ resolveItem }));

    act(() => result.current.handleContextMenu(makeEvent("node-x")));
    expect(result.current.menu).not.toBeNull();
    act(() => result.current.closeMenu());
    expect(result.current.menu).toBeNull();
  });

  it("closes menu on Escape key", () => {
    const resolveItem = (id: string) => ({ id });
    const { result } = renderHook(() => useSidekickItemContextMenu({ resolveItem }));

    act(() => result.current.handleContextMenu(makeEvent("node-esc")));
    expect(result.current.menu).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.menu).toBeNull();
  });
});
