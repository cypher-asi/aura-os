interface PersistedTaskOutputCacheEntry {
  taskId: string;
  projectId?: string;
  text: string;
  updatedAt: number;
}

const TASK_OUTPUT_CACHE_KEY = "aura-task-output-cache-v1";
const TASK_OUTPUT_CACHE_MAX_ENTRIES = 100;
const TASK_OUTPUT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TASK_OUTPUT_CACHE_WRITE_DEBOUNCE_MS = 500;
const TASK_OUTPUT_CACHE_MAX_WRITE_DELAY_MS = 2_000;

let taskOutputCache: PersistedTaskOutputCacheEntry[] | null = null;
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let persistMaxDelayTimer: ReturnType<typeof setTimeout> | null = null;
let hasPendingPersist = false;

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

function trimTaskOutputCacheEntries(
  entries: PersistedTaskOutputCacheEntry[],
): PersistedTaskOutputCacheEntry[] {
  const now = Date.now();
  return entries
    .filter((entry) => now - entry.updatedAt <= TASK_OUTPUT_CACHE_TTL_MS)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-TASK_OUTPUT_CACHE_MAX_ENTRIES);
}

function getTaskOutputCache(): PersistedTaskOutputCacheEntry[] {
  if (!taskOutputCache) {
    taskOutputCache = trimTaskOutputCacheEntries(loadPersistedTaskOutputCache());
  }
  return taskOutputCache;
}

function savePersistedTaskOutputCache(entries: PersistedTaskOutputCacheEntry[]): void {
  if (!canUseLocalStorage()) return;
  try {
    const filtered = trimTaskOutputCacheEntries(entries);
    window.localStorage.setItem(TASK_OUTPUT_CACHE_KEY, JSON.stringify(filtered));
    taskOutputCache = filtered;
  } catch {
    // Ignore quota and serialization errors.
  }
}

function clearPersistTimers(): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  if (persistMaxDelayTimer) {
    clearTimeout(persistMaxDelayTimer);
    persistMaxDelayTimer = null;
  }
}

function flushPersistedTaskOutputCache(): void {
  if (!hasPendingPersist || !taskOutputCache) return;
  clearPersistTimers();
  hasPendingPersist = false;
  savePersistedTaskOutputCache(taskOutputCache);
}

function schedulePersistedTaskOutputCacheWrite(): void {
  hasPendingPersist = true;
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(() => {
    flushPersistedTaskOutputCache();
  }, TASK_OUTPUT_CACHE_WRITE_DEBOUNCE_MS);

  if (!persistMaxDelayTimer) {
    persistMaxDelayTimer = setTimeout(() => {
      flushPersistedTaskOutputCache();
    }, TASK_OUTPUT_CACHE_MAX_WRITE_DELAY_MS);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPersistedTaskOutputCache);
}

export function persistTaskOutputText(taskId: string, text: string, projectId?: string): void {
  if (!text) return;
  const cache = getTaskOutputCache();
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
  taskOutputCache = trimTaskOutputCacheEntries(cache);
  schedulePersistedTaskOutputCacheWrite();
}

export function removePersistedTaskOutputText(taskId: string): void {
  const cache = getTaskOutputCache();
  const next = cache.filter((entry) => entry.taskId !== taskId);
  if (next.length !== cache.length) {
    taskOutputCache = next;
    schedulePersistedTaskOutputCacheWrite();
  }
}

export function getCachedTaskOutputText(taskId: string, projectId?: string): string {
  const cache = getTaskOutputCache();
  const exact = cache.find((entry) => entry.taskId === taskId && entry.projectId === projectId);
  if (exact?.text) return exact.text;
  const fallback = cache.find((entry) => entry.taskId === taskId);
  return fallback?.text ?? "";
}
