import { useState, useEffect, useRef } from "react";
import { useEventStore } from "../stores/event-store";
import { EventType, type AuraEvent } from "../types/aura-events";

export function useLoopStatus(currentAgentInstanceId?: string): {
  automatingProjectId: string | null;
  automatingAgentInstanceId: string | null;
} {
  const subscribe = useEventStore((s) => s.subscribe);
  const [automatingProjectId, setAutomatingProjectId] = useState<string | null>(null);
  const [automatingAgentInstanceId, setAutomatingAgentInstanceId] = useState<string | null>(null);
  const agentInstanceIdRef = useRef(currentAgentInstanceId);
  agentInstanceIdRef.current = currentAgentInstanceId;

  const automatingProjectIdRef = useRef<string | null>(null);
  const automatingAgentInstanceIdRef = useRef<string | null>(null);

  useEffect(() => {
    automatingProjectIdRef.current = automatingProjectId;
    automatingAgentInstanceIdRef.current = automatingAgentInstanceId;
  }, [automatingProjectId, automatingAgentInstanceId]);

  useEffect(() => {
    const matchesTracked = (e: AuraEvent) => {
      const ep = e.project_id;
      if (ep && automatingProjectIdRef.current && ep !== automatingProjectIdRef.current) {
        return false;
      }
      const aid = e.agent_id;
      const tracked = automatingAgentInstanceIdRef.current;
      if (aid && tracked && aid !== tracked) return false;
      return true;
    };

    const clearAutomation = () => {
      automatingProjectIdRef.current = null;
      automatingAgentInstanceIdRef.current = null;
      setAutomatingProjectId(null);
      setAutomatingAgentInstanceId(null);
    };

    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (e.project_id) {
          const aid = e.agent_id ?? agentInstanceIdRef.current ?? null;
          automatingProjectIdRef.current = e.project_id;
          automatingAgentInstanceIdRef.current = aid;
          setAutomatingProjectId(e.project_id);
          setAutomatingAgentInstanceId(aid);
        }
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (matchesTracked(e)) clearAutomation();
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (matchesTracked(e)) clearAutomation();
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (matchesTracked(e)) clearAutomation();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  return { automatingProjectId, automatingAgentInstanceId };
}
