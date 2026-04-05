import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatHistoryStore, useChatHistory } from "../stores/chat-history-store";
import { useIsStreaming } from "./stream/hooks";
import { getStreamEntry } from "./stream/store";
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
}

interface ChatHistorySyncResult {
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
}: ChatHistorySyncOptions): ChatHistorySyncResult {
  const {
    events: historyMessages,
    status: historyStatus,
    error: historyError,
  } = useChatHistory(historyKey);

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
    if (historyStatus !== "ready" || !historyKey) return;
    const histEntry = useChatHistoryStore.getState().entries[historyKey];
    const sEntry = getStreamEntry(streamKey);
    const streamCount = sEntry?.events.length ?? 0;
    if (histEntry && histEntry.fetchedAt === 0 && streamCount > 0) return;
    if (streamCount > 0 && streamCount >= historyMessages.length) return;
    resetEventsRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages, historyStatus, historyKey, streamKey]);

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
      const wrapped = ((...args: any[]) => {
        if (historyKey) {
          useChatHistoryStore.getState().invalidateHistory(historyKey);
        }
        return send(...args);
      }) as unknown as T;
      return wrapped;
    },
    [historyKey],
  );

  return {
    historyResolved,
    isLoading: rawLoading || isFetchStale,
    historyError: historyError ?? null,
    wrapSend,
  };
}
