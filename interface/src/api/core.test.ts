import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiClientError,
  isInsufficientCreditsError,
  dispatchInsufficientCredits,
  INSUFFICIENT_CREDITS_EVENT,
  apiFetch,
} from "./core";

function mockFetch(status: number, body: unknown, headers?: Record<string, string>) {
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("ApiClientError", () => {
  it("exposes status and body", () => {
    const err = new ApiClientError(422, {
      error: "Validation failed",
      code: "validation_error",
      details: null,
    });
    expect(err.status).toBe(422);
    expect(err.message).toBe("Validation failed");
    expect(err.body.code).toBe("validation_error");
    expect(err.name).toBe("ApiClientError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("isInsufficientCreditsError", () => {
  it("returns true for 402 ApiClientError", () => {
    const err = new ApiClientError(402, { error: "Pay up", code: "payment", details: null });
    expect(isInsufficientCreditsError(err)).toBe(true);
  });

  it("returns true for insufficient_credits code", () => {
    const err = new ApiClientError(403, { error: "No credits", code: "insufficient_credits", details: null });
    expect(isInsufficientCreditsError(err)).toBe(true);
  });

  it("returns true for string containing insufficient credits", () => {
    expect(isInsufficientCreditsError("Insufficient credits")).toBe(true);
  });

  it("returns true for Error with insufficient credits message", () => {
    expect(isInsufficientCreditsError(new Error("insufficient credits left"))).toBe(true);
  });

  it("returns false for unrelated values", () => {
    expect(isInsufficientCreditsError(new Error("timeout"))).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
    expect(isInsufficientCreditsError(undefined)).toBe(false);
    expect(isInsufficientCreditsError(42)).toBe(false);
  });
});

describe("dispatchInsufficientCredits", () => {
  it("dispatches a CustomEvent on window", () => {
    const listener = vi.fn();
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, listener);
    dispatchInsufficientCredits();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, listener);
  });
});

describe("apiFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns parsed JSON on success", async () => {
    const data = { id: "1", name: "test" };
    globalThis.fetch = mockFetch(200, data);
    const result = await apiFetch<{ id: string; name: string }>("/api/test");
    expect(result).toEqual(data);
  });

  it("sends Content-Type header by default", async () => {
    const fetchMock = mockFetch(200, {});
    globalThis.fetch = fetchMock;
    await apiFetch("/api/test");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("merges caller options over defaults", async () => {
    const fetchMock = mockFetch(200, {});
    globalThis.fetch = fetchMock;
    await apiFetch("/api/test", { method: "POST", body: '{"a":1}' });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ method: "POST", body: '{"a":1}' }),
    );
  });

  it("returns undefined for 204 No Content", async () => {
    globalThis.fetch = mockFetch(204, null, { "content-length": "0" });
    const result = await apiFetch<void>("/api/test");
    expect(result).toBeUndefined();
  });

  it("returns undefined for content-length 0", async () => {
    globalThis.fetch = mockFetch(200, null, { "content-length": "0" });
    const result = await apiFetch<void>("/api/test");
    expect(result).toBeUndefined();
  });

  it("returns undefined for 202 with null content-length", async () => {
    const h: Record<string, string> = { "content-type": "application/json" };
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: "Accepted",
      headers: { get: (k: string) => h[k.toLowerCase()] ?? null },
      json: () => Promise.resolve(null),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchFn;
    const result = await apiFetch<void>("/api/test");
    expect(result).toBeUndefined();
  });

  it("throws ApiClientError on non-ok response", async () => {
    globalThis.fetch = mockFetch(404, { error: "Not Found", code: "not_found", details: null });
    await expect(apiFetch("/api/missing")).rejects.toThrow(ApiClientError);
    try {
      await apiFetch("/api/missing");
    } catch (e) {
      const err = e as ApiClientError;
      expect(err.status).toBe(404);
      expect(err.body.code).toBe("not_found");
    }
  });

  it("falls back to statusText when error response is not JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: { get: () => null },
      json: () => Promise.reject(new Error("not json")),
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchFn;
    await expect(apiFetch("/api/broken")).rejects.toThrow("Internal Server Error");
  });
});
