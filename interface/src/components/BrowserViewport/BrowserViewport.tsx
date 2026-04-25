import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { BrowserWorkerInMsg } from "../../workers/browser-frame-worker";
import type { BrowserClientMsg } from "../../shared/api/browser";
import {
  BLOCKED_KEY_COMBOS,
  buildMouseMsg,
  buildWheelMsg,
  cdpModifierMask,
  cdpMouseButton,
  isPrintableKey,
  toViewportCoords,
  VK_BY_CODE,
} from "../../lib/browser-input";
import styles from "./BrowserViewport.module.css";

export interface BrowserViewportProps {
  /** Optional placeholder text shown before the first frame arrives. */
  placeholder?: string;
  /**
   * Called exactly once when the underlying worker is ready and has taken
   * ownership of the offscreen canvas. The parent uses this to learn the
   * port it can post frame messages to.
   */
  onWorkerReady?: (worker: Worker) => void;
  width: number;
  height: number;
  /**
   * Send a `ClientMsg` over the browser WS. Wired up by the parent; the
   * viewport is otherwise input-agnostic.
   */
  onClientMsg?: (msg: BrowserClientMsg) => void;
  /**
   * Optional overlay rendered above the screencast canvas. The viewport
   * stays input-agnostic; overlays opt into their own pointer handling.
   * Typical uses are navigation-error panels and blocking modals.
   */
  overlay?: ReactNode;
}

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(
    new URL("../../workers/browser-frame-worker.ts", import.meta.url),
    { type: "module" },
  );
}

export function BrowserViewport({
  placeholder,
  onWorkerReady,
  width,
  height,
  onClientMsg,
  overlay,
}: BrowserViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // Input bookkeeping refs - kept off React state to avoid rerenders on
  // every mouse move.
  const onMsgRef = useRef(onClientMsg);
  const pendingMoveRef = useRef<BrowserClientMsg | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const heldButtonRef = useRef<"left" | "middle" | "right" | null>(null);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(null);

  useEffect(() => {
    onMsgRef.current = onClientMsg;
  }, [onClientMsg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.transferControlToOffscreen !== "function") {
      return;
    }
    const worker = createWorker();
    if (!worker) return;
    workerRef.current = worker;
    const offscreen = canvas.transferControlToOffscreen();
    const initMsg: BrowserWorkerInMsg = { type: "init", canvas: offscreen };
    worker.postMessage(initMsg, [offscreen]);
    onWorkerReady?.(worker);
    return () => {
      const dispose: BrowserWorkerInMsg = { type: "dispose" };
      worker.postMessage(dispose);
      worker.terminate();
      workerRef.current = null;
    };
  }, [onWorkerReady]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const resize: BrowserWorkerInMsg = { type: "resize", width, height };
    worker.postMessage(resize);
  }, [width, height]);

  // --- Input handlers -----------------------------------------------------

  const send = useCallback((msg: BrowserClientMsg) => {
    onMsgRef.current?.(msg);
  }, []);

  const flushPendingMove = useCallback(() => {
    rafIdRef.current = null;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (pending) send(pending);
  }, [send]);

  const queueMouseMove = useCallback(
    (msg: BrowserClientMsg) => {
      pendingMoveRef.current = msg;
      if (rafIdRef.current !== null) return;
      rafIdRef.current =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(flushPendingMove)
          : (globalThis.setTimeout(flushPendingMove, 16) as unknown as number);
    },
    [flushPendingMove],
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = null;
    };
  }, []);

  const rectFromCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getBoundingClientRect();
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      const coords = toViewportCoords(e, rect);
      const held = heldButtonRef.current;
      queueMouseMove(
        buildMouseMsg("move", coords, {
          button: held ?? "none",
          modifiers: cdpModifierMask(e.nativeEvent),
        }),
      );
    },
    [queueMouseMove, rectFromCanvas],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      e.preventDefault();
      canvasRef.current?.focus();
      const coords = toViewportCoords(e, rect);
      const button = cdpMouseButton(e.button);
      if (button === "left" || button === "middle" || button === "right") {
        heldButtonRef.current = button;
      }
      const now = performance.now();
      const last = lastClickRef.current;
      const clickCount =
        last &&
        now - last.at < 400 &&
        Math.abs(last.x - coords.x) < 6 &&
        Math.abs(last.y - coords.y) < 6
          ? 2
          : 1;
      lastClickRef.current = { at: now, x: coords.x, y: coords.y };
      send(
        buildMouseMsg("down", coords, {
          button,
          modifiers: cdpModifierMask(e.nativeEvent),
          clickCount,
        }),
      );
    },
    [rectFromCanvas, send],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      e.preventDefault();
      const coords = toViewportCoords(e, rect);
      heldButtonRef.current = null;
      send(
        buildMouseMsg("up", coords, {
          button: cdpMouseButton(e.button),
          modifiers: cdpModifierMask(e.nativeEvent),
          clickCount: 1,
        }),
      );
    },
    [rectFromCanvas, send],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Swallow the host context menu so the remote page sees the
      // mousedown/up for the right button instead.
      e.preventDefault();
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      e.preventDefault();
      const coords = toViewportCoords(e, rect);
      send(buildWheelMsg(coords, e.deltaX, e.deltaY));
    },
    [rectFromCanvas, send],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>, kind: "down" | "up") => {
      if (BLOCKED_KEY_COMBOS.some((pred) => pred(e.nativeEvent))) return;
      e.preventDefault();
      const text =
        kind === "down" && isPrintableKey(e.nativeEvent) ? e.key : undefined;
      const vk = VK_BY_CODE[e.code];
      const msg: BrowserClientMsg = {
        type: "key",
        event: kind,
        key: e.key,
        code: e.code,
        text: text ?? null,
        modifiers: cdpModifierMask(e.nativeEvent),
        ...(vk !== undefined ? { windows_virtual_key_code: vk } : {}),
      };
      send(msg);
    },
    [send],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => handleKey(e, "down"),
    [handleKey],
  );
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => handleKey(e, "up"),
    [handleKey],
  );

  return (
    <div className={styles.root}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={width}
        height={height}
        aria-label="Browser viewport"
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />
      {placeholder && <div className={styles.placeholder}>{placeholder}</div>}
      {overlay}
    </div>
  );
}
