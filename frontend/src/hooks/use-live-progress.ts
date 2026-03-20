import { useEffect, useState, useCallback } from "react";
import type { ProjectProgress, ProjectId } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";

export function useLiveProgress(projectId: ProjectId): ProjectProgress | null {
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const { subscribe } = useEventContext();

  const fetchProgress = useCallback(() => {
    api.getProgress(projectId).then(setProgress).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    fetchProgress();
    const interval = setInterval(fetchProgress, 30000);
    return () => clearInterval(interval);
  }, [fetchProgress]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_completed", () => {
        setProgress((prev) => {
          if (!prev) return prev;
          const done = prev.done_tasks + 1;
          const inProg = Math.max(0, prev.in_progress_tasks - 1);
          const total = prev.total_tasks;
          return {
            ...prev,
            done_tasks: done,
            in_progress_tasks: inProg,
            completion_percentage: total > 0 ? (done / total) * 100 : 0,
          };
        });
      }),
      subscribe("task_failed", () => {
        setProgress((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            failed_tasks: prev.failed_tasks + 1,
            in_progress_tasks: Math.max(0, prev.in_progress_tasks - 1),
          };
        });
      }),
      subscribe("task_started", () => {
        setProgress((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            in_progress_tasks: prev.in_progress_tasks + 1,
            ready_tasks: Math.max(0, prev.ready_tasks - 1),
          };
        });
      }),
      subscribe("task_became_ready", () => {
        setProgress((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            ready_tasks: prev.ready_tasks + 1,
            pending_tasks: Math.max(0, prev.pending_tasks - 1),
          };
        });
      }),
      subscribe("follow_up_task_created", () => {
        setProgress((prev) => {
          if (!prev) return prev;
          const total = prev.total_tasks + 1;
          return {
            ...prev,
            total_tasks: total,
            pending_tasks: prev.pending_tasks + 1,
            completion_percentage: total > 0 ? (prev.done_tasks / total) * 100 : 0,
          };
        });
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  return progress;
}
