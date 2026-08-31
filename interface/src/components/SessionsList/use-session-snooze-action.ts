import { useCallback } from "react";
import { api, ApiClientError } from "../../api/client";
import { useSessionsListActions } from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "./session-row-utils";

function formatSnoozeError(waking: boolean, error: unknown): string {
  const action = waking ? "wake" : "snooze";
  if (error instanceof ApiClientError) {
    const detail = error.body.error || error.body.code || error.message;
    return `Couldn't ${action} session (${error.status}): ${detail}`;
  }
  if (error instanceof Error && error.message) {
    return `Couldn't ${action} session: ${error.message}`;
  }
  return `Couldn't ${action} session.`;
}

/** Optimistic, cross-surface session snooze mutation. */
export function useSessionSnoozeAction(surfaceKey: string | undefined) {
  const { setSessionSnoozedUntil, setDeleteError } = useSessionsListActions();

  return useCallback(
    (target: AnnotatedSession, snoozedUntil: string | null) => {
      if (!surfaceKey) return;
      const previous = target.snoozed_until ?? null;
      setDeleteError(surfaceKey, null);
      setSessionSnoozedUntil(target.session_id, snoozedUntil);
      void api
        .setSessionSnoozedUntil(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
          snoozedUntil,
        )
        .catch((error) => {
          console.error("Failed to change session snooze", error);
          setSessionSnoozedUntil(target.session_id, previous);
          setDeleteError(
            surfaceKey,
            formatSnoozeError(snoozedUntil === null, error),
          );
        });
    },
    [setDeleteError, setSessionSnoozedUntil, surfaceKey],
  );
}
