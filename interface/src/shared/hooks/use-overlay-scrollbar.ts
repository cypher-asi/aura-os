import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, PointerEventHandler, RefObject } from "react";

interface OverlayScrollbar {
  thumbStyle: CSSProperties;
  visible: boolean;
  onThumbPointerDown: PointerEventHandler;
}

const MIN_THUMB_HEIGHT = 18;

export function useOverlayScrollbar(
  containerRef: RefObject<HTMLElement | null>,
): OverlayScrollbar {
  const [thumbTop, setThumbTop] = useState(0);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [needsScroll, setNeedsScroll] = useState(false);

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const scrollable = scrollHeight > clientHeight;
    setNeedsScroll(scrollable);
    if (!scrollable) return;
    const ratio = clientHeight / scrollHeight;
    const height = Math.max(ratio * clientHeight, MIN_THUMB_HEIGHT);
    const maxTop = clientHeight - height;
    const top = maxTop * (scrollTop / (scrollHeight - clientHeight));
    setThumbTop(top);
    setThumbHeight(height);
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      update();
    };

    const onEnter = () => {
      update();
      setHovered(true);
    };

    const onLeave = () => {
      setHovered(false);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);

    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => update());
    ro?.observe(el);

    update();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      ro?.disconnect();
    };
  }, [containerRef, containerRef.current, update]);

  const onThumbPointerDown: PointerEventHandler = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = containerRef.current;
      if (!el) return;

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      setDragging(true);
      let lastY = e.clientY;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientY - lastY;
        lastY = ev.clientY;
        const { scrollHeight, clientHeight } = el;
        const scrollRatio = scrollHeight / clientHeight;
        el.scrollTop += delta * scrollRatio;
      };

      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        setDragging(false);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [containerRef],
  );

  const thumbStyle: CSSProperties = {
    top: thumbTop,
    height: thumbHeight,
  };

  return { thumbStyle, visible: needsScroll && (hovered || dragging), onThumbPointerDown };
}
