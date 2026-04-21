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
/*  This cache:                                                        */
/*    1. Returns the same in-flight promise to concurrent callers.     */
/*    2. Caches the outcome (`loaded` vs `empty`) for the session.     */
/*    3. Never retries on `empty` - a fresh run of the task is what    */
/*       clears the cache entry (`invalidateTaskOutputHydration`).     */
/*                                                                     */
/*  Error responses are treated like `empty` so that transient         */
/*  failures also stop looping; the user can force a refetch by        */
/*  calling `invalidateTaskOutputHydration(projectId, taskId)`.        */
/* ------------------------------------------------------------------ */

export type HydrationOutcome = "loaded" | "empty";
export type HydrationState = "idle" | "loading" | HydrationOutcome;

interface CacheEntry {
  state: HydrationState;
  promise?: Promise<HydrationOutcome>;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`;
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
  const key = cacheKey(projectId, taskId);
  const existing = cache.get(key);
  if (existing) {
    if (existing.state === "loaded" || existing.state === "empty") {
      return Promise.resolve(existing.state);
    }
    if (existing.state === "loading" && existing.promise) {
      return existing.promise;
    }
  }

  const promise = fetcher()
    .then((outcome) => {
      cache.set(key, { state: outcome });
      return outcome;
    })
    .catch(() => {
      cache.set(key, { state: "empty" });
      return "empty" as const;
    });

  cache.set(key, { state: "loading", promise });
  return promise;
}

/**
 * Force the next `hydrateTaskOutputOnce(projectId, taskId)` to re-fetch.
 * Call this when a task restarts so a previously "empty" run does not
 * sticky-cache a stale result.
 */
export function invalidateTaskOutputHydration(projectId: string, taskId: string): void {
  cache.delete(cacheKey(projectId, taskId));
}

/** Test-only: returns the cached state for inspection. */
export function peekHydrationState(projectId: string, taskId: string): HydrationState {
  return cache.get(cacheKey(projectId, taskId))?.state ?? "idle";
}

/** Test-only: reset the cache between tests. */
export function resetTaskOutputHydrationCache(): void {
  cache.clear();
}
