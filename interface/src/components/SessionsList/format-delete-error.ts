import { ApiClientError } from "../../shared/api/core";

/**
 * Convert a thrown error from `api.deleteSession` into a short
 * user-facing string for the inline failure banner in
 * [SessionsList](./SessionsList.tsx).
 *
 * Right-click "Delete session" used to fail silently on a 500 — the
 * server's `delete_session` handler in
 * `apps/aura-os-server/src/handlers/agents/sessions.rs` collapsed every
 * non-404 from aura-storage into an opaque `internal_error` and the FE
 * `.catch` only `console.error`d before rolling back the optimistic
 * removal. Now the handler uses `map_storage_error` and preserves the
 * upstream HTTP status, so this helper can read `ApiClientError.status`
 * + `body.error` and render an actionable line like
 * "Couldn't delete session (502): aura-storage timed out".
 *
 * Falls back to `Error.message` and a generic "Couldn't delete
 * session" string for shapes we don't recognize so the banner is
 * always informative even if the network layer returns something
 * unexpected.
 */
export function formatSessionActionError(
  action: "archive" | "restore" | "delete",
  err: unknown,
): string {
  if (err instanceof ApiClientError) {
    const detail = err.body.error || err.body.code || err.message;
    return `Couldn't ${action} session (${err.status}): ${detail}`;
  }
  if (err instanceof Error && err.message) {
    return `Couldn't ${action} session: ${err.message}`;
  }
  return `Couldn't ${action} session.`;
}

export function formatDeleteSessionError(err: unknown): string {
  return formatSessionActionError("delete", err);
}
