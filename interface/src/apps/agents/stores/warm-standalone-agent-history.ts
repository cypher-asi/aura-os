import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../../../api/client";
import {
  agentHistoryKey,
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../../stores/chat-history-store";
import {
  agentSessionsSurfaceKey,
  findMostRecentRealSession,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";

/**
 * Pre-warm the chat-history-store entries a standalone agent chat reads so
 * `ChatPanel`'s cold-load gate (`.messageContentHidden` + the fading overlay)
 * does not arm when we navigate to `/agents/:agentId`.
 *
 * Two slots are warmed because the surface walks through both:
 *   1. `agentHistoryKey(agentId)` — the agent-level events the standalone
 *      panel reads on the bare `/agents/:agentId` URL.
 *   2. `sessionHistoryKey(...)` of the agent's most-recent session — the slot
 *      the panel switches to once `useDefaultStandaloneSessionRedirect`
 *      rewrites the URL with `?project=&instance=&session=`.
 *
 * Both warmers are idempotent (React Query dedupes the prefetch; the sessions
 * store dedupes concurrent loaders via per-surface request ids), so this is
 * safe to call from hover, click, and the post-login auto-redirect alike.
 */
export function warmStandaloneAgentHistory(agentId: string): void {
  useChatHistoryStore.getState().prefetchHistory(
    agentHistoryKey(agentId),
    () =>
      api.agents.listEvents(agentId, {
        limit: STANDALONE_AGENT_HISTORY_LIMIT,
      }),
  );
  warmStandaloneAgentSession(agentId);
}

/**
 * Warm only the most-recent project-session slot (`sessionHistoryKey(...)`).
 * Split out for the sidebar's idle preview-prefetch worker, which already
 * issues its own `fetchHistory(agentHistoryKey(...))` and just needs the
 * session slot warmed on top.
 */
export function warmStandaloneAgentSession(agentId: string): void {
  const sessionsStore = useSessionsListStore.getState();
  const surfaceKey = agentSessionsSurfaceKey(agentId);

  const tryWarmFromCurrentSnapshot = (): void => {
    const list = useSessionsListStore.getState().sessionsBySurface[surfaceKey];
    if (!list || list.length === 0) return;
    const mostRecent = findMostRecentRealSession(list);
    if (!mostRecent) return;
    const key = sessionHistoryKey(
      mostRecent._projectId,
      mostRecent._agentInstanceId,
      mostRecent.session_id,
    );
    void useChatHistoryStore.getState().fetchHistory(key, () =>
      api.listSessionEvents(
        mostRecent._projectId,
        mostRecent._agentInstanceId,
        mostRecent.session_id,
      ),
    );
  };

  if (sessionsStore.sessionsBySurface[surfaceKey] !== undefined) {
    tryWarmFromCurrentSnapshot();
    return;
  }
  void sessionsStore.loadAgentSessions(agentId).then(() => {
    tryWarmFromCurrentSnapshot();
  });
}
