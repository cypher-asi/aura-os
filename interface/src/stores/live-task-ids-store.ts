import { create } from "zustand";
import type { LoopStatusResponse } from "../shared/api/loop";

/**
 * Per-project set of task ids the server reports as currently streaming.
 *
 * Lives in a shared zustand store (rather than local React state inside
 * `useTaskListData` / `useMobileTasks`) so the Run-start HTTP response can
 * seed the "live" indicator immediately — before the `task_started` WS
 * event arrives — for both the desktop sidekick Tasks list and the mobile
 * task views. Without this shared state, pressing Run on a fresh or
 * interrupted task leaves the sidekick looking idle during the ramp-up
 * window between `POST /loop/start` and the first `task_started` event.
 */
interface LiveTaskIdsState {
  idsByProject: Record<string, Set<string>>;

  addLive: (projectId: string, taskId: string) => void;
  removeLive: (projectId: string, taskId: string) => void;
  clearProject: (projectId: string) => void;
  /**
   * Merge any `active_tasks` reported by `/loop/status` (or the response
   * from `/loop/start` / `/loop/resume`) into the per-project live set.
   * No-op when the response carries no `active_tasks`, so callers can
   * pass any `LoopStatusResponse` without pre-checking.
   */
  hydrateFromLoopStatus: (res: LoopStatusResponse, projectId: string) => void;
}

export const useLiveTaskIdsStore = create<LiveTaskIdsState>()((set) => ({
  idsByProject: {},

  addLive: (projectId, taskId) =>
    set((s) => {
      const current = s.idsByProject[projectId];
      if (current?.has(taskId)) return s;
      const next = new Set(current ?? []);
      next.add(taskId);
      return { idsByProject: { ...s.idsByProject, [projectId]: next } };
    }),

  removeLive: (projectId, taskId) =>
    set((s) => {
      const current = s.idsByProject[projectId];
      if (!current || !current.has(taskId)) return s;
      const next = new Set(current);
      next.delete(taskId);
      return { idsByProject: { ...s.idsByProject, [projectId]: next } };
    }),

  clearProject: (projectId) =>
    set((s) => {
      const current = s.idsByProject[projectId];
      if (!current || current.size === 0) return s;
      return { idsByProject: { ...s.idsByProject, [projectId]: new Set() } };
    }),

  hydrateFromLoopStatus: (res, projectId) =>
    set((s) => {
      const incoming = res.active_tasks;
      if (!incoming || incoming.length === 0) return s;
      const current = s.idsByProject[projectId];
      const next = new Set(current ?? []);
      let changed = false;
      for (const entry of incoming) {
        if (entry.task_id && !next.has(entry.task_id)) {
          next.add(entry.task_id);
          changed = true;
        }
      }
      return changed
        ? { idsByProject: { ...s.idsByProject, [projectId]: next } }
        : s;
    }),
}));

const EMPTY_SET: Set<string> = new Set();

/**
 * React hook: subscribe to the live task ids for a single project.
 * Returns a stable empty set when `projectId` is missing or the project
 * has no live tasks, so callers can safely use `Set` methods without
 * null checks. The returned set must be treated as immutable — mutate
 * the store via the exposed actions instead.
 */
export function useLiveTaskIdsForProject(
  projectId: string | undefined,
): Set<string> {
  return useLiveTaskIdsStore((s) => {
    if (!projectId) return EMPTY_SET;
    return s.idsByProject[projectId] ?? EMPTY_SET;
  });
}
