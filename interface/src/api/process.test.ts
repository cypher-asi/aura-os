import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processApi } from "./process";
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
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as typeof globalThis.fetch;
}

function setup() {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = window.localStorage;
  return { originalFetch, originalLocalStorage };
}

describe("processApi - Processes", () => {
  const { originalFetch, originalLocalStorage } = setup();
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

  it("listProcesses fetches GET /api/processes", async () => {
    const processes = [{ id: "p1", name: "Flow" }];
    const fetchMock = mockFetch(200, processes);
    globalThis.fetch = fetchMock;
    const result = await processApi.listProcesses();
    expect(result).toEqual(processes);
    expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("getProcess fetches by id", async () => {
    const fetchMock = mockFetch(200, { id: "p1" });
    globalThis.fetch = fetchMock;
    await processApi.getProcess("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1", expect.any(Object));
  });

  it("createProcess sends POST with body", async () => {
    const data = { name: "New Flow", description: "desc" };
    const fetchMock = mockFetch(200, { id: "p1", ...data });
    globalThis.fetch = fetchMock;
    await processApi.createProcess(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("updateProcess sends PUT", async () => {
    const data = { name: "Updated" };
    const fetchMock = mockFetch(200, { id: "p1", name: "Updated" });
    globalThis.fetch = fetchMock;
    await processApi.updateProcess("p1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data) }),
    );
  });

  it("deleteProcess sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await processApi.deleteProcess("p1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("triggerProcess sends POST to trigger endpoint", async () => {
    const fetchMock = mockFetch(200, { id: "r1", status: "running" });
    globalThis.fetch = fetchMock;
    await processApi.triggerProcess("p1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/trigger",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("propagates ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Server error", code: "internal", details: null });
    await expect(processApi.listProcesses()).rejects.toThrow(ApiClientError);
  });
});

describe("processApi - Nodes", () => {
  const { originalFetch, originalLocalStorage } = setup();
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

  it("listNodes fetches nodes for a process", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await processApi.listNodes("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/nodes", expect.any(Object));
  });

  it("createNode sends POST with node data", async () => {
    const data = { node_type: "agent" as any, label: "Step 1" };
    const fetchMock = mockFetch(200, { id: "n1", ...data });
    globalThis.fetch = fetchMock;
    await processApi.createNode("p1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/nodes",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("updateNode sends PUT", async () => {
    const data = { label: "Updated" };
    const fetchMock = mockFetch(200, { id: "n1", label: "Updated" });
    globalThis.fetch = fetchMock;
    await processApi.updateNode("p1", "n1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/nodes/n1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data) }),
    );
  });

  it("deleteNode sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await processApi.deleteNode("p1", "n1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/nodes/n1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("processApi - Connections", () => {
  const { originalFetch, originalLocalStorage } = setup();
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

  it("listConnections fetches connections for a process", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await processApi.listConnections("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/connections", expect.any(Object));
  });

  it("createConnection sends POST", async () => {
    const data = { source_node_id: "n1", target_node_id: "n2" };
    const fetchMock = mockFetch(200, { id: "c1", ...data });
    globalThis.fetch = fetchMock;
    await processApi.createConnection("p1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/connections",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("deleteConnection sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await processApi.deleteConnection("p1", "c1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/connections/c1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("processApi - Runs & Events", () => {
  const { originalFetch, originalLocalStorage } = setup();
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

  it("listRuns fetches runs for a process", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await processApi.listRuns("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/runs", expect.any(Object));
  });

  it("getRun fetches a specific run", async () => {
    const fetchMock = mockFetch(200, { id: "r1" });
    globalThis.fetch = fetchMock;
    await processApi.getRun("p1", "r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/runs/r1", expect.any(Object));
  });

  it("cancelRun sends POST to cancel endpoint", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await processApi.cancelRun("p1", "r1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/runs/r1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("listRunEvents fetches events for a run", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await processApi.listRunEvents("p1", "r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/runs/r1/events", expect.any(Object));
  });
});

describe("processApi - Artifacts", () => {
  const { originalFetch, originalLocalStorage } = setup();
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

  it("listRunArtifacts fetches artifacts for a run", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await processApi.listRunArtifacts("p1", "r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/runs/r1/artifacts", expect.any(Object));
  });

  it("getArtifact fetches by artifact id", async () => {
    const fetchMock = mockFetch(200, { id: "art1" });
    globalThis.fetch = fetchMock;
    await processApi.getArtifact("art1");
    expect(fetchMock).toHaveBeenCalledWith("/api/process-artifacts/art1", expect.any(Object));
  });
});

describe("processApi - Folders", () => {
  const { originalFetch, originalLocalStorage } = setup();
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

  it("listFolders fetches GET /api/process-folders", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await processApi.listFolders();
    expect(fetchMock).toHaveBeenCalledWith("/api/process-folders", expect.any(Object));
  });

  it("createFolder sends POST", async () => {
    const data = { name: "My Folder", org_id: "org-1" };
    const fetchMock = mockFetch(200, { id: "f1", name: "My Folder" });
    globalThis.fetch = fetchMock;
    await processApi.createFolder(data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/process-folders",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data) }),
    );
  });

  it("updateFolder sends PUT", async () => {
    const data = { name: "Renamed" };
    const fetchMock = mockFetch(200, { id: "f1", name: "Renamed" });
    globalThis.fetch = fetchMock;
    await processApi.updateFolder("f1", data);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/process-folders/f1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data) }),
    );
  });

  it("deleteFolder sends DELETE", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await processApi.deleteFolder("f1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/process-folders/f1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
