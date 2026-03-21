import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store";

interface LoopControlResult {
  loopRunning: boolean;
  loopPaused: boolean;
  error: string;
  handleStart: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleStop: () => Promise<void>;
}

export function useLoopControl(projectId: string | undefined): LoopControlResult {
  const subscribe = useEventStore((s) => s.subscribe);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopPaused, setLoopPaused] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubs = [
      subscribe("loop_started", () => { setLoopRunning(true); setLoopPaused(false); }),
      subscribe("loop_paused", () => { setLoopPaused(true); }),
      subscribe("loop_stopped", () => { setLoopRunning(false); setLoopPaused(false); }),
      subscribe("loop_finished", () => { setLoopRunning(false); setLoopPaused(false); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  const handleStart = useCallback(async () => {
    if (!projectId) return;
    setError("");
    try {
      await api.startLoop(projectId);
      setLoopRunning(true);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start loop");
    }
  }, [projectId]);

  const handlePause = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.pauseLoop(projectId);
      setLoopPaused(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause loop");
    }
  }, [projectId]);

  const handleStop = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.stopLoop(projectId);
      setLoopRunning(false);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop loop");
    }
  }, [projectId]);

  return { loopRunning, loopPaused, error, handleStart, handlePause, handleStop };
}
