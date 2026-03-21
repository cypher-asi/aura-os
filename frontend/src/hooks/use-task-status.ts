import { useState, useEffect } from "react";
import { useEventStore } from "../stores/event-store";

interface TaskStatusState {
  liveStatus: string | null;
  liveSessionId: string | null;
  failReason: string | null;
  setLiveStatus: (status: string | null) => void;
  setFailReason: (reason: string | null) => void;
}

/**
 * Subscribes to task lifecycle events and tracks the live status, session id,
 * and failure reason for a given task. Resets when the taskId changes.
 */
export function useTaskStatus(taskId: string): TaskStatusState {
  const subscribe = useEventStore((s) => s.subscribe);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);

  useEffect(() => {
    setLiveStatus(null);
    setLiveSessionId(null);
    setFailReason(null);
  }, [taskId]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id !== taskId) return;
        setLiveStatus("in_progress");
        if (e.session_id) setLiveSessionId(e.session_id);
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id !== taskId) return;
        setLiveStatus("done");
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id !== taskId) return;
        setLiveStatus("failed");
        if (e.reason) setFailReason(e.reason);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [taskId, subscribe]);

  return { liveStatus, liveSessionId, failReason, setLiveStatus, setFailReason };
}
