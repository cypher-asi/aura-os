import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { marketplaceApi } from "./marketplace";

const originalFetch = globalThis.fetch;

// JSDOM's `window.localStorage` isn't enabled in this project's setup, but
// `resolveApiUrl` reads it to pick the backend host. Install a minimal stub
// so `apiFetch` can resolve URLs without crashing. Returning null mirrors
// the "no stored override" case, which lets the tests assert relative URLs.
const localStorageStub: Storage = {
  length: 0,
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {},
};
Object.defineProperty(window, "localStorage", {
  value: localStorageStub,
  configurable: true,
});

function mockFetchOnce(body: unknown, init: Partial<ResponseInit> = {}) {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const fn = vi.fn().mockResolvedValueOnce(response);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("marketplaceApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("encodes list params as query string and returns the response", async () => {
    const fetchMock = mockFetchOnce({ agents: [], total: 0 });

    const result = await marketplaceApi.list({
      sort: "latest",
      expertise: "coding",
      limit: 20,
      offset: 10,
    });

    expect(result).toEqual({ agents: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/marketplace/agents");
    expect(url).toContain("sort=latest");
    expect(url).toContain("expertise=coding");
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=10");
  });

  it("omits missing params so the server can apply its defaults", async () => {
    const fetchMock = mockFetchOnce({ agents: [], total: 0 });
    await marketplaceApi.list();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(fetchMock.mock.calls[0][0]);
    expect(url.endsWith("/api/marketplace/agents")).toBe(true);
    expect(url).not.toContain("?");
  });

  it("skips null expertise so callers can clear the filter without building URLs by hand", async () => {
    const fetchMock = mockFetchOnce({ agents: [], total: 0 });
    await marketplaceApi.list({ sort: "trending", expertise: null });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("sort=trending");
    expect(url).not.toContain("expertise");
  });

  it("requests the detail endpoint for get()", async () => {
    const fetchMock = mockFetchOnce({
      agent: {
        agent_id: "abc",
        tags: [],
        name: "x",
      },
      description: "",
      jobs: 0,
      revenue_usd: 0,
      reputation: 0,
      creator_display_name: "u",
      creator_user_id: "u",
      listed_at: "2025-01-01T00:00:00Z",
    });

    await marketplaceApi.get("abc");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/marketplace/agents/abc");
  });
});
