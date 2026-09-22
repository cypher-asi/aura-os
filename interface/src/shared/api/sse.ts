import { authHeaders } from "../../shared/lib/auth-token";
import { resolveApiUrl } from "../../shared/lib/host-config";
import type { ApiError } from "../types";
import { ApiClientError } from "./core";

export interface SSECallbacks<T extends string> {
  onEvent: (eventType: T, data: unknown) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

const IDLE_TIMEOUT_MS = 90_000;
const SSE_CONTENT_TYPE = "text/event-stream";

/**
 * Thrown when the SSE reader has not received any bytes for
 * `IDLE_TIMEOUT_MS`. The harness side already attaches an Axum
 * `KeepAlive`, so seeing this almost always means a proxy is buffering
 * the response or the upstream broadcast channel got wedged. The chat
 * UI uses the `name` to surface a "stream dropped" banner with a retry
 * hint instead of inlining `*Error: SSE idle timeout*` in the trailing
 * assistant bubble.
 */
export class SSEIdleTimeoutError extends Error {
  constructor() {
    super("SSE idle timeout");
    this.name = "SSEIdleTimeoutError";
  }
}

function parseSSEFrame(frame: string): {
  eventType: string;
  data: string | null;
  id: string | null;
} {
  let eventType = "";
  let id: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;

    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  return {
    eventType: eventType || "message",
    data: dataLines.length > 0 ? dataLines.join("\n") : null,
    id,
  };
}

/** Set or replace the `since` query parameter on an SSE attach URL. */
function withSince(url: string, since: string): string {
  try {
    // `url` may be relative; resolve against a dummy base so URL parsing
    // works, then strip the base back off.
    const u = new URL(url, "http://_resolve_");
    u.searchParams.set("since", since);
    const out = `${u.pathname}${u.search}${u.hash}`;
    return u.origin === "http://_resolve_" ? out : u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    const stripped = url.replace(/([?&])since=[^&]*(&|$)/, "$1").replace(/[?&]$/, "");
    const sep2 = stripped.includes("?") ? "&" : "?";
    void sep;
    return `${stripped}${sep2}since=${encodeURIComponent(since)}`;
  }
}

function parseApiErrorBody(text: string): ApiError | null {
  try {
    const body = JSON.parse(text) as Partial<ApiError>;
    if (typeof body.error !== "string") return null;
    return {
      error: body.error,
      code: typeof body.code === "string" ? body.code : "unknown",
      details: typeof body.details === "string" || body.details === null
        ? body.details
        : null,
    };
  } catch {
    return null;
  }
}

/** Opt-in resume behaviour for {@link streamSSE}. */
export interface StreamSSEOptions {
  /**
   * Called once the response has passed HTTP and content-type validation,
   * before the first event is read. POST callers use this boundary as an
   * acknowledgement that the server accepted and persisted a command.
   */
  onResponse?: (response: Response) => void;
  /**
   * When true, a recoverable close (idle timeout or transport drop —
   * NOT an HTTP error or an abort) is retried by re-issuing the request
   * with `?since=<lastEventId>` appended, resuming the same `onEvent`
   * stream without surfacing an error. Only safe for idempotent GET
   * attach endpoints (`/api/streams/:id`), never for POST start calls
   * that have side effects.
   */
  resumable?: boolean;
  /** Max resume attempts before giving up and calling `onError`. */
  maxRetries?: number;
  /**
   * Invoked with the numeric value of each SSE `id:` line as it is
   * parsed. The reattach path (`/api/streams/:id`) uses the harness
   * frame `seq` as the `id:`, so this lets a caller persist the last
   * delivered cursor (e.g. onto the partition send-control) and resume
   * from exactly there on a later reattach. Non-numeric ids are
   * ignored. Fired before resume bookkeeping, on the same tick the
   * frame's `id:` is seen.
   */
  onSeq?: (seq: number) => void;
}

type RunOutcome =
  | { kind: "done" }
  | { kind: "aborted" }
  | { kind: "error"; error: Error; recoverable: boolean };

/** A single fetch + read pass. Reports an outcome; never invokes
 *  `onError` / `onDone` itself so the caller can orchestrate resume. */
async function runSSEOnce<T extends string>(
  url: string,
  init: RequestInit,
  onEvent: SSECallbacks<T>["onEvent"],
  onId: (id: string) => void,
  signal?: AbortSignal,
  onResponse?: (response: Response) => void,
): Promise<RunOutcome> {
  let response: Response;
  const resolvedUrl = resolveApiUrl(url);
  try {
    response = await fetch(resolvedUrl, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers as Record<string, string>) },
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return { kind: "aborted" };
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "error",
      error: new Error(`Failed to fetch SSE ${init.method ?? "GET"} ${resolvedUrl}: ${message}`),
      recoverable: true,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const body = parseApiErrorBody(text);
    const err = body
      ? new ApiClientError(response.status, body)
      : new Error(`SSE request failed (${response.status}): ${text}`);
    return { kind: "error", error: err, recoverable: false };
  }

  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes(SSE_CONTENT_TYPE)) {
    const text = await response.text().catch(() => "");
    const preview = text.trim().slice(0, 200);
    const suffix = preview ? `: ${preview}` : "";
    return {
      kind: "error",
      error: new Error(`Expected an SSE response but received ${contentType}${suffix}`),
      recoverable: false,
    };
  }

  try {
    onResponse?.(response);
  } catch (err) {
    return {
      kind: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      recoverable: false,
    };
  }

  const body = response.body;
  if (!body) {
    return { kind: "error", error: new Error("Response body is null"), recoverable: false };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatchFrame = (frame: string) => {
    if (!frame.trim()) return;
    const { eventType, data, id } = parseSSEFrame(frame);
    if (id) onId(id);
    if (!data) return;
    try {
      onEvent(eventType as T, JSON.parse(data));
    } catch {
      onEvent(eventType as T, data);
    }
  };

  try {
    while (true) {
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ done: true; value: undefined }>(
        (_, reject) => setTimeout(() => reject(new SSEIdleTimeoutError()), IDLE_TIMEOUT_MS),
      );
      const { done, value } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        dispatchFrame(frame);
      }
    }
  } catch (err) {
    if (signal?.aborted) return { kind: "aborted" };
    reader.cancel().catch(() => {});
    return {
      kind: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      // Idle timeout / mid-stream read failure: the run may still be
      // alive server-side, so this is resumable for attach endpoints.
      recoverable: true,
    };
  }

  const trailingFrame = buffer.trim();
  if (trailingFrame) dispatchFrame(trailingFrame);

  return { kind: "done" };
}

export async function streamSSE<T extends string>(
  url: string,
  init: RequestInit,
  callbacks: SSECallbacks<T>,
  signal?: AbortSignal,
  options?: StreamSSEOptions,
): Promise<void> {
  const resumable = options?.resumable ?? false;
  const maxRetries = options?.maxRetries ?? 5;
  let lastId: string | null = null;
  let attempt = 0;

  while (true) {
    const target = resumable && lastId != null ? withSince(url, lastId) : url;
    const outcome = await runSSEOnce<T>(
      target,
      init,
      callbacks.onEvent,
      (id) => {
        lastId = id;
        if (options?.onSeq) {
          const seq = Number(id);
          if (Number.isFinite(seq)) options.onSeq(seq);
        }
      },
      signal,
      options?.onResponse,
    );

    if (outcome.kind === "aborted") return;
    if (outcome.kind === "done") {
      callbacks.onDone?.();
      return;
    }

    // outcome.kind === "error"
    if (outcome.recoverable && resumable && attempt < maxRetries && !signal?.aborted) {
      attempt += 1;
      const backoffMs = Math.min(500 * attempt, 5000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      if (signal?.aborted) return;
      continue;
    }

    callbacks.onError?.(outcome.error);
    return;
  }
}
