import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { swarmApi } from "./swarm";
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

describe("swarmApi", () => {
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

  it("getRemoteAgentState fetches agent state", async () => {
    const state = { status: "running" };
    const fetchMock = mockFetch(200, state);
    globalThis.fetch = fetchMock;
    const result = await swarmApi.getRemoteAgentState("a1");
    expect(result).toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/a1/remote_agent/state", expect.any(Object));
  });

  it("remoteAgentAction sends POST for hibernate", async () => {
    const fetchMock = mockFetch(200, { agent_id: "a1", status: "hibernating" });
    globalThis.fetch = fetchMock;
    await swarmApi.remoteAgentAction("a1", "hibernate");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/hibernate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("remoteAgentAction sends POST for stop", async () => {
    const fetchMock = mockFetch(200, { agent_id: "a1", status: "stopped" });
    globalThis.fetch = fetchMock;
    await swarmApi.remoteAgentAction("a1", "stop");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("remoteAgentAction sends POST for restart", async () => {
    const fetchMock = mockFetch(200, { agent_id: "a1", status: "running" });
    globalThis.fetch = fetchMock;
    await swarmApi.remoteAgentAction("a1", "restart");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/restart",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("remoteAgentAction sends POST for wake", async () => {
    const fetchMock = mockFetch(200, { agent_id: "a1", status: "running" });
    globalThis.fetch = fetchMock;
    await swarmApi.remoteAgentAction("a1", "wake");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/wake",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("remoteAgentAction sends POST for start", async () => {
    const fetchMock = mockFetch(200, { agent_id: "a1", status: "running" });
    globalThis.fetch = fetchMock;
    await swarmApi.remoteAgentAction("a1", "start");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/start",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("listRemoteDirectory sends POST with path", async () => {
    const response = { ok: true, entries: [{ name: "file.txt", is_dir: false }] };
    const fetchMock = mockFetch(200, response);
    globalThis.fetch = fetchMock;
    const result = await swarmApi.listRemoteDirectory("a1", "/home");
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/files",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ path: "/home" }) }),
    );
  });

  it("readRemoteFile sends POST with path", async () => {
    const response = { ok: true, content: "hello world", path: "/home/file.txt" };
    const fetchMock = mockFetch(200, response);
    globalThis.fetch = fetchMock;
    const result = await swarmApi.readRemoteFile("a1", "/home/file.txt");
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/a1/remote_agent/read-file",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ path: "/home/file.txt" }) }),
    );
  });

  it("propagates ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Server error", code: "internal", details: null });
    await expect(swarmApi.getRemoteAgentState("a1")).rejects.toThrow(ApiClientError);
  });
});
