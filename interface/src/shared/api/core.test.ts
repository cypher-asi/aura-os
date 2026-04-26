import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiClientError,
  isInsufficientCreditsError,
  isAgentBusyError,
  isHarnessCapacityExhaustedError,
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

describe("isAgentBusyError", () => {
  it("returns null for unrelated errors", () => {
    expect(isAgentBusyError(null)).toBeNull();
    expect(isAgentBusyError(undefined)).toBeNull();
    expect(isAgentBusyError(42)).toBeNull();
    expect(isAgentBusyError(new Error("timeout"))).toBeNull();
    const unrelated = new ApiClientError(404, {
      error: "Missing",
      code: "not_found",
      details: null,
    });
    expect(isAgentBusyError(unrelated)).toBeNull();
  });

  it("recognizes structured agent_busy and surfaces automaton_id + automation_running reason", () => {
    const err = new ApiClientError(409, {
      error: "Agent is currently running an automation task.",
      code: "agent_busy",
      details: null,
      // The server emits a `data` field alongside the typed ApiError;
      // it is not in the TS interface but `apiFetch` carries it
      // through verbatim.
      // @ts-expect-error — `data` lives on the wire body, not the
      // narrowed TS interface
      data: {
        code: "agent_busy",
        reason: "automation_running",
        automaton_id: "auto-7e3a",
      },
    });
    const info = isAgentBusyError(err);
    expect(info).toEqual({
      reason: "automation_running",
      automaton_id: "auto-7e3a",
    });
  });

  it("recognizes the queue_full sub-reason from structured data", () => {
    const err = new ApiClientError(409, {
      error: "Too many turns queued for this agent.",
      code: "agent_busy",
      details: null,
      // @ts-expect-error — see note above
      data: { code: "agent_busy", reason: "queue_full", automaton_id: null },
    });
    const info = isAgentBusyError(err);
    expect(info?.reason).toBe("queue_full");
    expect(info?.automaton_id).toBeUndefined();
  });

  it("falls back to message substring 'queue full'", () => {
    const err = new ApiClientError(409, {
      error: "queue full: 2 turns already pending",
      code: "agent_busy",
      details: null,
    });
    const info = isAgentBusyError(err);
    expect(info?.reason).toBe("queue_full");
  });

  it("classifies an unspecified agent_busy as automation_running by default", () => {
    const err = new ApiClientError(409, {
      error: "Agent is currently running another turn. Please wait.",
      code: "agent_busy",
      details: null,
    });
    const info = isAgentBusyError(err);
    expect(info?.reason).toBe("automation_running");
  });

  it("falls back to harness raw-string for older server builds (string error)", () => {
    expect(
      isAgentBusyError("A turn is currently in progress; send cancel first"),
    ).toEqual({ reason: "automation_running" });
  });

  it("falls back to harness raw-string for older server builds (Error.message)", () => {
    const err = new Error(
      "harness reported: A turn is currently in progress; send cancel first",
    );
    expect(isAgentBusyError(err)).toEqual({ reason: "automation_running" });
  });

  it("falls back to harness raw-string when ApiClientError carries the legacy text under a non-agent_busy code", () => {
    const err = new ApiClientError(500, {
      error: "A turn is currently in progress; send cancel first",
      code: "internal_error",
      details: null,
    });
    expect(isAgentBusyError(err)).toEqual({ reason: "automation_running" });
  });

  it("is case-insensitive on the harness raw-string match", () => {
    expect(
      isAgentBusyError("ERROR: SEND CANCEL FIRST before continuing"),
    ).toEqual({ reason: "automation_running" });
  });

  it("returns truthy in boolean position so legacy `if (isAgentBusyError(e))` callers keep working", () => {
    const err = new ApiClientError(409, {
      error: "Agent is busy",
      code: "agent_busy",
      details: null,
    });
    if (isAgentBusyError(err)) {
      // type narrowed to AgentBusyErrorInfo
    } else {
      throw new Error("expected truthy");
    }
  });
});

describe("isHarnessCapacityExhaustedError", () => {
  it("returns null for unrelated values", () => {
    expect(isHarnessCapacityExhaustedError(null)).toBeNull();
    expect(isHarnessCapacityExhaustedError(undefined)).toBeNull();
    expect(isHarnessCapacityExhaustedError(42)).toBeNull();
    expect(
      isHarnessCapacityExhaustedError(new Error("upstream is busy")),
    ).toBeNull();
    const unrelated = new ApiClientError(503, {
      error: "service down",
      code: "service_unavailable",
      details: null,
    });
    expect(isHarnessCapacityExhaustedError(unrelated)).toBeNull();
  });

  it("recognizes the structured 503 and surfaces configured_cap + retry_after_seconds", () => {
    const err = new ApiClientError(503, {
      error:
        "Harness is at its concurrent-session limit (96). Please retry in a moment.",
      code: "harness_capacity_exhausted",
      details: null,
      // @ts-expect-error — `data` lives on the wire body, not the
      // narrowed TS interface
      data: {
        code: "harness_capacity_exhausted",
        configured_cap: 96,
        retry_after_seconds: 5,
      },
    });
    const info = isHarnessCapacityExhaustedError(err);
    expect(info).toEqual({ configured_cap: 96, retry_after_seconds: 5 });
  });

  it("tolerates a missing structured `data` (older server build)", () => {
    const err = new ApiClientError(503, {
      error: "Harness is at its concurrent-session limit. Please retry.",
      code: "harness_capacity_exhausted",
      details: null,
    });
    const info = isHarnessCapacityExhaustedError(err);
    expect(info).not.toBeNull();
    expect(info?.configured_cap).toBeUndefined();
    expect(info?.retry_after_seconds).toBeUndefined();
  });

  it("ignores non-ApiClientError thrown values to avoid false positives", () => {
    expect(
      isHarnessCapacityExhaustedError("Server is busy — try again."),
    ).toBeNull();
  });

  it("returns truthy in boolean position so `if (info = isHarnessCapacityExhaustedError(e))` callers narrow", () => {
    const err = new ApiClientError(503, {
      error: "Harness is at its concurrent-session limit (128).",
      code: "harness_capacity_exhausted",
      details: null,
    });
    if (isHarnessCapacityExhaustedError(err)) {
      // type narrowed to HarnessCapacityExhaustedInfo
    } else {
      throw new Error("expected truthy");
    }
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
