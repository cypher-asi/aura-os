import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { desktopApi } from "./desktop";
import { ApiClientError } from "./core";

const storageState = new Map<string, string>();

const mockStorage = {
  getItem: vi.fn((key: string) => storageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageState.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storageState.delete(key);
  }),
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: (k: string) => k.toLowerCase() === "content-type" ? "application/json" : null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("desktopApi", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    storageState.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: mockStorage,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    storageState.clear();
  });

  it("getLogEntries fetches with default limit", async () => {
    const entries = [{ timestamp_ms: 1000, event: {} }];
    const fetchMock = mockFetch(200, entries);
    globalThis.fetch = fetchMock;
    const result = await desktopApi.getLogEntries();
    expect(result).toEqual(entries);
    expect(fetchMock).toHaveBeenCalledWith("/api/log-entries?limit=1000", expect.any(Object));
  });

  it("getLogEntries respects custom limit", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;
    await desktopApi.getLogEntries(50);
    expect(fetchMock).toHaveBeenCalledWith("/api/log-entries?limit=50", expect.any(Object));
  });

  it("listDirectory sends POST with path", async () => {
    const response = { ok: true, entries: [{ name: "file.txt", path: "/file.txt", is_dir: false }] };
    const fetchMock = mockFetch(200, response);
    globalThis.fetch = fetchMock;
    const result = await desktopApi.listDirectory("/home");
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/list-directory",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ path: "/home" }) }),
    );
  });

  it("pickFolder sends POST", async () => {
    const fetchMock = mockFetch(200, "/selected/folder");
    globalThis.fetch = fetchMock;
    const result = await desktopApi.pickFolder();
    expect(result).toBe("/selected/folder");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pick-folder",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pickFile sends POST", async () => {
    const fetchMock = mockFetch(200, "/file.txt");
    globalThis.fetch = fetchMock;
    await desktopApi.pickFile();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pick-file",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("persistLastRoute sends POST with route", async () => {
    const fetchMock = mockFetch(200, { ok: true, route: "/projects/demo?session=abc" });
    globalThis.fetch = fetchMock;
    await desktopApi.persistLastRoute("/projects/demo?session=abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/last-route",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ route: "/projects/demo?session=abc" }),
      }),
    );
  });

  it("openPath sends POST with path", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    globalThis.fetch = fetchMock;
    await desktopApi.openPath("/some/file");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/open-path",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ path: "/some/file" }) }),
    );
  });

  it("openIde sends POST with path and optional root", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    globalThis.fetch = fetchMock;
    await desktopApi.openIde("/src/main.rs", "/project");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/open-ide",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/src/main.rs", root: "/project" }),
      }),
    );
  });

  it("readFile sends POST with path", async () => {
    const fetchMock = mockFetch(200, { ok: true, content: "hello", path: "/f.txt" });
    globalThis.fetch = fetchMock;
    const result = await desktopApi.readFile("/f.txt");
    expect(result.content).toBe("hello");
  });

  it("writeFile sends POST with path and content", async () => {
    const fetchMock = mockFetch(200, { ok: true, path: "/f.txt" });
    globalThis.fetch = fetchMock;
    await desktopApi.writeFile("/f.txt", "world");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/write-file",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/f.txt", content: "world" }),
      }),
    );
  });

  it("getUpdateStatus fetches GET /api/update-status", async () => {
    const status = { update: { status: "available", version: "2.0" }, channel: "stable", current_version: "1.0" };
    const fetchMock = mockFetch(200, status);
    globalThis.fetch = fetchMock;
    const result = await desktopApi.getUpdateStatus();
    expect(result).toEqual(status);
  });

  it("installUpdate sends POST /api/update-install", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    globalThis.fetch = fetchMock;
    await desktopApi.installUpdate();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/update-install",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("checkForUpdates sends POST /api/update-check", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    globalThis.fetch = fetchMock;
    await desktopApi.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/update-check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("setUpdateChannel sends POST with channel", async () => {
    const fetchMock = mockFetch(200, { ok: true, channel: "nightly" });
    globalThis.fetch = fetchMock;
    await desktopApi.setUpdateChannel("nightly");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/update-channel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ channel: "nightly" }),
      }),
    );
  });

  it("revealUpdateLogs sends POST /api/update-reveal-logs", async () => {
    const fetchMock = mockFetch(200, { ok: true, path: "C:/aura/logs" });
    globalThis.fetch = fetchMock;
    const result = await desktopApi.revealUpdateLogs();
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/update-reveal-logs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stageUpdateOnly sends POST /api/update-stage-only", async () => {
    const fetchMock = mockFetch(200, {
      ok: true,
      staged_path: "C:/aura/runtime/updater/aura-setup-1.exe",
    });
    globalThis.fetch = fetchMock;
    const result = await desktopApi.stageUpdateOnly();
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/update-stage-only",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws ApiClientError on server error", async () => {
    globalThis.fetch = mockFetch(500, { error: "Fail", code: "internal", details: null });
    await expect(desktopApi.pickFolder()).rejects.toThrow(ApiClientError);
  });
});
