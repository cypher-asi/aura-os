import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { environmentApi } from "./environment";
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

describe("environmentApi", () => {
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

  it("getEnvironmentInfo fetches GET /api/system/info", async () => {
    const info = { version: "1.0.0", environment: "production" };
    const fetchMock = mockFetch(200, info);
    globalThis.fetch = fetchMock;
    const result = await environmentApi.getEnvironmentInfo();
    expect(result).toEqual(info);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/system/info",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("propagates ApiClientError on failure", async () => {
    globalThis.fetch = mockFetch(500, { error: "Server error", code: "internal", details: null });
    await expect(environmentApi.getEnvironmentInfo()).rejects.toThrow(ApiClientError);
  });

  it("returns parsed JSON response", async () => {
    const info = { version: "2.0.0", environment: "staging", uptime: 12345 };
    globalThis.fetch = mockFetch(200, info);
    const result = await environmentApi.getEnvironmentInfo();
    expect(result).toEqual(info);
  });
});
