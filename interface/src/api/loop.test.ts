import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loopApi } from "./loop";
import { ApiClientError } from "./core";

vi.mock("../lib/host-config", () => ({
  resolveApiUrl: (path: string) => path,
}));

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: (k: string) => k.toLowerCase() === "content-type" ? "application/json" : null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

const loopStatus = { running: true, paused: false, project_id: "p1", active_agent_instances: [] };

describe("loopApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("startLoop sends POST without query param when no agentInstanceId", async () => {
    const fetchMock = mockFetch(200, loopStatus);
    globalThis.fetch = fetchMock;
    await loopApi.startLoop("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/loop/start",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("startLoop appends agent_instance_id query param", async () => {
    const fetchMock = mockFetch(200, loopStatus);
    globalThis.fetch = fetchMock;
    await loopApi.startLoop("p1" as string, "ai1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/loop/start?agent_instance_id=ai1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("startLoop includes explicit model override when provided", async () => {
    const fetchMock = mockFetch(200, loopStatus);
    globalThis.fetch = fetchMock;
    await loopApi.startLoop("p1" as string, "ai1", "aura-gpt-4.1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/loop/start?agent_instance_id=ai1&model=aura-gpt-4.1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pauseLoop sends POST without query param", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await loopApi.pauseLoop("p1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/loop/pause",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pauseLoop appends agent_instance_id query param", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await loopApi.pauseLoop("p1" as string, "agent-x");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/loop/pause?agent_instance_id=agent-x",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stopLoop sends POST without query param", async () => {
    const fetchMock = mockFetch(200, { ...loopStatus, running: false });
    globalThis.fetch = fetchMock;
    const result = await loopApi.stopLoop("p1" as string);
    expect(result.running).toBe(false);
  });

  it("stopLoop appends agent_instance_id query param", async () => {
    const fetchMock = mockFetch(200, loopStatus);
    globalThis.fetch = fetchMock;
    await loopApi.stopLoop("p1" as string, "agent-y");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/loop/stop?agent_instance_id=agent-y",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getLoopStatus fetches GET", async () => {
    const fetchMock = mockFetch(200, loopStatus);
    globalThis.fetch = fetchMock;
    const result = await loopApi.getLoopStatus("p1" as string);
    expect(result).toEqual(loopStatus);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/loop/status", expect.any(Object));
  });

  it("throws ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(404, { error: "Not found", code: "not_found", details: null });
    await expect(loopApi.getLoopStatus("missing" as string)).rejects.toThrow(ApiClientError);
  });
});
