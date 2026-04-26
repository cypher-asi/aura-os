import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const stub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
});

const TASK_OUTPUT_CACHE_KEY = "aura-task-output-cache-v1";

async function loadCacheModule() {
  return import("./task-output-cache");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("task-output-cache", () => {
  it("serves fresh output from memory before the debounced localStorage write", async () => {
    const { getCachedTaskOutputText, persistTaskOutputText } = await loadCacheModule();

    persistTaskOutputText("task-1", "hello", "project-1");

    expect(getCachedTaskOutputText("task-1", "project-1")).toBe("hello");
    expect(window.localStorage.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(TASK_OUTPUT_CACHE_KEY)).toContain("hello");
  });

  it("coalesces rapid output updates into one persisted write", async () => {
    const { persistTaskOutputText } = await loadCacheModule();

    persistTaskOutputText("task-1", "a", "project-1");
    vi.advanceTimersByTime(250);
    persistTaskOutputText("task-1", "ab", "project-1");
    vi.advanceTimersByTime(250);
    persistTaskOutputText("task-1", "abc", "project-1");

    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);

    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(TASK_OUTPUT_CACHE_KEY) ?? "[]")).toMatchObject([
      { taskId: "task-1", projectId: "project-1", text: "abc" },
    ]);
  });

  it("flushes no later than the max write delay during continuous updates", async () => {
    const { persistTaskOutputText } = await loadCacheModule();

    persistTaskOutputText("task-1", "a", "project-1");
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(400);
      persistTaskOutputText("task-1", `a${i}`, "project-1");
    }

    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);

    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("flushes synchronously before unload", async () => {
    const { persistTaskOutputText } = await loadCacheModule();

    persistTaskOutputText("task-1", "hello", "project-1");
    window.dispatchEvent(new Event("beforeunload"));

    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(TASK_OUTPUT_CACHE_KEY)).toContain("hello");
  });

  it("removes entries from the in-memory cache immediately", async () => {
    const {
      getCachedTaskOutputText,
      persistTaskOutputText,
      removePersistedTaskOutputText,
    } = await loadCacheModule();

    persistTaskOutputText("task-1", "hello", "project-1");
    removePersistedTaskOutputText("task-1");

    expect(getCachedTaskOutputText("task-1", "project-1")).toBe("");
    vi.advanceTimersByTime(500);

    expect(JSON.parse(window.localStorage.getItem(TASK_OUTPUT_CACHE_KEY) ?? "[]")).toEqual([]);
  });
});
