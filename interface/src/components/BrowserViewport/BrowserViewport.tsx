import { useEffect, useRef } from "react";
import type { BrowserWorkerInMsg } from "../../workers/browser-frame-worker";
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
}: BrowserViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);

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

  return (
    <div className={styles.root}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={width}
        height={height}
        aria-label="Browser viewport"
      />
      {placeholder && <div className={styles.placeholder}>{placeholder}</div>}
    </div>
  );
}
