import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatHistoryStore, useChatHistory } from "../stores/chat-history-store";
import { useIsStreaming } from "./stream/hooks";
import { getStreamEntry } from "./stream/store";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../types/aura-events";
import type { SessionEvent } from "../types";
import type { DisplaySessionEvent } from "../types/stream";

interface ChatHistorySyncOptions {
  historyKey: string | undefined;
  streamKey: string;
  fetchFn: (() => Promise<SessionEvent[]>) | undefined;
  resetEvents: (events: DisplaySessionEvent[], opts?: { allowWhileStreaming: boolean }) => void;
  /** When true, invalidates the cache before fetching (forces a server round-trip). */
  invalidateBeforeFetch?: boolean;
  /** Called when the entity ID changes — e.g. to persist last-used agent. */
  onSwitch?: () => void;
  /** Called when no entity ID is present — clears local state. */
  onClear?: () => void;
  /** When false, callers render directly from cached history instead of copying it into the stream store. */
  hydrateToStream?: boolean;
  /**
   * When set, subscribes to live `UserMessage` and `AssistantMessageEnd`
   * WebSocket events for this project-agent / agent-instance id and
   * force-refetches history when a matching event arrives. Used to surface
   * cross-agent writes (e.g. the CEO's `send_to_agent` tool) live in the
   * target agent's chat panel without a manual reload.
   */
  watchAgentInstanceId?: string;
  /**
   * When set, match events by their org-level `agent_id` field (from
   * `agents.agent_id` in aura-network). Standalone agent chats key
   * their history by `agentHistoryKey(agent_id)` — not by
   * `project_agent_id` — so they must filter on this field instead
   * of `watchAgentInstanceId` to see cross-agent writes live.
   */
  watchAgentId?: string;
  /**
   * When set, scopes the live refetch to events for this specific
   * `session_id`. Useful for historical session views where we only care
   * about updates to the pinned session.
   */
  watchSessionId?: string;
}

interface ChatHistorySyncResult {
  historyMessages: DisplaySessionEvent[];
  historyResolved: boolean;
  isLoading: boolean;
  historyError: string | null;
  /** Wraps a send function to invalidate history before sending. */
  wrapSend: <T extends (...args: any[]) => any>(send: T) => T;
}

/**
 * Shared history-loading and stream-store sync logic used by both
 * project-scoped and standalone agent chat views.
 */
