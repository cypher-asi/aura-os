import { useCallback } from "react";
import { api, ApiClientError } from "../../api/client";
import { useSessionsListActions } from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "./session-row-utils";

function formatPinError(pinned: boolean, error: unknown): string {
  const action = pinned ? "pin" : "unpin";
  if (error instanceof ApiClientError) {
    const detail = error.body.error || error.body.code || error.message;
    return `Couldn't ${action} session (${error.status}): ${detail}`;
  }
  if (error instanceof Error && error.message) {
    return `Couldn't ${action} session: ${error.message}`;
  }
  return `Couldn't ${action} session.`;
}

/** Optimistic cross-surface pin mutation shared by every session list. */
export function useSessionPinAction(surfaceKey: string | undefined) {
  const { setSessionPinnedAt, setDeleteError } = useSessionsListActions();

  return useCallback(
    (target: AnnotatedSession, pinned: boolean) => {
      if (!surfaceKey) return;
      const previousPinnedAt = target.pinned_at ?? null;
      const nextPinnedAt = pinned ? new Date().toISOString() : null;
      setDeleteError(surfaceKey, null);
      setSessionPinnedAt(target.session_id, nextPinnedAt);
      void api
        .setSessionPinned(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
          pinned,
        )
        .catch((error) => {
          console.error("Failed to change session pin", error);
          setSessionPinnedAt(target.session_id, previousPinnedAt);
          setDeleteError(surfaceKey, formatPinError(pinned, error));
        });
    },
    [setDeleteError, setSessionPinnedAt, surfaceKey],
  );
}
