import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  agentTemplatesApi,
  agentInstancesApi,
  sessionsApi,
  STANDALONE_AGENT_HISTORY_LIMIT,
} from "./agents";
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

describe("agentTemplatesApi", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = window.localStorage;
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

  it("list fetches GET /api/agents", async () => {
    const agents = [{ id: "a1", name: "Bot" }];
    const fetchMock = mockFetch(200, agents);
    globalThis.fetch = fetchMock;
    const result = await agentTemplatesApi.list();
    expect(result).toEqual(agents);
    expect(fetchMock).toHaveBeenCalledWith("/api/agents", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("create sends POST with body", async () => {
    const agent = { id: "a1", name: "Bot", role: "helper", personality: "kind", system_prompt: "hi" };
    const fetchMock = mockFetch(200, agent);
    globalThis.fetch = fetchMock;
    const data = { name: "Bot", role: "helper", personality: "kind", system_prompt: "hi" };
    await agentTemplatesApi.create(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("get fetches by agentId and passes signal", async () => {
    const fetchMock = mockFetch(200, { id: "a1" });
    globalThis.fetch = fetchMock;
    const controller = new AbortController();
    await agentTemplatesApi.get("a1" as string, { signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("update sends PUT", async () => {
    const fetchMock = mockFetch(200, { id: "a1", name: "Updated" });
    globalThis.fetch = fetchMock;
    await agentTemplatesApi.update("a1" as string, { name: "Updated" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "Updated" }) }),
    );
  });

  it("delete sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await agentTemplatesApi.delete("a1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("listEvents fetches events with signal", async () => {
    const events = [{ id: "m1", content: "hello" }];
    const fetchMock = mockFetch(200, events);
    globalThis.fetch = fetchMock;
    const result = await agentTemplatesApi.listEvents("a1" as string);
    expect(result).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/a1/events", expect.any(Object));
  });

  it("listEvents sends pagination params when requested", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;

    await agentTemplatesApi.listEvents("a1" as string, {
      limit: STANDALONE_AGENT_HISTORY_LIMIT,
      offset: 40,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agents/a1/events?limit=${STANDALONE_AGENT_HISTORY_LIMIT}&offset=40`,
      expect.any(Object),
    );
  });

  it("propagates ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Server error", code: "internal", details: null });
    await expect(agentTemplatesApi.list()).rejects.toThrow(ApiClientError);
  });
});

describe("agentInstancesApi", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = window.localStorage;
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

  it("createAgentInstance sends POST with agent_id", async () => {
    const fetchMock = mockFetch(200, { id: "ai1" });
    globalThis.fetch = fetchMock;
    await agentInstancesApi.createAgentInstance("p1" as string, "a1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ agent_id: "a1" }) }),
    );
  });

  it("createGeneralAgentInstance sends POST with kind", async () => {
    const fetchMock = mockFetch(200, { id: "ai1" });
    globalThis.fetch = fetchMock;
    await agentInstancesApi.createGeneralAgentInstance("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "general" }) }),
    );
  });

  it("listAgentInstances fetches GET", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await agentInstancesApi.listAgentInstances("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/agents", expect.any(Object));
  });

  it("getAgentInstance fetches by ids with signal", async () => {
    const fetchMock = mockFetch(200, { id: "ai1" });
    globalThis.fetch = fetchMock;
    const controller = new AbortController();
    await agentInstancesApi.getAgentInstance("p1" as string, "ai1" as string, { signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("updateAgentInstance sends PUT with partial data", async () => {
    const fetchMock = mockFetch(200, { id: "ai1", name: "New" });
    globalThis.fetch = fetchMock;
    await agentInstancesApi.updateAgentInstance("p1" as string, "ai1" as string, { name: "New" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "New" }) }),
    );
  });

  it("deleteAgentInstance sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await agentInstancesApi.deleteAgentInstance("p1" as string, "ai1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("getEvents fetches events for agent instance", async () => {
    const fetchMock = mockFetch(200, [{ id: "m1" }]);
    globalThis.fetch = fetchMock;
    await agentInstancesApi.getEvents("p1" as string, "ai1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1/events",
      expect.any(Object),
    );
  });
});

describe("sessionsApi", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = window.localStorage;
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

  it("listProjectSessions fetches by projectId", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await sessionsApi.listProjectSessions("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/sessions", expect.any(Object));
  });

  it("listSessions fetches by project and agent instance", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await sessionsApi.listSessions("p1" as string, "ai1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1/sessions",
      expect.any(Object),
    );
  });

  it("getSession fetches specific session", async () => {
    const fetchMock = mockFetch(200, { id: "s1" });
    globalThis.fetch = fetchMock;
    await sessionsApi.getSession("p1" as string, "ai1" as string, "s1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1/sessions/s1",
      expect.any(Object),
    );
  });

  it("listSessionTasks fetches tasks for session", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await sessionsApi.listSessionTasks("p1" as string, "ai1" as string, "s1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1/sessions/s1/tasks",
      expect.any(Object),
    );
  });

  it("listSessionEvents fetches events for session", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await sessionsApi.listSessionEvents("p1" as string, "ai1" as string, "s1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/ai1/sessions/s1/events",
      expect.any(Object),
    );
  });
});
