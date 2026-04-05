import { useCallback, useRef, useState } from "react";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SIZE = 4;

export function useSelectionMarquee() {
  const [rect, setRect] = useState<Rect | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const active = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    const container = e.currentTarget;
    const bounds = container.getBoundingClientRect();
    origin.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    active.current = true;
    container.setPointerCapture(e.pointerId);
    setRect(null);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!active.current || !origin.current) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const cx = Math.max(0, Math.min(e.clientX - bounds.left, bounds.width));
    const cy = Math.max(0, Math.min(e.clientY - bounds.top, bounds.height));
    const ox = origin.current.x;
    const oy = origin.current.y;

    const left = Math.min(ox, cx);
    const top = Math.min(oy, cy);
    const width = Math.abs(cx - ox);
    const height = Math.abs(cy - oy);

    if (width < MIN_SIZE && height < MIN_SIZE) return;
    setRect({ left, top, width, height });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!active.current) return;
    active.current = false;
    origin.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setRect(null);
  }, []);

  return {
    rect,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
