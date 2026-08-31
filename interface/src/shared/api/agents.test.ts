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

  it("clone posts the name and destination machine type", async () => {
    const clone = {
      agent: { agent_id: "a2", machine_type: "local" },
      copy_report: { copied: ["profile"], not_copied: ["secrets"] },
    };
    const fetchMock = mockFetch(200, clone);
    globalThis.fetch = fetchMock;

    const result = await agentTemplatesApi.clone("a1" as string, {
      name: "source-copy",
      machine_type: "local",
    });

    expect(result).toEqual(clone);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/clone",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "source-copy", machine_type: "local" }),
      }),
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

  // Phase 4: per-session standalone events endpoint. The hook
  // `useStandaloneAgentChat` calls this whenever a `?session=` pin is
  // in the URL so the chat panel stays scoped to that single session
  // instead of replaying the per-agent timeline (which used to drag
  // old conversations back into view after the user pressed `+`).
  it("listSessionEvents fetches /api/agents/:id/sessions/:sid/events", async () => {
    const events = [{ id: "e1", content: "hi" }];
    const fetchMock = mockFetch(200, events);
    globalThis.fetch = fetchMock;

    const result = await agentTemplatesApi.listSessionEvents(
      "a1" as string,
      "s1",
    );
    expect(result).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/sessions/s1/events",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("listSessionEvents threads limit and since query params", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;

    await agentTemplatesApi.listSessionEvents("a1" as string, "s1", {
      limit: STANDALONE_AGENT_HISTORY_LIMIT,
      since: "2026-05-01T00:00:00Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agents/a1/sessions/s1/events?limit=${STANDALONE_AGENT_HISTORY_LIMIT}&since=${encodeURIComponent("2026-05-01T00:00:00Z")}`,
      expect.any(Object),
    );
  });

  it("listSessionEvents propagates AbortSignal", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    const controller = new AbortController();

    await agentTemplatesApi.listSessionEvents("a1" as string, "s1", {
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/sessions/s1/events",
      expect.objectContaining({ signal: controller.signal }),
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

  it("times out Recall transport stalls after its 15 second client budget", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const request = sessionsApi.searchMySessionHistory("desktop recall", 7);
      const rejection = expect(request).rejects.toThrow(
        "The request timed out. Please try again.",
      );
      await vi.advanceTimersByTimeAsync(15_000);

      await rejection;
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/me/sessions/search?q=desktop+recall&limit=7",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.useRealTimers();
    }
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

  it("archives and restores a session through the archive resource", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;

    await sessionsApi.archiveSession("p1" as string, "ai1" as string, "s1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/p1/agents/ai1/sessions/s1/archive",
      expect.objectContaining({ method: "POST" }),
    );

    await sessionsApi.restoreArchivedSession(
      "p1" as string,
      "ai1" as string,
      "s1",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/p1/agents/ai1/sessions/s1/archive",
      expect.objectContaining({ method: "DELETE" }),
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
