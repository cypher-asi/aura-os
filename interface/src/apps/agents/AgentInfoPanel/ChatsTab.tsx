import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import {
  type AnnotatedSession,
  formatDeleteSessionError,
  SessionsList,
  useSessionNavigate,
} from "../../../components/SessionsList";
import {
  agentSessionsSurfaceKey,
  useSessionsDeleteError,
  useSessionsForSurface,
  useSessionsListActions,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import {
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../../stores/chat-history-store";
import { useSelectedAgent } from "../stores";
import { EmptyState } from "../../../components/EmptyState";

/**
 * Agents-app sidekick "Chats" tab. Pulls the active agent from
 * `useSelectedAgent()` and reads its session list from the shared
 * `useSessionsListStore`. The tab no longer takes any props — both
 * the agent and its bindings come from stores so the same panel works
 * whether it is mounted from the agents shell or the marketplace
 * preview.
 */
export function ChatsTab() {
  const { selectedAgent } = useSelectedAgent();
  const agentId = selectedAgent?.agent_id;
  const surfaceKey = agentId ? agentSessionsSurfaceKey(agentId) : undefined;
  const sessions = useSessionsForSurface(surfaceKey);
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const isLoading = useSessionsListStore((s) =>
    surfaceKey ? (s.loadingBySurface[surfaceKey] ?? false) : false,
  );
  const { loadAgentSessions, removeSession, restoreSession, setDeleteError } =
    useSessionsListActions();
  const deleteError = useSessionsDeleteError(surfaceKey);
  const navigateToSession = useSessionNavigate({ agentId: agentId ?? null });
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");

  // Always trigger a fan-out on agent change or version bump. The
  // loader is now self-sufficient: it fetches the authoritative
  // binding list from the server before issuing per-binding session
  // requests, so we no longer gate on a client-derived `bindingsKey`
  // that could never be populated for agents whose only binding lives
  // outside the active-org `useProjectsListStore` snapshot (e.g. the
  // auto-Home project a remote agent gets bound to). Per-surface
  // request-id protection inside the store handles racing fans.
  useEffect(() => {
    if (!agentId) return;
    void loadAgentSessions(agentId);
  }, [agentId, sessionsVersion, loadAgentSessions]);

  const handleSessionClick = useCallback(
    (target: AnnotatedSession) => {
      navigateToSession(target);
    },
    [navigateToSession],
  );

  // Pre-warm the chat-history-store entry for the hovered session so
  // `AgentChatPanel` mounts with `historyResolved=true` and
  // skips the cold-load reveal — eliminating the message-area
  // `.messageContentHidden` flicker on session-row clicks.
  const handleSessionHover = useCallback((target: AnnotatedSession) => {
    void useChatHistoryStore.getState().fetchHistory(
      sessionHistoryKey(
        target._projectId,
        target._agentInstanceId,
        target.session_id,
      ),
      () =>
        api.listSessionEvents(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        ),
    );
  }, []);

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      if (!surfaceKey) return;
      setDeleteError(surfaceKey, null);
      removeSession(surfaceKey, target.session_id);
      api
        .deleteSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((err) => {
          console.error("Failed to delete session", err);
          restoreSession(surfaceKey, target);
          setDeleteError(surfaceKey, formatDeleteSessionError(err));
        });
    },
    [surfaceKey, removeSession, restoreSession, setDeleteError],
  );

  if (!selectedAgent) {
    return <EmptyState>Select an agent to see details</EmptyState>;
  }

  // No `streamKeyForSession` override: agents-app sessions all render
  // through `AgentChatPanel`, which drives `useChatStream` keyed by
  // `(_projectId, _agentInstanceId, session_id)` — the same shape as
  // `SessionsList`'s default `keyForProjectSession` resolver.
  return (
    <SessionsList
      sessions={sessions}
      loading={isLoading}
      selectedSessionId={selectedSessionId}
      onSessionClick={handleSessionClick}
      onSessionHover={handleSessionHover}
      onDeleteSession={handleDelete}
      deleteError={deleteError}
      onDismissError={surfaceKey ? () => setDeleteError(surfaceKey, null) : undefined}
    />
  );
}
