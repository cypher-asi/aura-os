import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BrowserWorkerInMsg } from "../../../../workers/browser-frame-worker";
import type {
  BrowserClientMsg,
  DesignElement,
} from "../../../../shared/api/browser";
import {
  BLOCKED_KEY_COMBOS,
  buildMouseMsg,
  buildWheelMsg,
  cdpModifierMask,
  cdpMouseButton,
  isPrintableKey,
  toViewportCoords,
  VK_BY_CODE,
} from "../../../../lib/browser-input";
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
  /** Select elements instead of interacting with the remote page. */
  designMode?: boolean;
  /** Live element under the Design-mode pointer. */
  hoveredElement?: DesignElement | null;
  /** Element pinned by a Design-mode click. */
  selectedElement?: DesignElement | null;
  /** Adds device-stage framing for fixed responsive presets. */
  deviceFrame?: boolean;
}

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(
    new URL("../../../../workers/browser-frame-worker.ts", import.meta.url),
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
  designMode = false,
  hoveredElement,
  selectedElement,
  deviceFrame = false,
}: BrowserViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // Input bookkeeping refs - kept off React state to avoid rerenders on
  // every mouse move.
  const onMsgRef = useRef(onClientMsg);
  const pendingMoveRef = useRef<BrowserClientMsg | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const heldButtonRef = useRef<"left" | "middle" | "right" | null>(null);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(
    null,
  );
  const inspectRequestRef = useRef(0);
  const pendingInspectRef = useRef<{ x: number; y: number } | null>(null);
  const inspectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [availableSize, setAvailableSize] = useState({ width, height });

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

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextWidth = Math.max(1, entry.contentRect.width);
      const nextHeight = Math.max(1, entry.contentRect.height);
      setAvailableSize({ width: nextWidth, height: nextHeight });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (inspectTimerRef.current !== null)
        clearTimeout(inspectTimerRef.current);
      inspectTimerRef.current = null;
    };
  }, []);

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
      if (
        rafIdRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
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

  const viewportCoords = useCallback(
    (event: { clientX: number; clientY: number }, rect: DOMRect) =>
      toViewportCoords(event, rect, { width, height }),
    [height, width],
  );

  const sendInspection = useCallback(
    (kind: "hover" | "select", coords: { x: number; y: number }) => {
      inspectRequestRef.current += 1;
      send({
        type: "inspect",
        request_id: inspectRequestRef.current,
        kind,
        x: coords.x,
        y: coords.y,
      });
    },
    [send],
  );

  const queueInspection = useCallback(
    (coords: { x: number; y: number }) => {
      pendingInspectRef.current = coords;
      if (inspectTimerRef.current !== null) return;
      inspectTimerRef.current = setTimeout(() => {
        inspectTimerRef.current = null;
        const pending = pendingInspectRef.current;
        pendingInspectRef.current = null;
        if (pending) sendInspection("hover", pending);
      }, 60);
    },
    [sendInspection],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      const coords = viewportCoords(e, rect);
      if (designMode) {
        queueInspection(coords);
        return;
      }
      const held = heldButtonRef.current;
      queueMouseMove(
        buildMouseMsg("move", coords, {
          button: held ?? "none",
          modifiers: cdpModifierMask(e.nativeEvent),
        }),
      );
    },
    [
      designMode,
      queueInspection,
      queueMouseMove,
      rectFromCanvas,
      viewportCoords,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      e.preventDefault();
      canvasRef.current?.focus();
      const coords = viewportCoords(e, rect);
      if (designMode) {
        pendingInspectRef.current = null;
        sendInspection("select", coords);
        return;
      }
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
    [designMode, rectFromCanvas, send, sendInspection, viewportCoords],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = rectFromCanvas();
      if (!rect) return;
      e.preventDefault();
      if (designMode) return;
      const coords = viewportCoords(e, rect);
      heldButtonRef.current = null;
      send(
        buildMouseMsg("up", coords, {
          button: cdpMouseButton(e.button),
          modifiers: cdpModifierMask(e.nativeEvent),
          clickCount: 1,
        }),
      );
    },
    [designMode, rectFromCanvas, send, viewportCoords],
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
      const coords = viewportCoords(e, rect);
      send(buildWheelMsg(coords, e.deltaX, e.deltaY));
    },
    [rectFromCanvas, send, viewportCoords],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>, kind: "down" | "up") => {
      if (designMode || BLOCKED_KEY_COMBOS.some((pred) => pred(e.nativeEvent)))
        return;
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
    [designMode, send],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => handleKey(e, "down"),
    [handleKey],
  );
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => handleKey(e, "up"),
    [handleKey],
  );

  const scale = useMemo(() => {
    if (!deviceFrame) return 1;
    return Math.max(
      0.05,
      Math.min(
        1,
        (availableSize.width - 24) / width,
        (availableSize.height - 24) / height,
      ),
    );
  }, [availableSize.height, availableSize.width, deviceFrame, height, width]);
  const highlightedElement = selectedElement ?? hoveredElement ?? null;
  const highlightKind = selectedElement ? "selected" : "hover";

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-mode={designMode ? "design" : "preview"}
    >
      <div
        className={deviceFrame ? styles.deviceStage : styles.fitStage}
        style={
          deviceFrame
            ? { width: width * scale, height: height * scale }
            : undefined
        }
      >
        <div
          className={styles.surface}
          style={
            deviceFrame
              ? { width, height, transform: `scale(${scale})` }
              : { width: "100%", height: "100%" }
          }
        >
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
          {designMode && highlightedElement ? (
            <div
              className={styles.elementHighlight}
              data-kind={highlightKind}
              style={{
                left: highlightedElement.bounds.x,
                top: highlightedElement.bounds.y,
                width: highlightedElement.bounds.width,
                height: highlightedElement.bounds.height,
              }}
              aria-hidden="true"
            >
              <span>{`<${highlightedElement.tag_name}>`}</span>
            </div>
          ) : null}
          {placeholder && (
            <div className={styles.placeholder}>{placeholder}</div>
          )}
        </div>
      </div>
      {overlay}
    </div>
  );
}
