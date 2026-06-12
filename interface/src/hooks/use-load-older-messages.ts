import { useState, useCallback, useRef } from "react";
import { api } from "../api/client";
import type { PaginatedEventsResponse } from "../shared/api/agents";
import type { SessionEvent } from "../shared/types";
import { buildDisplayEvents } from "../utils/build-display-messages";
import {
  agentSessionHistoryKey,
  sessionHistoryKey,
  useChatHistoryStore,
} from "../stores/chat-history-store";
import { useChatViewStore, useThreadView } from "../stores/chat-view-store";

/** Trailing window fetched when opening (or prefetching) a pinned session. */
export const INITIAL_SESSION_HISTORY_LIMIT = 100;

export type LoadOlderPageFetcher = (
  cursor: string | null,
) => Promise<PaginatedEventsResponse>;

interface UseLoadOlderMessagesOptions {
  threadKey: string;
  /**
   * Fetches one older page for this thread. `cursor` is the
   * `next_cursor` from the previous page (or the oldest loaded event id
   * as a fallback). Surface-specific: project chats and standalone
   * agent chats hit different endpoints.
   */
  fetchPage?: LoadOlderPageFetcher;
}

interface UseLoadOlderMessagesReturn {
  loadOlder: () => Promise<void>;
  isLoadingOlder: boolean;
  hasOlderMessages: boolean;
}

/**
 * Seed the thread's pagination view-state from an initial paginated
 * history response, so the "load older" affordance appears as soon as
 * the first window resolves. Called from the initial `fetchFn` of the
 * chat surfaces that use the paginated history endpoints.
 */
export function seedThreadPagination(
  threadKey: string,
  response: Pick<PaginatedEventsResponse, "has_more" | "next_cursor">,
): void {
  const view = useChatViewStore.getState();
  view.setHasOlderMessages(threadKey, response.has_more);
  view.setOlderCursor(threadKey, response.next_cursor);
}

/**
 * Initial-window history fetcher for a project-scoped pinned session.
 * Fetches only the trailing window via the paginated endpoint and seeds
 * the thread's "load older" state. Shared by the chat panel's history
 * sync and every sidebar hover-warm/prefetch path so they all populate
 * the same cache entry the same way (a prefetch of a huge session no
 * longer downloads the entire transcript).
 */
export function buildProjectSessionHistoryFetch(
  projectId: string,
  agentInstanceId: string,
  sessionId: string,
): () => Promise<SessionEvent[]> {
  const threadKey = sessionHistoryKey(projectId, agentInstanceId, sessionId);
  return async () => {
    const page = await api.listSessionEventsPaginated(
      projectId,
      agentInstanceId,
      sessionId,
      { limit: INITIAL_SESSION_HISTORY_LIMIT },
    );
    seedThreadPagination(threadKey, page);
    return page.events;
  };
}

/**
 * Initial-window history fetcher for a standalone agent's pinned
 * session (same contract as {@link buildProjectSessionHistoryFetch}).
 */
export function buildAgentSessionHistoryFetch(
  agentId: string,
  sessionId: string,
  limit: number = INITIAL_SESSION_HISTORY_LIMIT,
): () => Promise<SessionEvent[]> {
  const threadKey = agentSessionHistoryKey(agentId, sessionId);
  return async () => {
    const page = await api.agents.listSessionEventsPaginated(agentId, sessionId, {
      limit,
    });
    seedThreadPagination(threadKey, page);
    return page.events;
  };
}

/**
 * Loads an older page of history and prepends it to the thread's
 * chat-history entry (the transcript's source of truth). The
 * virtualized message list preserves the reading position across the
 * prepend (see `use-virtual-chat-list`).
 */
export function useLoadOlderMessages({
  threadKey,
  fetchPage,
}: UseLoadOlderMessagesOptions): UseLoadOlderMessagesReturn {
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const { hasOlderMessages, olderCursor } = useThreadView(threadKey);

  const loadOlder = useCallback(async () => {
    if (!fetchPage || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoadingOlder(true);

    try {
      const oldestLoadedId =
        useChatHistoryStore.getState().entries[threadKey]?.events[0]?.id ?? null;
      const cursor = olderCursor ?? oldestLoadedId;
      if (!cursor) return;

      const response = await fetchPage(cursor);

      const displayEvents = buildDisplayEvents(response.events);
      if (displayEvents.length > 0) {
        useChatHistoryStore.getState().prependHistoryEvents(threadKey, displayEvents);
      }

      seedThreadPagination(threadKey, response);
    } finally {
      loadingRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [fetchPage, threadKey, olderCursor]);

  return { loadOlder, isLoadingOlder, hasOlderMessages };
}
