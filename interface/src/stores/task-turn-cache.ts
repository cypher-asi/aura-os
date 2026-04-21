import type { DisplaySessionEvent } from "../types/stream";

/* ------------------------------------------------------------------ */
/*  Task turn cache                                                    */
/*                                                                     */
/*  Persists the structured turn history (events[] with timeline,      */
/*  toolCalls and thinking text) for a finalized task so the Run       */
/*  panel and sidekick overlay can rehydrate a rich post-completion    */
/*  view even after the in-memory stream store has been pruned or the  */
/*  page has been reloaded.                                            */
/*                                                                     */
/*  This is complementary to `task-output-cache.ts` which stores only  */
/*  the concatenated TextDelta text. Both are read by the unified      */
/*  `useTaskOutputView` hook so consumers do not have to chase         */
/*  fallback chains manually.                                          */
/* ------------------------------------------------------------------ */

interface PersistedTaskTurns {
  taskId: string;
  projectId?: string;
  events: DisplaySessionEvent[];
  updatedAt: number;
}

const TASK_TURN_CACHE_KEY = "aura-task-turns-v1";
const TASK_TURN_CACHE_MAX_ENTRIES = 60;
const TASK_TURN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Per-entry cap to keep localStorage usage sane. The assistant turn
// events can include very large tool results (e.g. read_file dumps)
// so we truncate anything we cannot serialize within the budget.
const TASK_TURN_MAX_SERIALIZED_BYTES = 256 * 1024;

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined") {
      const g = globalThis as unknown as { localStorage?: Storage };
      if (g.localStorage && typeof g.localStorage.getItem === "function") {
        return g.localStorage;
      }
    }
  } catch {
    // Access can throw in restricted environments (Safari private mode).
  }
  return null;
}

function loadCache(): PersistedTaskTurns[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(TASK_TURN_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTaskTurns[];
    const now = Date.now();
    return parsed.filter((entry) =>
      !!entry?.taskId &&
      Array.isArray(entry.events) &&
      typeof entry.updatedAt === "number" &&
      now - entry.updatedAt <= TASK_TURN_CACHE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function saveCache(entries: PersistedTaskTurns[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const now = Date.now();
    const filtered = entries
      .filter((entry) => now - entry.updatedAt <= TASK_TURN_CACHE_TTL_MS)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-TASK_TURN_CACHE_MAX_ENTRIES);
    storage.setItem(TASK_TURN_CACHE_KEY, JSON.stringify(filtered));
  } catch {
    // Quota / serialization errors are non-fatal; the cache is a UX
    // optimization, not a source of truth.
  }
}

/**
 * Serialize events down to a size that fits localStorage without
 * corrupting downstream renderers. We strip image data (which is the
 * most common cause of bloat) and truncate oversized tool results,
 * preserving enough context that `MessageBubble` / `LLMOutput` still
 * render the structure.
 */
function compactEvents(events: DisplaySessionEvent[]): DisplaySessionEvent[] {
  const truncate = (s: string, n: number): string =>
    s.length > n ? `${s.slice(0, n)}\n… [truncated for cache]` : s;

  let compact = events.map((evt) => ({
    ...evt,
    contentBlocks: evt.contentBlocks?.filter((b) => b.type !== "image"),
    toolCalls: evt.toolCalls?.map((tc) => ({
      ...tc,
      result: tc.result ? truncate(tc.result, 8 * 1024) : tc.result,
    })),
  }));

  // If we are still over budget, drop the oldest events first.
  while (
    compact.length > 1 &&
    JSON.stringify(compact).length > TASK_TURN_MAX_SERIALIZED_BYTES
  ) {
    compact = compact.slice(1);
  }
  return compact;
}

export function persistTaskTurns(
  taskId: string,
  events: DisplaySessionEvent[],
  projectId?: string,
): void {
  if (!taskId || !events || events.length === 0) return;
  const compact = compactEvents(events);
  const cache = loadCache();
  const next: PersistedTaskTurns = {
    taskId,
    projectId,
    events: compact,
    updatedAt: Date.now(),
  };
  const idx = cache.findIndex(
    (entry) => entry.taskId === taskId && entry.projectId === projectId,
  );
  if (idx >= 0) {
    cache[idx] = next;
  } else {
    cache.push(next);
  }
  saveCache(cache);
}

export function readTaskTurns(
  taskId: string,
  projectId?: string,
): DisplaySessionEvent[] {
  if (!taskId) return [];
  const cache = loadCache();
  const exact = cache.find(
    (entry) => entry.taskId === taskId && entry.projectId === projectId,
  );
  if (exact?.events?.length) return exact.events;
  const fallback = cache.find((entry) => entry.taskId === taskId);
  return fallback?.events ?? [];
}

export function invalidateTaskTurns(taskId: string): void {
  if (!taskId) return;
  const cache = loadCache();
  const next = cache.filter((entry) => entry.taskId !== taskId);
  if (next.length !== cache.length) saveCache(next);
}

/** Test-only: clear the entire cache between tests. */
export function resetTaskTurnCache(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(TASK_TURN_CACHE_KEY);
  } catch {
    // ignore
  }
}
