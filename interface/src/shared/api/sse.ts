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

function parseSSEFrame(frame: string): { eventType: string; data: string | null } {
  let eventType = "";
  const dataLines: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;

    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
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
  };
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

export async function streamSSE<T extends string>(
  url: string,
  init: RequestInit,
  callbacks: SSECallbacks<T>,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(url), {
      ...init,
      headers: { ...authHeaders(), ...(init.headers as Record<string, string>) },
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const body = parseApiErrorBody(text);
    const err = body
      ? new ApiClientError(response.status, body)
      : new Error(`SSE request failed (${response.status}): ${text}`);
    callbacks.onError?.(err);
    return;
  }

  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes(SSE_CONTENT_TYPE)) {
    const text = await response.text().catch(() => "");
    const preview = text.trim().slice(0, 200);
    const suffix = preview ? `: ${preview}` : "";
    callbacks.onError?.(
      new Error(`Expected an SSE response but received ${contentType}${suffix}`),
    );
    return;
  }

  const body = response.body;
  if (!body) {
    callbacks.onError?.(new Error("Response body is null"));
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
        if (!frame.trim()) continue;
        const { eventType, data } = parseSSEFrame(frame);
        if (!data) continue;

        try {
          callbacks.onEvent(eventType as T, JSON.parse(data));
        } catch {
          callbacks.onEvent(eventType as T, data);
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    reader.cancel().catch(() => {});
    return;
  }

  const trailingFrame = buffer.trim();
  if (trailingFrame) {
    const { eventType, data } = parseSSEFrame(trailingFrame);
    if (data) {
      try {
        callbacks.onEvent(eventType as T, JSON.parse(data));
      } catch {
        callbacks.onEvent(eventType as T, data);
      }
    }
  }

  callbacks.onDone?.();
}
