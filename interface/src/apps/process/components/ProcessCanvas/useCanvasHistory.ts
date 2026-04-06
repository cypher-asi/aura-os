import { useCallback, useRef, useState } from "react";

export interface CanvasCommand {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 50;

export function useCanvasHistory() {
  const undoRef = useRef<CanvasCommand[]>([]);
  const redoRef = useRef<CanvasCommand[]>([]);
  const [, bump] = useState(0);

  const pushCommand = useCallback((cmd: CanvasCommand) => {
    undoRef.current.push(cmd);
    if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
    redoRef.current = [];
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(async () => {
    const cmd = undoRef.current.pop();
    if (!cmd) return;
    try {
      await cmd.undo();
    } catch (e) {
      console.error("Undo failed:", e);
    }
    redoRef.current.push(cmd);
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(async () => {
    const cmd = redoRef.current.pop();
    if (!cmd) return;
    try {
      await cmd.redo();
    } catch (e) {
      console.error("Redo failed:", e);
    }
    undoRef.current.push(cmd);
    bump((n) => n + 1);
  }, []);

  return {
    pushCommand,
    undo,
    redo,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
  };
}
