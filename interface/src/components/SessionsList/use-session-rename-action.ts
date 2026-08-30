import { useCallback } from "react";
import { api } from "../../api/client";
import { useSessionsListActions } from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "./session-row-utils";
import { formatSessionActionError } from "./format-delete-error";

/** Optimistic, cross-surface session-title mutation shared by every list. */
export function useSessionRenameAction(surfaceKey: string | undefined) {
  const { setSessionSummary, setDeleteError } = useSessionsListActions();

  return useCallback(
    (target: AnnotatedSession, title: string) => {
      if (!surfaceKey) return;
      const normalized = title.trim();
      if (!normalized) return;
      const previousTitle = target.summary_of_previous_context;
      setDeleteError(surfaceKey, null);
      setSessionSummary(target.session_id, normalized);
      void api
        .renameSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
          normalized,
        )
        .catch((error) => {
          console.error("Failed to rename session", error);
          setSessionSummary(target.session_id, previousTitle);
          setDeleteError(
            surfaceKey,
            formatSessionActionError("rename", error),
          );
        });
    },
    [setDeleteError, setSessionSummary, surfaceKey],
  );
}
