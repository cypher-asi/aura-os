import { ApiClientError } from "../api/core";

/**
 * Extract a human-readable message from an API error, handling the
 * nested-JSON shape produced by the aura-network proxy layer.
 */
export function getApiErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    try {
      const nested = JSON.parse(err.body.error);
      const msg = nested?.error?.message?.replace(/^Bad request: /, "");
      if (msg) return msg;
    } catch {
      // not nested JSON -- fall through
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
