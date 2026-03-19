import { useState, useEffect, useCallback } from "react";
import type { ProjectId } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";

/**
 * Returns whether the automation loop has active agents for the project.
 * When false, tasks with status "in_progress" in storage should be shown as
 * stale (e.g. "ready") so we don't show spinners after restart or loop error.
 */
export function useLoopActive(projectId: ProjectId | undefined): boolean {
  const { subscribe } = useEventContext();
  const [loopActive, setLoopActive] = useState(false);

  const fetchStatus = useCallback(() => {
    if (!projectId) {
      setLoopActive(false);
      return;
    }
    api
      .getLoopStatus(projectId)
      .then((res) => {
        setLoopActive(
          !!(res.active_agent_instances && res.active_agent_instances.length > 0),
        );
      })
      .catch(() => setLoopActive(false));
  }, [projectId]);

  useEffect(() => {
    fetchStatus();
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
