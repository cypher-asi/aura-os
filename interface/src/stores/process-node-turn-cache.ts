import type { DisplaySessionEvent } from "../shared/types/stream";

/* ------------------------------------------------------------------ */
/*  Process-node turn cache                                            */
/*                                                                     */
/*  Persists the structured turn history (events[] with timeline,      */
/*  toolCalls and thinking text) for a process-run node execution so   */
/*  the "Live Output" section in the Run preview can rehydrate after   */
/*  a page reload or WS reconnect while a run is still in flight.      */
/*                                                                     */
/*  Mirror of `task-turn-cache.ts`, keyed by (run_id, node_id) rather  */
/*  than (task_id). Completed runs continue to hydrate their           */
/*  post-completion view from the server (`ProcessEvent.content_blocks`*/
/*  via `processApi.listRunEvents`); this cache only exists to keep    */
/*  the live-streaming panel populated across reloads.                 */
/* ------------------------------------------------------------------ */

interface PersistedProcessNodeTurns {
  runId: string;
  nodeId: string;
  processId?: string;
  events: DisplaySessionEvent[];
  updatedAt: number;
}

const PROCESS_NODE_TURN_CACHE_KEY = "aura-process-node-turns-v1";
const PROCESS_NODE_TURN_CACHE_MAX_ENTRIES = 60;
const PROCESS_NODE_TURN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Per-entry cap to keep localStorage usage sane — assistant tool
// results (e.g. read_file dumps) are the main source of bloat.
const PROCESS_NODE_TURN_MAX_SERIALIZED_BYTES = 256 * 1024;

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

function loadCache(): PersistedProcessNodeTurns[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PROCESS_NODE_TURN_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedProcessNodeTurns[];
    const now = Date.now();
    return parsed.filter((entry) =>
      !!entry?.runId &&
      !!entry?.nodeId &&
      Array.isArray(entry.events) &&
      typeof entry.updatedAt === "number" &&
      now - entry.updatedAt <= PROCESS_NODE_TURN_CACHE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function saveCache(entries: PersistedProcessNodeTurns[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const now = Date.now();
    const filtered = entries
      .filter((entry) => now - entry.updatedAt <= PROCESS_NODE_TURN_CACHE_TTL_MS)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-PROCESS_NODE_TURN_CACHE_MAX_ENTRIES);
    storage.setItem(PROCESS_NODE_TURN_CACHE_KEY, JSON.stringify(filtered));
  } catch {
    // Quota / serialization errors are non-fatal; the cache is a UX
    // optimization, not a source of truth.
  }
}

/**
 * Serialize events down to a size that fits localStorage without
 * corrupting downstream renderers. Strips image blocks (the most
 * common source of bloat) and truncates oversized tool results, then
 * drops the oldest events if we are still over budget.
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

  while (
    compact.length > 1 &&
    JSON.stringify(compact).length > PROCESS_NODE_TURN_MAX_SERIALIZED_BYTES
  ) {
    compact = compact.slice(1);
  }
  return compact;
}

export function persistProcessNodeTurns(
  runId: string,
  nodeId: string,
  events: DisplaySessionEvent[],
  processId?: string,
): void {
  if (!runId || !nodeId || !events || events.length === 0) return;
  const compact = compactEvents(events);
  const cache = loadCache();
  const next: PersistedProcessNodeTurns = {
    runId,
    nodeId,
    processId,
    events: compact,
    updatedAt: Date.now(),
  };
  const idx = cache.findIndex(
    (entry) => entry.runId === runId && entry.nodeId === nodeId,
  );
  if (idx >= 0) {
    cache[idx] = next;
  } else {
    cache.push(next);
  }
  saveCache(cache);
}

export function readProcessNodeTurns(
  runId: string,
  nodeId: string,
): DisplaySessionEvent[] {
  if (!runId || !nodeId) return [];
  const cache = loadCache();
  const entry = cache.find(
    (e) => e.runId === runId && e.nodeId === nodeId,
  );
  return entry?.events ?? [];
}

export function invalidateProcessNodeTurns(
  runId: string,
  nodeId?: string,
): void {
  if (!runId) return;
  const cache = loadCache();
  const next = nodeId
    ? cache.filter((e) => !(e.runId === runId && e.nodeId === nodeId))
    : cache.filter((e) => e.runId !== runId);
  if (next.length !== cache.length) saveCache(next);
}

/** Test-only: clear the entire cache between tests. */
export function resetProcessNodeTurnCache(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(PROCESS_NODE_TURN_CACHE_KEY);
  } catch {
    // ignore
  }
}
