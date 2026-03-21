import { useState, useEffect, useRef } from "react";
import { useEventStore } from "../stores/event-store";

/**
 * Tracks which project/agent instance is currently automating via loop events.
 * Provides a global view of loop status, unlike useLoopActive which is per-project.
 */
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
      subscribe("loop_started", (e) => {
        if (e.project_id) {
          setAutomatingProjectId(e.project_id);
          setAutomatingAgentInstanceId(agentInstanceIdRef.current ?? null);
        }
      }),
      subscribe("loop_paused", clearAutomation),
      subscribe("loop_stopped", clearAutomation),
      subscribe("loop_finished", clearAutomation),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  return { automatingProjectId, automatingAgentInstanceId };
}
