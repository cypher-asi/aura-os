import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryApi } from "./memory";
import { ApiClientError } from "./core";

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: (k: string) => k.toLowerCase() === "content-type" ? "application/json" : null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

const originalFetch = globalThis.fetch;
const originalLocalStorage = window.localStorage;

function setupHooks() {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      value: createStorageMock(),
      configurable: true,
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });
}

describe("memoryApi - Facts", () => {
  setupHooks();

  it("listFacts fetches facts for an agent", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await memoryApi.listFacts("a1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory/facts", expect.any(Object));
  });

  it("getFact fetches a specific fact", async () => {
    const fetchMock = mockFetch(200, { id: "f1" });
    globalThis.fetch = fetchMock;
    await memoryApi.getFact("a1", "f1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory/facts/f1", expect.any(Object));
  });

  it("getFactByKey fetches fact by key", async () => {
    const fetchMock = mockFetch(200, { id: "f1", key: "name" });
    globalThis.fetch = fetchMock;
    await memoryApi.getFactByKey("a1", "name");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory/facts/by-key/name", expect.any(Object));
  });

  it("createFact sends POST with data", async () => {
    const data = { key: "name", value: "Alice", confidence: 0.9 };
    const fetchMock = mockFetch(200, { id: "f1", ...data });
    globalThis.fetch = fetchMock;
    await memoryApi.createFact("a1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/facts",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("updateFact sends PUT", async () => {
    const data = { value: "Bob", confidence: 0.95 };
    const fetchMock = mockFetch(200, { id: "f1", ...data });
    globalThis.fetch = fetchMock;
    await memoryApi.updateFact("a1", "f1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/facts/f1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data) }),
    );
  });

  it("deleteFact sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await memoryApi.deleteFact("a1", "f1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/facts/f1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("propagates ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Server error", code: "internal", details: null });
    await expect(memoryApi.listFacts("a1")).rejects.toThrow(ApiClientError);
  });
});

describe("memoryApi - Events", () => {
  setupHooks();

  it("listEvents fetches events without params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await memoryApi.listEvents("a1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory/events", expect.any(Object));
  });

  it("listEvents appends query params when provided", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await memoryApi.listEvents("a1", { limit: 10, event_type: "action" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/harness/agents/a1/memory/events?"),
      expect.any(Object),
    );
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("limit=10");
    expect(url).toContain("event_type=action");
  });

  it("listEvents includes since param", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await memoryApi.listEvents("a1", { since: "2025-01-01" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("since=2025-01-01");
  });

  it("createEvent sends POST", async () => {
    const data = { event_type: "action", summary: "Did something" };
    const fetchMock = mockFetch(200, { id: "e1", ...data });
    globalThis.fetch = fetchMock;
    await memoryApi.createEvent("a1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/events",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("deleteEvent sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await memoryApi.deleteEvent("a1", "e1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/events/e1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("memoryApi - Procedures", () => {
  setupHooks();

  it("listProcedures fetches without params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await memoryApi.listProcedures("a1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory/procedures", expect.any(Object));
  });

  it("listProcedures appends query params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await memoryApi.listProcedures("a1", { skill: "coding", min_relevance: 0.5 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("skill=coding");
    expect(url).toContain("min_relevance=0.5");
  });

  it("createProcedure sends POST", async () => {
    const data = { name: "deploy", trigger: "on push", steps: ["build", "test", "deploy"] };
    const fetchMock = mockFetch(200, { id: "pr1", ...data });
    globalThis.fetch = fetchMock;
    await memoryApi.createProcedure("a1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/procedures",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("updateProcedure sends PUT", async () => {
    const data = { name: "deploy-v2" };
    const fetchMock = mockFetch(200, { id: "pr1", ...data });
    globalThis.fetch = fetchMock;
    await memoryApi.updateProcedure("a1", "pr1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/procedures/pr1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data) }),
    );
  });

  it("deleteProcedure sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await memoryApi.deleteProcedure("a1", "pr1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/procedures/pr1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("memoryApi - Aggregate", () => {
  setupHooks();

  it("getSnapshot fetches memory snapshot", async () => {
    const fetchMock = mockFetch(200, { facts: [], events: [] });
    globalThis.fetch = fetchMock;
    await memoryApi.getSnapshot("a1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory", expect.any(Object));
  });

  it("getStats fetches memory stats", async () => {
    const fetchMock = mockFetch(200, { fact_count: 5, event_count: 10 });
    globalThis.fetch = fetchMock;
    await memoryApi.getStats("a1");
    expect(fetchMock).toHaveBeenCalledWith("/api/harness/agents/a1/memory/stats", expect.any(Object));
  });

  it("wipeMemory sends DELETE to memory root", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await memoryApi.wipeMemory("a1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("triggerConsolidation sends POST", async () => {
    const fetchMock = mockFetch(202, null);
    globalThis.fetch = fetchMock;
    await memoryApi.triggerConsolidation("a1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/harness/agents/a1/memory/consolidate",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
