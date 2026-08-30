import { useCallback, useEffect, useMemo } from "react";
import { useProjectActions } from "../../stores/project-action-store";
import {
  projectSessionsSurfaceKey,
  useSessionsDeleteError,
  useSessionsForSurface,
  useSessionsListActions,
  useSessionsListStore,
} from "../../stores/sessions-list-store";
import type { AnnotatedSession } from "../../components/SessionsList";

interface SessionListData {
  surfaceKey: string | undefined;
  sessions: AnnotatedSession[];
  sessionById: Map<string, AnnotatedSession>;
  loading: boolean;
  removeSession: (sessionId: string) => void;
  restoreSession: (session: AnnotatedSession) => void;
  /**
   * Most-recent failed-delete message for this project surface, or
   * `null`. Used by [SessionList](./SessionList.tsx) to drive the
   * inline error banner so a 500 from the DELETE endpoint is visible
   * to the user instead of vanishing into `console.error`.
   */
  deleteError: string | null;
  setDeleteError: (message: string | null) => void;
}

/**
 * Project-app data source for the shared `SessionsList`. Subscribes to
 * the shared `useSessionsListStore` (which the agents `ChatsTab` and
 * the default-session redirects also consume) and triggers a refetch
 * on every `version` bump — the same write-side signal the chat
 * stream sends when a new session is persisted server-side. No more
 * 5-second polling: writes drive reads.
 */
export function useSessionListData(): SessionListData {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const projectName = ctx?.project.name ?? "";
  const surfaceKey = projectId ? projectSessionsSurfaceKey(projectId) : undefined;
  const sessions = useSessionsForSurface(surfaceKey);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const loading = useSessionsListStore((s) =>
    surfaceKey ? (s.loadingBySurface[surfaceKey] ?? false) : false,
  );
  const {
    loadProjectSessions,
    removeSession: storeRemoveSession,
    restoreSession: storeRestoreSession,
    setDeleteError: storeSetDeleteError,
  } = useSessionsListActions();
  const deleteError = useSessionsDeleteError(surfaceKey);

  useEffect(() => {
    if (!projectId) return;
    void loadProjectSessions(projectId, projectName);
  }, [projectId, projectName, sessionsVersion, loadProjectSessions]);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const removeSession = useCallback(
    (sessionId: string) => {
      if (!surfaceKey) return;
      storeRemoveSession(surfaceKey, sessionId);
    },
    [surfaceKey, storeRemoveSession],
  );

  const restoreSession = useCallback(
    (session: AnnotatedSession) => {
      if (!surfaceKey) return;
      storeRestoreSession(surfaceKey, session);
    },
    [surfaceKey, storeRestoreSession],
  );

  const setDeleteError = useCallback(
    (message: string | null) => {
      if (!surfaceKey) return;
      storeSetDeleteError(surfaceKey, message);
    },
    [surfaceKey, storeSetDeleteError],
  );

  return {
    surfaceKey,
    sessions,
    sessionById,
    loading,
    removeSession,
    restoreSession,
    deleteError,
    setDeleteError,
  };
}
