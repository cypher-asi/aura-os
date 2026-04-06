import { useState, useEffect } from "react";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";

interface TaskStatusState {
  liveStatus: string | null;
  liveSessionId: string | null;
  failReason: string | null;
  setLiveStatus: (status: string | null) => void;
  setFailReason: (reason: string | null) => void;
}

export function useTaskStatus(taskId: string, canonicalStatus?: string): TaskStatusState {
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
      subscribe(EventType.TaskStarted, (e) => {
        if (e.content.task_id !== taskId) return;
        setLiveStatus("in_progress");
        if (e.session_id) setLiveSessionId(e.session_id);
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.content.task_id !== taskId) return;
        setLiveStatus("done");
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id !== taskId) return;
        setLiveStatus("failed");
        if (e.content.reason) setFailReason(e.content.reason);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [taskId, subscribe]);

  useEffect(() => {
    if ((canonicalStatus === "done" || canonicalStatus === "failed") && liveStatus === "in_progress") {
      setLiveStatus(canonicalStatus);
    }
  }, [canonicalStatus, liveStatus]);

  return { liveStatus, liveSessionId, failReason, setLiveStatus, setFailReason };
}
