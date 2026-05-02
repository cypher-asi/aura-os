import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClientError } from "./core";
import { streamSSE } from "./sse";
import type { SSECallbacks } from "./sse";

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

function makeReader(chunks: string[]) {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    read: vi.fn(async () => {
      if (i >= chunks.length) return { done: true as const, value: undefined };
      const value = encoder.encode(chunks[i++]);
      return { done: false as const, value };
    }),
    cancel: vi.fn(async () => {}),
  };
}

function mockSSEFetch(
  status: number,
  chunks: string[],
  ok = status >= 200 && status < 300,
  contentType = "text/event-stream",
) {
  const reader = makeReader(chunks);
  return {
    fetchFn: vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === "content-type" ? contentType : null,
        ),
      },
      text: () => Promise.resolve(chunks.join("")),
      body: ok ? { getReader: () => reader } : null,
    }) as unknown as typeof globalThis.fetch,
    reader,
  };
}

describe("streamSSE", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = window.localStorage;
  const HOST_STORAGE_KEY = "aura-host-origin";
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

  it("parses SSE frames and calls onEvent", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      'event: delta\ndata: {"text":"hello"}\n\n',
      'event: done\ndata: {"ok":true}\n\n',
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"delta" | "done"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", { method: "POST" }, callbacks);

    expect(callbacks.onEvent).toHaveBeenCalledTimes(2);
    expect(callbacks.onEvent).toHaveBeenCalledWith("delta", { text: "hello" });
    expect(callbacks.onEvent).toHaveBeenCalledWith("done", { ok: true });
    expect(callbacks.onDone).toHaveBeenCalledOnce();
  });

  it("handles split frames across chunks", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      "event: delta\n",
      'data: {"text":"hi"}\n\n',
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"delta"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onEvent).toHaveBeenCalledWith("delta", { text: "hi" });
  });

  it("supports CRLF-delimited frames and trailing unterminated buffers", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      'event: delta\r\ndata: {"text":"hi"}\r\n\r\n',
      'event: done\r\ndata: {"ok":true}',
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"delta" | "done"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);

    expect(callbacks.onEvent).toHaveBeenCalledTimes(2);
    expect(callbacks.onEvent).toHaveBeenNthCalledWith(1, "delta", { text: "hi" });
    expect(callbacks.onEvent).toHaveBeenNthCalledWith(2, "done", { ok: true });
  });

  it("joins multiple data lines using SSE semantics", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      "event: info\ndata: first line\ndata: second line\n\n",
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"info"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);

    expect(callbacks.onEvent).toHaveBeenCalledWith("info", "first line\nsecond line");
  });

  it("parses data fields without a required space after the colon", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      'event: delta\ndata:{"text":"hello"}\n\n',
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"delta"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);

    expect(callbacks.onEvent).toHaveBeenCalledWith("delta", { text: "hello" });
  });

  it("calls onError for non-ok response with JSON error body", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      statusText: "Payment Required",
      text: () => Promise.resolve(JSON.stringify({ error: "billing server error", code: "insufficient_credits", details: null })),
      body: null,
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<string> = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = (callbacks.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.message).toBe("billing server error");
    expect(err.status).toBe(402);
    expect(err.body.code).toBe("insufficient_credits");
  });

  it("calls onError for non-ok response with plain text", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("Bad Gateway"),
      body: null,
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<string> = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onError).toHaveBeenCalledOnce();
    const errMsg = (callbacks.onError as ReturnType<typeof vi.fn>).mock.calls[0][0].message as string;
    expect(errMsg).toContain("502");
  });

  it("calls onError when fetch throws (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network down")) as unknown as typeof globalThis.fetch;

    const callbacks: SSECallbacks<string> = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect((callbacks.onError as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toBe(
      "Failed to fetch SSE GET /api/stream: Network down",
    );
  });

  it("does not call onError when fetch throws and signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")) as unknown as typeof globalThis.fetch;

    const callbacks: SSECallbacks<string> = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks, controller.signal);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("calls onError when response body is null", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === "content-type" ? "text/event-stream" : null,
        ),
      },
      body: null,
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<string> = {
      onEvent: vi.fn(),
      onError: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect((callbacks.onError as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toBe("Response body is null");
  });

  it("calls onError when the response is not an SSE stream", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: vi.fn((name: string) =>
          name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
        ),
      },
      text: () => Promise.resolve("<!doctype html><html><body>not the api</body></html>"),
      body: { getReader: () => makeReader([]) },
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<string> = {
      onEvent: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect((callbacks.onError as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toContain(
      "Expected an SSE response but received text/html; charset=utf-8",
    );
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });

  it("passes non-JSON data as string to onEvent", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      "event: info\ndata: plain-text\n\n",
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"info"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onEvent).toHaveBeenCalledWith("info", "plain-text");
  });

  it("skips frames without both event and data", async () => {
    const { fetchFn } = mockSSEFetch(200, [
      "event: ping\n\n",
      'event: delta\ndata: {"x":1}\n\n',
    ]);
    globalThis.fetch = fetchFn;

    const callbacks: SSECallbacks<"ping" | "delta"> = {
      onEvent: vi.fn(),
      onDone: vi.fn(),
    };

    await streamSSE("/api/stream", {}, callbacks);
    expect(callbacks.onEvent).toHaveBeenCalledTimes(1);
    expect(callbacks.onEvent).toHaveBeenCalledWith("delta", { x: 1 });
  });

  it("passes auth headers and signal to fetch", async () => {
    const controller = new AbortController();
    const { fetchFn } = mockSSEFetch(200, []);
    globalThis.fetch = fetchFn;

    await streamSSE("/api/stream", { method: "POST" }, { onEvent: vi.fn() }, controller.signal);

    expect(fetchFn).toHaveBeenCalledWith(
      "/api/stream",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Object),
        signal: controller.signal,
      }),
    );
    expect(fetchFn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("uses the configured host origin for SSE requests", async () => {
    window.localStorage.setItem(HOST_STORAGE_KEY, "http://aura.test");
    const { fetchFn } = mockSSEFetch(200, []);
    globalThis.fetch = fetchFn;

    await streamSSE("/api/stream", { method: "POST" }, { onEvent: vi.fn() });

    expect(fetchFn).toHaveBeenCalledWith(
      "http://aura.test/api/stream",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
