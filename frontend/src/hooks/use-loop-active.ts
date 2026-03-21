import { useState, useEffect, useCallback } from "react";
import type { ProjectId } from "../types";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store";

/**
 * Returns whether the automation loop has active agents for the project.
 * When false, tasks with status "in_progress" in storage should be shown as
 * stale (e.g. "ready") so we don't show spinners after restart or loop error.
 */
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
    const isForProject = (e: { project_id?: string }) =>
      e.project_id === projectId;
    const unsubs = [
      subscribe("loop_started", (e) => {
        if (isForProject(e)) setLoopActive(true);
      }),
      subscribe("loop_stopped", (e) => {
        if (isForProject(e)) setLoopActive(false);
      }),
      subscribe("loop_paused", (e) => {
        if (isForProject(e)) setLoopActive(true); // Paused still has an agent
      }),
      subscribe("loop_finished", (e) => {
        if (isForProject(e)) setLoopActive(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe]);

  return loopActive;
}
