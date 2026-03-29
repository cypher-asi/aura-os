import { renderHook } from "@testing-library/react";
import { useClickOutside } from "./use-click-outside";

function makeRef(el: HTMLElement | null = null): React.RefObject<HTMLElement | null> {
  return { current: el };
}

describe("useClickOutside", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("calls onClose when clicking outside the ref element", () => {
    const onClose = vi.fn();
    const inner = document.createElement("div");
    container.appendChild(inner);
    const ref = makeRef(inner);

    renderHook(() => useClickOutside(ref, onClose, true));

    const outside = new MouseEvent("mousedown", { bubbles: true });
    document.body.dispatchEvent(outside);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking inside the ref element", () => {
    const onClose = vi.fn();
    const inner = document.createElement("div");
    container.appendChild(inner);
    const ref = makeRef(inner);

    renderHook(() => useClickOutside(ref, onClose, true));

    const inside = new MouseEvent("mousedown", { bubbles: true });
    inner.dispatchEvent(inside);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not attach listener when isActive is false", () => {
    const onClose = vi.fn();
    const inner = document.createElement("div");
    container.appendChild(inner);
    const ref = makeRef(inner);

    renderHook(() => useClickOutside(ref, onClose, false));

    const outside = new MouseEvent("mousedown", { bubbles: true });
    document.body.dispatchEvent(outside);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes listener on unmount", () => {
    const onClose = vi.fn();
    const inner = document.createElement("div");
    container.appendChild(inner);
    const ref = makeRef(inner);

    const { unmount } = renderHook(() => useClickOutside(ref, onClose, true));
    unmount();

    const outside = new MouseEvent("mousedown", { bubbles: true });
    document.body.dispatchEvent(outside);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("works with an array of refs", () => {
    const onClose = vi.fn();
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    container.appendChild(el1);
    container.appendChild(el2);

    const refs = [makeRef(el1), makeRef(el2)];
    renderHook(() => useClickOutside(refs, onClose, true));

    el1.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    el2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
