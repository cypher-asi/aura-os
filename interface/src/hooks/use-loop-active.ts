import { useState, useEffect, useCallback } from "react";
import type { ProjectId } from "../types";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store";
import { EventType } from "../types/aura-events";

export function useLoopActive(projectId: ProjectId | undefined): boolean {
  const subscribe = useEventStore((s) => s.subscribe);
  const [loopActive, setLoopActive] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!projectId) {
      return false;
    }

    try {
      const res = await api.getLoopStatus(projectId);
      return !!(res.active_agent_instances && res.active_agent_instances.length > 0);
    } catch {
      return false;
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    void fetchStatus().then((nextLoopActive) => {
      if (!cancelled) {
        setLoopActive(nextLoopActive);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (!projectId) return;
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (e.project_id === projectId) setLoopActive(true);
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (e.project_id === projectId) setLoopActive(false);
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (e.project_id === projectId) setLoopActive(true);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (e.project_id === projectId) setLoopActive(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe]);

  return loopActive;
}
