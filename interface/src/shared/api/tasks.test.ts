import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tasksApi } from "./tasks";
import { ApiClientError } from "./core";

vi.mock("../../lib/host-config", () => ({
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

describe("tasksApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("listTasks fetches by projectId", async () => {
    const tasks = [{ id: "t1", title: "Task 1" }];
    const fetchMock = mockFetch(200, tasks);
    globalThis.fetch = fetchMock;
    const result = await tasksApi.listTasks("p1" as string);
    expect(result).toEqual(tasks);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/tasks", expect.any(Object));
  });

  it("listTasksBySpec fetches by projectId and specId", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await tasksApi.listTasksBySpec("p1" as string, "s1" as string);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/specs/s1/tasks", expect.any(Object));
  });

  it("transitionTask sends POST with new_status", async () => {
    const fetchMock = mockFetch(200, { id: "t1", status: "done" });
    globalThis.fetch = fetchMock;
    await tasksApi.transitionTask("p1" as string, "t1" as string, "done" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/tasks/t1/transition",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ new_status: "done" }),
      }),
    );
  });

  it("retryTask sends POST", async () => {
    const fetchMock = mockFetch(200, { id: "t1", status: "pending" });
    globalThis.fetch = fetchMock;
    await tasksApi.retryTask("p1" as string, "t1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/tasks/t1/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("runTask sends POST without agentInstanceId", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await tasksApi.runTask("p1" as string, "t1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/tasks/t1/run",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("runTask appends agent_instance_id query param", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await tasksApi.runTask("p1" as string, "t1" as string, "ai1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/tasks/t1/run?agent_instance_id=ai1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deleteTask sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await tasksApi.deleteTask("p1" as string, "t1" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/tasks/t1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("updateTask sends PUT with title in the body", async () => {
    const fetchMock = mockFetch(200, { task_id: "t1", title: "Renamed" });
    globalThis.fetch = fetchMock;
    await tasksApi.updateTask("p1" as string, "t1" as string, {
      title: "Renamed",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/p1/tasks/t1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Renamed" });
  });

  it("runTask includes explicit model override when provided", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await tasksApi.runTask("p1" as string, "t1" as string, "ai1", "aura-o4-mini");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/tasks/t1/run?agent_instance_id=ai1&model=aura-o4-mini",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getTaskOutput fetches output", async () => {
    const output = { output: "build succeeded", build_steps: [], test_steps: [] };
    const fetchMock = mockFetch(200, output);
    globalThis.fetch = fetchMock;
    const result = await tasksApi.getTaskOutput("p1" as string, "t1" as string);
    expect(result).toEqual(output);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/tasks/t1/output", expect.any(Object));
  });

  it("throws ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(404, { error: "Not found", code: "not_found", details: null });
    await expect(tasksApi.listTasks("missing" as string)).rejects.toThrow(ApiClientError);
  });
});
