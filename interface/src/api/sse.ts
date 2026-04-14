import { authHeaders } from "../lib/auth-token";
import type { ApiError } from "../types";
import { ApiClientError } from "./core";

export interface SSECallbacks<T extends string> {
  onEvent: (eventType: T, data: unknown) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

const IDLE_TIMEOUT_MS = 90_000;

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
    response = await fetch(url, {
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
        (_, reject) => setTimeout(() => reject(new Error("SSE idle timeout")), IDLE_TIMEOUT_MS),
      );
      const { done, value } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.trim()) continue;

        let eventType = "";
        let data = "";

        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            data = line.slice(6).trim();
          }
        }

        if (eventType && data) {
          try {
            callbacks.onEvent(eventType as T, JSON.parse(data));
          } catch {
            callbacks.onEvent(eventType as T, data);
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    reader.cancel().catch(() => {});
    return;
  }

  callbacks.onDone?.();
}
