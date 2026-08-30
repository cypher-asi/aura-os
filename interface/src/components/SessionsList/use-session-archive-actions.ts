import { useCallback } from "react";
import { api } from "../../api/client";
import {
  useSessionsListActions,
} from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "./session-row-utils";
import { formatSessionActionError } from "./format-delete-error";

/**
 * Shared optimistic archive/restore mutations for all three session-list
 * surfaces. The store patches every loaded copy of a session, while the error
 * banner stays scoped to the list where the action originated.
 */
export function useSessionArchiveActions(surfaceKey: string | undefined) {
  const { setSessionStatus, setDeleteError } = useSessionsListActions();

  const archiveSession = useCallback(
    (target: AnnotatedSession) => {
      if (!surfaceKey) return;
      const previousStatus = target.status;
      setDeleteError(surfaceKey, null);
      setSessionStatus(target.session_id, "archived");
      void api
        .archiveSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((error) => {
          console.error("Failed to archive session", error);
          setSessionStatus(target.session_id, previousStatus);
          setDeleteError(
            surfaceKey,
            formatSessionActionError("archive", error),
          );
        });
    },
    [setDeleteError, setSessionStatus, surfaceKey],
  );

  const restoreArchivedSession = useCallback(
    (target: AnnotatedSession) => {
      if (!surfaceKey) return;
      setDeleteError(surfaceKey, null);
      setSessionStatus(target.session_id, "completed");
      void api
        .restoreArchivedSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((error) => {
          console.error("Failed to restore archived session", error);
          setSessionStatus(target.session_id, "archived");
          setDeleteError(
            surfaceKey,
            formatSessionActionError("restore", error),
          );
        });
    },
    [setDeleteError, setSessionStatus, surfaceKey],
  );

  return { archiveSession, restoreArchivedSession };
}
