import type { SessionStatus } from "../../types";

/**
 * Normalizes a session's status for display purposes.
 *
 * The server creates every session with `status === "active"` and may leave
 * historical sessions in that state (prior to the stale-session retirement
 * fix, or because another client wrote them). Rendering all of those as
 * spinning/in-progress in the sidekick is misleading — only the newest
 * session in a given group is meaningfully "still active".
 */
export function displaySessionStatus(
  status: SessionStatus,
  isNewestInGroup: boolean,
): SessionStatus {
  return status === "active" && !isNewestInGroup ? "completed" : status;
}
