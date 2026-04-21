import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { EventType, type AuraEvent } from "../types/aura-events";

export function useLoopStatus(
  currentAgentInstanceId?: string,
  currentProjectId?: string,
): {
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

  // Hydrate from HTTP on mount. Without this, after a page refresh
  // the sidebar agent spinner does not light up until a fresh
  // `LoopStarted` event is received (which only happens if the user
  // starts a new loop), even though the backend's automaton registry
  // still has the previous loop running. `useAutomationStatus` and
  // `useLoopActive` already do this for the top sidekick nav; this
  // keeps the left-nav indicator in step.
  useEffect(() => {
    if (!currentProjectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.getLoopStatus(currentProjectId);
        if (cancelled) return;
        const agents = res.active_agent_instances ?? [];
        if (agents.length === 0) return;
        // Prefer the agent that matches the current route (if any);
        // otherwise just pick the first entry so at least some
        // indicator shows. The WS event path will refine this as new
        // events arrive.
        const preferred =
          (agentInstanceIdRef.current && agents.includes(agentInstanceIdRef.current)
            ? agentInstanceIdRef.current
            : agents[0]) ?? null;
        automatingProjectIdRef.current = currentProjectId;
        automatingAgentInstanceIdRef.current = preferred;
        setAutomatingProjectId(currentProjectId);
        setAutomatingAgentInstanceId(preferred);
      } catch {
        // Best-effort hydration; fall back to the WS event path.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  return { automatingProjectId, automatingAgentInstanceId };
}
