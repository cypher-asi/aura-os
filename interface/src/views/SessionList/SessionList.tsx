import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { buildProjectSessionHistoryFetch } from "../../hooks/use-load-older-messages";
import {
  type AnnotatedSession,
  formatDeleteSessionError,
  SessionsList,
  useSessionArchiveActions,
  useSessionRenameAction,
  useSessionNavigate,
} from "../../components/SessionsList";
import {
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../stores/chat-history-store";
import { useSessionListData } from "./useSessionListData";

/**
 * Project-app sidekick "Sessions" tab. Wires the shared `SessionsList`
 * (date-bucketed buttons, summaries, selected-row highlight) to the
 * project-scoped data source. Clicks reuse the same navigator the
 * agents `ChatsTab` uses, so behavior is identical across both apps.
 */
export function SessionList({ searchQuery }: { searchQuery: string }) {
  const {
    surfaceKey,
    sessions,
    loading,
    removeSession,
    restoreSession,
    deleteError,
    setDeleteError,
  } = useSessionListData();
  const { archiveSession, restoreArchivedSession } =
    useSessionArchiveActions(surfaceKey);
  const renameSession = useSessionRenameAction(surfaceKey);
  const handleSessionClick = useSessionNavigate({ agentId: null });
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      setDeleteError(null);
      removeSession(target.session_id);
      api
        .deleteSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((err) => {
          console.error("Failed to delete session", err);
          restoreSession(target);
          setDeleteError(formatDeleteSessionError(err));
        });
    },
    [removeSession, restoreSession, setDeleteError],
  );

  const handleDismissError = useCallback(
    () => setDeleteError(null),
    [setDeleteError],
  );

  // Pre-warm the chat-history-store entry for the hovered session so the
  // ChatPanel mounts on a `historyResolved=true` first render and skips
  // the cold-load reveal cycle. Mirrors the agents-app `ChatsTab` hover
  // handler — the underlying store and key shape are shared.
  const handleSessionHover = useCallback((target: AnnotatedSession) => {
    void useChatHistoryStore.getState().fetchHistory(
      sessionHistoryKey(
        target._projectId,
        target._agentInstanceId,
        target.session_id,
      ),
      buildProjectSessionHistoryFetch(
        target._projectId,
        target._agentInstanceId,
        target.session_id,
      ),
    );
  }, []);

  return (
    <SessionsList
      sessions={sessions}
      loading={loading}
      selectedSessionId={selectedSessionId}
      onSessionClick={handleSessionClick}
      onSessionHover={handleSessionHover}
      onDeleteSession={handleDelete}
      onArchiveSession={archiveSession}
      onRestoreSession={restoreArchivedSession}
      onRenameSession={renameSession}
      searchQuery={searchQuery}
      deleteError={deleteError}
      onDismissError={handleDismissError}
    />
  );
}
