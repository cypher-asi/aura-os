/* ------------------------------------------------------------------ */
/*  Task output hydration cache                                        */
/*                                                                     */
/*  Deduplicates GET /api/projects/:pid/tasks/:tid/output requests     */
/*  across all rendered rows for a given session.                      */
/*                                                                     */
/*  Observed problem: `useHydrateCompletedOutput` (one per row) fires  */
/*  on mount and then blindly retries after 2 s when the server        */
/*  responds with empty output. With 20 terminal rows on a reload,     */
/*  this produces two waves of 20 parallel GETs against a server that  */
/*  cannot find the task's session_id, which is pure noise.            */
/*                                                                     */
/*  This cache uses React Query so concurrent callers share the same    */
/*  in-flight fetch and terminal outcomes are remembered for the        */
/*  session. A fresh run clears the query entry via                     */
/*  `invalidateTaskOutputHydration`.                                    */
/*                                                                     */
/*  Error responses are treated like `empty` so that transient         */
/*  failures also stop looping; the user can force a refetch by        */
/*  calling `invalidateTaskOutputHydration(projectId, taskId)`.        */
/* ------------------------------------------------------------------ */

import { queryClient } from "../shared/lib/query-client";

export type HydrationOutcome = "loaded" | "empty";
export type HydrationState = "idle" | "loading" | HydrationOutcome;

const TASK_OUTPUT_HYDRATION_STALE_TIME_MS = Infinity;
const TASK_OUTPUT_HYDRATION_GC_TIME_MS = Infinity;

function cacheKey(projectId: string, taskId: string) {
  return ["task-output-hydration", projectId, taskId] as const;
}

/**
 * Run the provided fetcher once per (projectId, taskId) per session.
 * Concurrent calls receive the same in-flight promise. Terminal
 * outcomes are remembered: subsequent calls short-circuit to the
 * cached result instead of re-hitting the server.
 */
export function hydrateTaskOutputOnce(
  projectId: string,
  taskId: string,
  fetcher: () => Promise<HydrationOutcome>,
): Promise<HydrationOutcome> {
  return queryClient.fetchQuery({
    queryKey: cacheKey(projectId, taskId),
    queryFn: async () => {
      try {
        return await fetcher();
      } catch {
        return "empty" as const;
      }
    },
    retry: false,
    staleTime: TASK_OUTPUT_HYDRATION_STALE_TIME_MS,
    gcTime: TASK_OUTPUT_HYDRATION_GC_TIME_MS,
  });
}

/**
 * Force the next `hydrateTaskOutputOnce(projectId, taskId)` to re-fetch.
 * Call this when a task restarts so a previously "empty" run does not
 * sticky-cache a stale result.
 */
export function invalidateTaskOutputHydration(projectId: string, taskId: string): void {
  queryClient.removeQueries({ queryKey: cacheKey(projectId, taskId), exact: true });
}

/** Test-only: returns the cached state for inspection. */
export function peekHydrationState(projectId: string, taskId: string): HydrationState {
  const queryState = queryClient.getQueryState<HydrationOutcome>(
    cacheKey(projectId, taskId),
  );
  if (!queryState) return "idle";
  if (queryState.data === "loaded" || queryState.data === "empty") {
    return queryState.data;
  }
  return queryState.fetchStatus === "fetching" ? "loading" : "idle";
}

/** Test-only: reset the cache between tests. */
export function resetTaskOutputHydrationCache(): void {
  queryClient.removeQueries({ queryKey: ["task-output-hydration"] });
}
