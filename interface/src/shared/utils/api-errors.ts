import { ApiClientError } from "../api/core";

/** Messages the upstream sends that carry no useful information on their own. */
const OPAQUE_UPSTREAM_MESSAGE_PATTERN = /^an internal error occurred\.?$/i;

interface NestedUpstreamError {
  message?: string;
  code?: string;
}

function parseNestedUpstream(body: string): NestedUpstreamError | null {
  try {
    const parsed = JSON.parse(body);
    const inner = parsed?.error;
    if (inner && typeof inner === "object") {
      return {
        message: typeof inner.message === "string" ? inner.message : undefined,
        code: typeof inner.code === "string" ? inner.code : undefined,
      };
    }
  } catch {
    // not nested JSON -- caller falls back
  }
  return null;
}

/**
 * Extract a human-readable message from an API error, handling the
 * nested-JSON shape produced by the aura-network proxy layer.
 *
 * When the upstream returns an opaque message like "An internal error occurred"
 * alongside a code (e.g. `DATABASE`), the code is appended so users see at
 * least one piece of diagnostic context instead of a blind generic message.
 */
export function getApiErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    const nested = parseNestedUpstream(err.body.error);
    if (nested) {
      const msg = nested.message?.replace(/^Bad request: /, "");
      if (msg) {
        if (nested.code && OPAQUE_UPSTREAM_MESSAGE_PATTERN.test(msg)) {
          return `${msg} (${nested.code})`;
        }
        return msg;
      }
    }
    return err.body.error;
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export function getApiErrorDetails(err: unknown): string | null {
  if (err instanceof ApiClientError) {
    const details = err.body.details?.trim();
    return details ? details : null;
  }
  return null;
}

/**
 * Auth-specific variant that maps well-known HTTP status codes to
 * user-facing messages and detects network-level failures.
 */
export function getAuthErrorMessage(err: unknown, hostLabel: string): string {
  if (err instanceof ApiClientError) {
    if (err.status === 401) return "Email or password incorrect.";
    if (err.status === 409) return "An account with that email already exists.";
    if ([502, 503, 504].includes(err.status)) {
      return `Can't reach Aura host at ${hostLabel}. Check the host target and try again.`;
    }
    return err.body.error;
  }

  if (err instanceof Error) {
    if (/fetch|network|load failed/i.test(err.message)) {
      return `Can't reach Aura host at ${hostLabel}. Check the host target and try again.`;
    }
    return err.message;
  }

  return "An unexpected error occurred";
}
