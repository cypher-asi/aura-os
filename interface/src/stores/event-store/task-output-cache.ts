interface PersistedTaskOutputCacheEntry {
  taskId: string;
  projectId?: string;
  text: string;
  updatedAt: number;
}

const TASK_OUTPUT_CACHE_KEY = "aura-task-output-cache-v1";
const TASK_OUTPUT_CACHE_MAX_ENTRIES = 100;
const TASK_OUTPUT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadPersistedTaskOutputCache(): PersistedTaskOutputCacheEntry[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(TASK_OUTPUT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTaskOutputCacheEntry[];
    const now = Date.now();
    return parsed.filter((entry) =>
      !!entry?.taskId &&
      typeof entry.text === "string" &&
      entry.text.length > 0 &&
      typeof entry.updatedAt === "number" &&
      now - entry.updatedAt <= TASK_OUTPUT_CACHE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function savePersistedTaskOutputCache(entries: PersistedTaskOutputCacheEntry[]): void {
  if (!canUseLocalStorage()) return;
  try {
    const now = Date.now();
    const filtered = entries
      .filter((entry) => now - entry.updatedAt <= TASK_OUTPUT_CACHE_TTL_MS)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-TASK_OUTPUT_CACHE_MAX_ENTRIES);
    window.localStorage.setItem(TASK_OUTPUT_CACHE_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore quota and serialization errors.
  }
}

export function persistTaskOutputText(taskId: string, text: string, projectId?: string): void {
  if (!text) return;
  const cache = loadPersistedTaskOutputCache();
  const matchIndex = cache.findIndex((entry) => entry.taskId === taskId && entry.projectId === projectId);
  const nextEntry: PersistedTaskOutputCacheEntry = {
    taskId,
    projectId,
    text,
    updatedAt: Date.now(),
  };
  if (matchIndex >= 0) {
    cache[matchIndex] = nextEntry;
  } else {
    cache.push(nextEntry);
  }
  savePersistedTaskOutputCache(cache);
}

export function removePersistedTaskOutputText(taskId: string): void {
  const cache = loadPersistedTaskOutputCache();
  const next = cache.filter((entry) => entry.taskId !== taskId);
  if (next.length !== cache.length) savePersistedTaskOutputCache(next);
}

export function getCachedTaskOutputText(taskId: string, projectId?: string): string {
  const cache = loadPersistedTaskOutputCache();
  const exact = cache.find((entry) => entry.taskId === taskId && entry.projectId === projectId);
  if (exact?.text) return exact.text;
  const fallback = cache.find((entry) => entry.taskId === taskId);
  return fallback?.text ?? "";
}
