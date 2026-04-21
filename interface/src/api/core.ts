import type { ApiError } from "../types";
import { authHeaders } from "../lib/auth-token";
import { resolveApiUrl } from "../lib/host-config";

export class ApiClientError extends Error {
  status: number;
  body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.error);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}

export const INSUFFICIENT_CREDITS_EVENT = "insufficient-credits";

export function isInsufficientCreditsError(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.status === 402 || err.body.code === "insufficient_credits";
  }
  if (typeof err === "string") {
    return err.toLowerCase().includes("insufficient credits");
  }
  if (err instanceof Error) {
    return err.message.toLowerCase().includes("insufficient credits");
  }
  return false;
}

/**
 * True when the chat request was rejected because the upstream agent
 * is already running a turn (typically because an automation loop is
 * running on the same agent id). Returned from
 * `POST /api/projects/:pid/agents/:aid/events/stream` as a typed
 * `409 agent_busy` — frontends branch on this to render a dedicated
 * "stop the automation to chat" affordance instead of surfacing the
 * raw harness text.
 */
export function isAgentBusyError(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.body.code === "agent_busy";
  }
  return false;
}

export function dispatchInsufficientCredits(): void {
  window.dispatchEvent(new CustomEvent(INSUFFICIENT_CREDITS_EVENT));
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(path), {
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...options,
  });
  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      error: res.statusText,
      code: "unknown",
      details: null,
    }));
    throw new ApiClientError(res.status, err);
  }
  const contentLength = res.headers.get("content-length");
  if (
    res.status === 204 ||
    contentLength === "0" ||
    (contentLength === null && res.status === 202)
  ) {
    return undefined as T;
  }
  return res.json();
}

export async function apiFetchText(path: string, options?: RequestInit): Promise<string> {
  const res = await fetch(resolveApiUrl(path), {
    headers: { ...authHeaders() },
    ...options,
  });
  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      error: res.statusText,
      code: "unknown",
      details: null,
    }));
    throw new ApiClientError(res.status, err);
  }
  return res.text();
}