export function useChatHistorySync({
  historyKey,
  streamKey,
  fetchFn,
  resetEvents,
  invalidateBeforeFetch,
  onSwitch,
  onClear,
  hydrateToStream = true,
  watchAgentInstanceId,
  watchAgentId,
  watchSessionId,
}: ChatHistorySyncOptions): ChatHistorySyncResult {
  const {
    events: historyMessages,
    status: historyStatus,
    error: historyError,
  } = useChatHistory(historyKey);
  const historyLastMessageAt = useChatHistoryStore((s) => {
    if (!historyKey) return null;
    return s.entries[historyKey]?.lastMessageAt ?? null;
  });

  const isStreaming = useIsStreaming(streamKey);

  const resetEventsRef = useRef(resetEvents);
  useEffect(() => { resetEventsRef.current = resetEvents; }, [resetEvents]);

  // When streaming stops, silently refresh the cache so that the next
  // navigation sees fresh data.  We call fetchHistory with `force: true`
  // instead of invalidateHistory so that the entry keeps its current
  // status/events — this avoids a loading-state flash (blink) in the UI.
  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    if (prevIsStreamingRef.current && !isStreaming) {
      if (historyKey && fetchFn) {
        useChatHistoryStore.getState().fetchHistory(historyKey, fetchFn, { force: true });
      }
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, historyKey, fetchFn]);

  // Subscribe to live WebSocket chat events for this agent and force-refetch
  // history on a match. This keeps the target agent's chat panel in sync when
  // another agent writes into its session (e.g. the CEO's `send_to_agent`
  // tool) without relying on stream-stop or manual reload.
  const subscribe = useEventStore((s) => s.subscribe);
  useEffect(() => {
    if (!historyKey || !fetchFn) return;
    if (!watchAgentInstanceId && !watchAgentId && !watchSessionId) return;

    const matches = (content: Record<string, unknown> | undefined): boolean => {
      if (!content) return false;
      const eventAgentInstanceId =
        (content.project_agent_id as string | undefined) ??
        (content.agent_instance_id as string | undefined);
      const eventAgentId = content.agent_id as string | undefined;
      const eventSessionId = content.session_id as string | undefined;

      // `watchSessionId` is the narrowest scope and is *exclusive*:
      // when set, only events for that exact session fire a refetch,
      // regardless of any other watch field. This matches the
      // original behaviour tested in `use-chat-history-sync.test.ts`.
      if (watchSessionId) {
        return eventSessionId === watchSessionId;
      }
      // Otherwise fall through to ID-level matching. `watchAgentId`
      // (org-level) and `watchAgentInstanceId` (project binding)
      // are both acceptable — a single chat window only passes one.
      if (watchAgentId && eventAgentId === watchAgentId) {
        return true;
      }
      if (
        watchAgentInstanceId &&
        eventAgentInstanceId === watchAgentInstanceId
      ) {
        return true;
      }
      return false;
    };

    const onChatEvent = (event: { content?: Record<string, unknown> }) => {
      if (!matches(event.content)) return;
      useChatHistoryStore
        .getState()
        .fetchHistory(historyKey, fetchFn, { force: true });
    };

    const unsubUser = subscribe(EventType.UserMessage, onChatEvent as never);
    const unsubEnd = subscribe(
      EventType.AssistantMessageEnd,
      onChatEvent as never,
    );
    return () => {
      unsubUser();
      unsubEnd();
    };
  }, [
    historyKey,
    fetchFn,
    subscribe,
    watchAgentInstanceId,
    watchAgentId,
    watchSessionId,
  ]);

  // Fetch history when the entity changes.
  useEffect(() => {
    if (!historyKey || !fetchFn) {
      onClear?.();
      return;
    }
    if (invalidateBeforeFetch) {
      useChatHistoryStore.getState().invalidateHistory(historyKey);
    }
    useChatHistoryStore.getState().fetchHistory(historyKey, fetchFn);
    onSwitch?.();
  }, [historyKey, fetchFn, invalidateBeforeFetch, onSwitch, onClear]);

  // Sync fetched history into the stream store for rendering.
  // Guards:
  // 1. When history was invalidated (fetchedAt === 0) and the stream store
  //    already holds events, skip — the stream store is more current.
  // 2. When the stream store already has >= as many events as the history,
  //    skip — avoids a full re-render blink after streaming ends and the
  //    background re-fetch returns equivalent data.
  useEffect(() => {
    if (!hydrateToStream) return;
    if (historyStatus !== "ready" || !historyKey) return;
    const histEntry = useChatHistoryStore.getState().entries[historyKey];
    const sEntry = getStreamEntry(streamKey);
    const streamCount = sEntry?.events.length ?? 0;
    if (histEntry && histEntry.fetchedAt === 0 && streamCount > 0) return;
    if (streamCount > 0 && streamCount >= historyMessages.length) return;
    resetEventsRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages, historyStatus, historyKey, hydrateToStream, streamKey]);

  const prevHistoryLastMessageAtRef = useRef<string | null>(null);
  useEffect(() => {
    if (hydrateToStream || historyStatus !== "ready" || !historyKey) {
      prevHistoryLastMessageAtRef.current = historyLastMessageAt;
      return;
    }

    const previousLastMessageAt = prevHistoryLastMessageAtRef.current;
    prevHistoryLastMessageAtRef.current = historyLastMessageAt;

    if (
      historyLastMessageAt == null ||
      previousLastMessageAt === historyLastMessageAt ||
      isStreaming
    ) {
      return;
    }

    const streamEntry = getStreamEntry(streamKey);
    const streamCount = streamEntry?.events.length ?? 0;
    if (streamCount === 0) {
      return;
    }

    // Only clear stream events when history has caught up with at least as
    // many messages. This prevents a flash where stream events are wiped
    // before the server has finished persisting the assistant reply.
    if (historyMessages.length < streamCount) {
      return;
    }

    resetEventsRef.current([], { allowWhileStreaming: true });
  }, [
    historyKey,
    historyLastMessageAt,
    historyMessages.length,
    historyStatus,
    hydrateToStream,
    isStreaming,
    streamKey,
  ]);

  // After invalidateHistory the entry keeps status "ready" with fetchedAt=0
  // while the background re-fetch is in flight. Treat this as unresolved so
  // the scroll hook waits for fresh data instead of revealing stale content.
  const isFetchStale = useChatHistoryStore(
    useShallow((s) => {
      if (!historyKey) return false;
      const e = s.entries[historyKey];
      return e?.status === "ready" && e.fetchedAt === 0;
    }),
  );

  const rawLoading = historyStatus === "loading" || historyStatus === "idle";
  const historyResolved =
    (historyStatus === "ready" || historyStatus === "error") && !isFetchStale;

  const wrapSend = useCallback(
    <T extends (...args: any[]) => any>(send: T): T => {
      return ((...args: any[]) => send(...args)) as unknown as T;
    },
    [],
  );

  return {
    historyMessages,
    historyResolved,
    isLoading: rawLoading || isFetchStale,
    historyError: historyError ?? null,
    wrapSend,
  };
}
