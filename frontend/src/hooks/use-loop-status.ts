import { useState, useEffect, useRef } from "react";
import { useEventStore } from "../stores/event-store";
import { EventType } from "../types/aura-events";

export function useLoopStatus(currentAgentInstanceId?: string): {
  automatingProjectId: string | null;
  automatingAgentInstanceId: string | null;
} {
  const subscribe = useEventStore((s) => s.subscribe);
  const [automatingProjectId, setAutomatingProjectId] = useState<string | null>(null);
  const [automatingAgentInstanceId, setAutomatingAgentInstanceId] = useState<string | null>(null);
  const agentInstanceIdRef = useRef(currentAgentInstanceId);
  agentInstanceIdRef.current = currentAgentInstanceId;

  useEffect(() => {
    const clearAutomation = () => {
      setAutomatingProjectId(null);
      setAutomatingAgentInstanceId(null);
    };
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (e.project_id) {
          setAutomatingProjectId(e.project_id);
          setAutomatingAgentInstanceId(agentInstanceIdRef.current ?? null);
        }
      }),
      subscribe(EventType.LoopPaused, clearAutomation),
      subscribe(EventType.LoopStopped, clearAutomation),
      subscribe(EventType.LoopFinished, clearAutomation),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  return { automatingProjectId, automatingAgentInstanceId };
}
