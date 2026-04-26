import type { ApiError } from "../types";
import { authHeaders } from "../../shared/lib/auth-token";
import { resolveApiUrl } from "../../shared/lib/host-config";

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
 * Sub-reason for an `agent_busy` error returned by the chat / stream
 * routes:
 * - `"queue_full"` — Phase 3: more than the bounded number of turns
 *   are queued behind the in-flight turn on the same partition; the
 *   UI should ask the user to wait rather than imply a conflict.
 * - `"automation_running"` — Phase 2: an automation loop / single-task
 *   automaton is holding the upstream harness turn-lock for this
 *   agent. The UI should offer to stop that automaton to chat.
 * - `"unknown"` — `agent_busy` was reported but the server didn't
 *   include a structured reason and no recognized substring matched.
 */
export type AgentBusyReasonCode = "queue_full" | "automation_running" | "unknown";

export interface AgentBusyErrorInfo {
  reason: AgentBusyReasonCode;
  automaton_id?: string;
}

/**
 * Substring matched against the legacy harness raw-message wording
 * "A turn is currently in progress; send cancel first" — kept so older
 * server builds (or rare paths that bypass the Phase-2 SSE remap) still
 * surface a clean agent_busy error to the UI during rollout.
 */
const HARNESS_TURN_IN_PROGRESS_FRAGMENTS = [
  "turn is currently in progress",
  "send cancel first",
] as const;

function matchHarnessTurnInProgress(message: string): boolean {
  const lower = message.toLowerCase();
  return HARNESS_TURN_IN_PROGRESS_FRAGMENTS.some((fragment) =>
    lower.includes(fragment),
  );
}

function classifyAgentBusyReason(
  reasonHint: string | null | undefined,
  message: string | null | undefined,
  fallback: AgentBusyReasonCode,
): AgentBusyReasonCode {
  const reason = (reasonHint ?? "").toLowerCase();
  if (reason === "queue_full") return "queue_full";
  if (reason === "automation_running") return "automation_running";
  const messageLower = (message ?? "").toLowerCase();
  if (messageLower.includes("queue full")) return "queue_full";
  if (messageLower.includes("automation")) return "automation_running";
  return fallback;
}

/**
 * Inspect a thrown error from any chat / stream HTTP call and decide
 * whether it is the structured "agent is busy" rejection emitted by
 * `ApiError::agent_busy` (Phase 2 / Phase 3). Returns `null` when the
 * error is something else.
 *
 * Both the legacy bare-agent route (`/api/agents/:id/events/stream`)
 * and the project-scoped instance route
 * (`/api/projects/:pid/agents/:aid/events/stream`) return the same
 * shape after Phase 2, so the detection here is uniform.
 *
 * The returned object surfaces:
 * - `automaton_id` when the server pinpointed which automaton owns the
 *   upstream turn (consumers can then render a "Stop the loop to chat"
 *   button targeted at that automaton).
 * - `reason` distinguishing the Phase-3 "queue_full" condition (more
 *   than the bounded number of pending turns) from the Phase-2
 *   "automation_running" condition, so the UI can show "Too many turns
 *   queued — wait a moment" vs the automation-conflict copy.
 *
 * Falls back to a case-insensitive substring match on the raw harness
 * "turn is currently in progress / send cancel first" message so
 * pre-Phase-2 server builds still surface a clean `agent_busy`
 * during rollout.
 */
export function isAgentBusyError(err: unknown): AgentBusyErrorInfo | null {
  if (err instanceof ApiClientError) {
    if (err.body.code === "agent_busy") {
      const data = (err.body as { data?: unknown }).data as
        | { automaton_id?: unknown; reason?: unknown }
        | null
        | undefined;
      const automatonId =
        typeof data?.automaton_id === "string" && data.automaton_id.length > 0
          ? data.automaton_id
          : undefined;
      const reasonHint =
        typeof data?.reason === "string" ? data.reason : undefined;
      // A typed `agent_busy` error from the server is, by Phase 2's
      // contract, always an automation/turn-lock conflict unless it
      // explicitly says otherwise. Default unclassified ones to
      // `automation_running` so the UI never falls into the
      // ambiguous `"unknown"` branch on a real busy response.
      return {
        reason: classifyAgentBusyReason(
          reasonHint,
          err.body.error,
          "automation_running",
        ),
        automaton_id: automatonId,
      };
    }
    if (matchHarnessTurnInProgress(err.body.error ?? "")) {
      return { reason: "automation_running" };
    }
    return null;
  }
  if (typeof err === "string") {
    return matchHarnessTurnInProgress(err)
      ? { reason: "automation_running" }
      : null;
  }
  if (err instanceof Error) {
    return matchHarnessTurnInProgress(err.message)
      ? { reason: "automation_running" }
      : null;
  }
  return null;
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
