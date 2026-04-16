import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { EventType, type AuraEvent } from "../types/aura-events";

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
  const connected = useEventStore((s) => s.connected);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopPaused, setLoopPaused] = useState(false);
  const [error, setError] = useState("");

  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  const fetchStatus = useCallback(() => {
    if (!projectId) return;
    api.getLoopStatus(projectId)
      .then((res) => {
        const active = (res.active_agent_instances?.length ?? 0) > 0;
        setLoopRunning(active);
        setLoopPaused(active && res.paused);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) fetchStatus();
    prevConnectedRef.current = connected;
  }, [connected, fetchStatus]);

  const isForProject = useCallback((e: AuraEvent) => {
    const pid = projectIdRef.current;
    return Boolean(pid && e.project_id === pid);
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (!isForProject(e)) return;
        setLoopRunning(true);
        setLoopPaused(false);
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (!isForProject(e)) return;
        setLoopPaused(true);
      }),
      subscribe(EventType.LoopResumed, (e) => {
        if (!isForProject(e)) return;
        setLoopPaused(false);
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (!isForProject(e)) return;
        setLoopRunning(false);
        setLoopPaused(false);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (!isForProject(e)) return;
        setLoopRunning(false);
        setLoopPaused(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, isForProject]);

  const handleStart = useCallback(async () => {
    if (!projectId) return;
    setError("");
    if (loopPaused) {
      try {
        await api.resumeLoop(projectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resume loop");
      }
      return;
    }
    try {
      await api.startLoop(projectId);
      setLoopRunning(true);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start loop");
    }
  }, [projectId, loopPaused]);

  const handlePause = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.pauseLoop(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause loop");
    }
  }, [projectId]);

  const handleStop = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.stopLoop(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop loop");
    }
  }, [projectId]);

  return { loopRunning, loopPaused, error, handleStart, handlePause, handleStop };
}
