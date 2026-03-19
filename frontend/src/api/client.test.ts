import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiClientError,
  isInsufficientCreditsError,
  INSUFFICIENT_CREDITS_EVENT,
  dispatchInsufficientCredits,
  api,
} from "./client";

function mockFetch(status: number, body: unknown, headers?: Record<string, string>) {
  const headerEntries: Record<string, string> = { "content-type": "application/json", ...headers };
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    headers: {
      get: (key: string) => headerEntries[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
  });
}

describe("ApiClientError", () => {
  it("has correct properties", () => {
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
  it("detects ApiClientError with status 402", () => {
    const err = new ApiClientError(402, {
      error: "Payment required",
      code: "payment_required",
      details: null,
    });
    expect(isInsufficientCreditsError(err)).toBe(true);
  });

  it("detects ApiClientError with insufficient_credits code", () => {
    const err = new ApiClientError(403, {
      error: "No credits",
      code: "insufficient_credits",
      details: null,
    });
    expect(isInsufficientCreditsError(err)).toBe(true);
  });

  it("detects string error containing insufficient credits", () => {
    expect(isInsufficientCreditsError("Insufficient credits remaining")).toBe(true);
  });

  it("detects Error with insufficient credits message", () => {
    expect(isInsufficientCreditsError(new Error("insufficient credits"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isInsufficientCreditsError(new Error("timeout"))).toBe(false);
    expect(isInsufficientCreditsError("network failure")).toBe(false);
    expect(isInsufficientCreditsError(null)).toBe(false);
    expect(isInsufficientCreditsError(42)).toBe(false);
  });
});

describe("dispatchInsufficientCredits", () => {
  it("dispatches custom event on window", () => {
    const listener = vi.fn();
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, listener);
    dispatchInsufficientCredits();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, listener);
  });
});

describe("api (via apiFetch)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws ApiClientError on non-ok response", async () => {
    globalThis.fetch = mockFetch(404, { error: "Not Found", code: "not_found", details: null });

    await expect(api.getApiKeyInfo()).rejects.toThrow(ApiClientError);
    try {
      await api.getApiKeyInfo();
    } catch (e) {
      const err = e as ApiClientError;
      expect(err.status).toBe(404);
      expect(err.body.code).toBe("not_found");
    }
  });

  it("returns parsed JSON on success", async () => {
    const payload = { key: "sk-...", provider: "anthropic" };
    globalThis.fetch = mockFetch(200, payload);

    const result = await api.getApiKeyInfo();
    expect(result).toEqual(payload);
  });

  it("returns undefined for 204 No Content", async () => {
    globalThis.fetch = mockFetch(204, null, { "content-length": "0" });

    const result = await api.auth.logout();
    expect(result).toBeUndefined();
  });

  it("sends correct method and body for POST", async () => {
    const fetchMock = mockFetch(200, { id: "org-1", name: "Test" });
    globalThis.fetch = fetchMock;

    await api.orgs.create("Test");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      }),
    );
  });

  it("constructs correct URL for parameterized endpoints", async () => {
    const fetchMock = mockFetch(200, []);
    globalThis.fetch = fetchMock;

    await api.listTasks("proj-123" as string);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj-123/tasks",
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });
});
