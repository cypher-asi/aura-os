/**
 * Cross-agent / WS live-update sync hook.
 *
 * Diagnostic toggle (Phase 6): set
 *
 *   window.__AURA_DEBUG_CROSS_AGENT__ = true
 *
 * from devtools to surface two `console.debug` lines tagged
 * `[aura.cross-agent]` whenever the WS event store receives a frame
 * (`ws raw` — wire payload + parsed view) and whenever this hook's
 * subscription evaluates a chat event against its watch params
 * (`ws event` — type, ids, watch params, matched). The toggle is
 * intentionally just a window property — no env var, no build flag —
 * so a user reporting "my UI didn't live-update" can flip it from the
 * browser console without re-installing anything. When the property
 * is undefined / falsy the gate is a single `typeof window` check
 * plus a property read, so there is no perf impact in production. The
 * server-side companion targets are `aura::cross_agent` and
 * `aura::ws`; see
 * `apps/aura-os-server/src/handlers/agents/chat/CROSS_AGENT_TRACING.md`
 * for the matching log table and `RUST_LOG` invocation.
 */
import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatHistoryStore, useChatHistory } from "../../stores/chat-history-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useIsStreaming } from "../stream/hooks";
import {
  clearStreamInterrupted,
  getIsStreaming,
  getStreamEntry,
  markStreamInterrupted,
} from "../stream/store";
import { getIsReattaching } from "../stream/partition-state";
import { api } from "../../api/client";
import { selectReattachableChatStream } from "../../api/streams";
import { useEventStore } from "../../stores/event-store/index";
import { isAuraCaptureSessionActive } from "../../lib/screenshot-bridge";
import { EventType } from "../../shared/types/aura-events";
import type { SessionEvent } from "../../shared/types";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import {
  findTrailingInFlightAssistant,
  rebuildPendingArtifactsFromHistory,
} from "../use-chat-stream/optimistic-artifacts";
import {
  PROGRESS_REFETCH_DEBOUNCE_MS,
  hasTransientStreamError,
  historyHasCaughtUpToStream,
} from "./helpers";

// Debug logging for the WS-triggered + post-stream history refetch paths.
// Toggle with `localStorage.setItem("aura.debug.chatMerge", "1")` and
// reload to surface every history-side mutation. The legacy stream-store
// hydrate path was removed in the Phase B projector landing, so the
// remaining mutations are: WS-triggered force refetch, post-stream
// forced refetch, and the caught-up "clear stream events" path. Compare
// these logs against the `useStreamStore` events to confirm the
// projector merges them deterministically.
const CHAT_MERGE_DEBUG_KEY = "aura.debug.chatMerge";
const LIVE_EVENT_SETTLE_REFETCH_MS = 750;
// How long after a `fetchHistory` (e.g. a sidebar hover prefetch) we
// keep trusting the cached entry for `invalidateBeforeFetch` callers.
// 30s mirrors `HISTORY_TTL_MS` in `chat-history-store` so the freshness
// window stays consistent with the store's own TTL short-circuit. Long
// enough to bridge hover→click and tab-switch sequences; short enough
// that a stale cache from a prior session doesn't survive page reloads.
const HISTORY_PREFETCH_FRESH_MS = 30_000;
const chatHistorySyncDebugEnabled = ((): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem(CHAT_MERGE_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
})();

function chatHistorySyncLog(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (!chatHistorySyncDebugEnabled) return;
  // eslint-disable-next-line no-console -- gated behind localStorage flag
  console.debug(`[aura.chatMerge] ${tag}`, {
    ts: Date.now(),
    ...payload,
  });
}

/**
 * Watch params for `matchesChatEvent`. A panel typically passes only one
 * of `watchSessionId` / `watchAgentInstanceId` / `watchAgentId`.
 */
export interface ChatEventWatch {
  watchSessionId?: string;
  watchAgentInstanceId?: string;
  watchAgentId?: string;
}

/**
 * Minimal shape of a parsed `AuraEvent` that the chat-history matcher
 * inspects. After Phase 4 the WS wire shape for `user_message` /
 * `assistant_message_end` is `{ session_id, project_id, project_agent_id,
 * agent_id }` at the top level — the legacy `agent_instance_id` field
 * is gone for those types and is now exposed only through
 * `event.project_agent_id` (populated by `parseAuraEvent`).
 */
export interface ChatEventForMatch {
  session_id?: string | null;
  project_agent_id?: string | null;
  agent_id?: string | null;
}

/**
 * Returns true when a parsed chat event should fire a history refetch
 * for the panel described by `watch`. ANY of the three id checks is
 * sufficient — earlier conditions short-circuit later ones, but a
 * higher-priority watch param being unset must NOT block lower-tier
 * matches. This is the explicit fix for the receiver-side regression
 * after the Phase 4 wire-shape change (`agent_instance_id` is gone for
 * `user_message` / `assistant_message_end`, so a project panel without
 * `?session=` pin must match on `project_agent_id` directly):
 *
 *  1. `watchSessionId && event.session_id === watchSessionId`
 *  2. `watchAgentInstanceId && event.project_agent_id === watchAgentInstanceId`
 *  3. `watchAgentId && event.agent_id === watchAgentId`
 */
/**
 * Phase 6 diagnostic: when the
 * `window.__AURA_DEBUG_CROSS_AGENT__` flag is truthy, log one
 * `[aura.cross-agent] ws event` line per evaluated chat event with
 * the type, the routing ids, the watch params, and whether the
 * matcher accepted the event. No-op when the flag is undefined /
 * falsy — the gate is a single `typeof window` check plus a property
 * read so the unmonitored hot path is effectively free. Exported so
 * the unit tests can pin both branches without having to drive the
 * full hook + WS subscription scaffolding.
 */
export function maybeLogCrossAgentEvent(
  event: ChatEventForMatch & { type?: string },
  watch: ChatEventWatch,
  matched: boolean,
): void {
  if (
    typeof window === "undefined" ||
    !(window as unknown as { __AURA_DEBUG_CROSS_AGENT__?: unknown })
      .__AURA_DEBUG_CROSS_AGENT__
  ) {
    return;
  }
  const { watchSessionId, watchAgentInstanceId, watchAgentId } = watch;
  // eslint-disable-next-line no-console -- gated behind window flag, see top-of-file doc
  console.debug("[aura.cross-agent] ws event", {
    type: event.type,
    session_id: event.session_id,
    project_agent_id: event.project_agent_id,
    agent_id: event.agent_id,
    watch: { watchSessionId, watchAgentInstanceId, watchAgentId },
    matched,
  });
}

export function matchesChatEvent(
  event: ChatEventForMatch | undefined,
  watch: ChatEventWatch,
): boolean {
  if (!event) return false;
  const { watchSessionId, watchAgentInstanceId, watchAgentId } = watch;
  if (watchSessionId && event.session_id === watchSessionId) {
    return true;
  }
  if (
    watchAgentInstanceId &&
    event.project_agent_id === watchAgentInstanceId
  ) {
    return true;
  }
  if (watchAgentId && event.agent_id === watchAgentId) {
    return true;
  }
  return false;
}

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
  /**
   * Treat this panel as an intentionally empty fresh canvas. The caller still
   * provides a transient history key for message-store isolation, but no
   * cached or server history should be loaded until SessionReady pins a real
   * session id.
   */
  suppressHistoryFetch?: boolean;
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
  /**
   * When provided alongside `watchAgentInstanceId`, enables sidekick
   * `pending-*` placeholder rebuilding on mid-turn refresh — i.e. if
   * the server reports an in-flight assistant turn for this agent
   * with `create_spec` / `create_task` tool calls that haven't
   * resolved yet, the corresponding placeholder rows are re-pushed
   * into the sidekick spec/task lists so they reappear after a hard
   * reload. Project-scoped chat panels pass their project id here.
   */
  projectIdForSidekick?: string;
}

interface ChatHistorySyncResult {
  historyMessages: DisplaySessionEvent[];
  historyResolved: boolean;
  isLoading: boolean;
  historyError: string | null;
  /** Wraps a send function to invalidate history before sending. */
  wrapSend: <TArgs extends readonly unknown[], TReturn>(
    send: (...args: TArgs) => TReturn,
  ) => (...args: TArgs) => TReturn;
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
  suppressHistoryFetch,
  watchAgentInstanceId,
  watchAgentId,
  watchSessionId,
  projectIdForSidekick,
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
  // navigation sees fresh data. We call fetchHistory with `force: true`
  // instead of invalidateHistory so the entry keeps its current
  // status/events — this avoids a loading-state flash (blink) in the UI.
  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    if (prevIsStreamingRef.current && !isStreaming) {
      if (!suppressHistoryFetch && historyKey && fetchFn) {
        chatHistorySyncLog("history: post-stream forced refetch", {
          historyKey,
          streamKey,
        });
        useChatHistoryStore.getState().fetchHistory(historyKey, fetchFn, { force: true });
      }
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, historyKey, fetchFn, streamKey, suppressHistoryFetch]);

  // Subscribe to live WebSocket chat events for this agent and force-refetch
  // history on a match. This keeps the target agent's chat panel in sync when
  // another agent writes into its session (e.g. the CEO's `send_to_agent`
  // tool) without relying on stream-stop or manual reload.
  const subscribe = useEventStore((s) => s.subscribe);
  useEffect(() => {
    if (!historyKey || !fetchFn) return;
    if (suppressHistoryFetch) return;
    if (!watchAgentInstanceId && !watchAgentId && !watchSessionId) return;

    const watch: ChatEventWatch = {
      watchSessionId,
      watchAgentInstanceId,
      watchAgentId,
    };

    let settleRefetchTimer: ReturnType<typeof setTimeout> | undefined;
    const forceFetchHistory = (tag: string, event?: ChatEventForMatch & { content?: Record<string, unknown> }) => {
      chatHistorySyncLog(tag, {
        historyKey,
        streamKey,
        eventContentKeys: event?.content ? Object.keys(event.content) : [],
      });
      useChatHistoryStore
        .getState()
        .fetchHistory(historyKey, fetchFn, { force: true });
    };

    const onChatEvent = (event: ChatEventForMatch & { type?: string; content?: Record<string, unknown> }) => {
      const matched = matchesChatEvent(event, watch);
      maybeLogCrossAgentEvent(event, watch, matched);
      if (!matched) return;
      // Don't let a firehose-driven history refetch race an in-flight
      // reattach. While the panel is rejoining a live turn via
      // `/api/streams/:id`, that SSE is the source of truth for the
      // turn's per-delta content; a `user_message` /
      // `assistant_message_end` lifecycle frame arriving over the
      // firehose mid-reattach would otherwise pull a server snapshot
      // that lags the live deltas and momentarily reset `events[]`.
      // The reattach's own finalize path triggers the post-stream
      // refetch once it settles.
      if (getIsReattaching(streamKey)) return;
      forceFetchHistory("history: WS-triggered refetch (UserMessage/AssistantEnd)", event);
      if (settleRefetchTimer !== undefined) {
        clearTimeout(settleRefetchTimer);
      }
      settleRefetchTimer = setTimeout(() => {
        settleRefetchTimer = undefined;
        forceFetchHistory("history: settled WS-triggered refetch (UserMessage/AssistantEnd)", event);
      }, LIVE_EVENT_SETTLE_REFETCH_MS);
    };

    // `assistant_turn_progress` is throttled to ~one publish per 400ms by
    // the backend, but multiple turns and panels may share a single bus
    // burst. Coalesce into a single trailing-edge fetch per
    // `PROGRESS_REFETCH_DEBOUNCE_MS` window so the in-flight reconstruction
    // (powered by `events_to_session_history`) is pulled fresh enough to
    // feel live without thrashing the history endpoint.
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    const onProgress = (event: ChatEventForMatch) => {
      if (!matchesChatEvent(event, watch)) return;
      if (getStreamEntry(streamKey)?.isStreaming) return;
      if (progressTimer !== undefined) return;
      progressTimer = setTimeout(() => {
        progressTimer = undefined;
        chatHistorySyncLog("history: WS-triggered refetch (AssistantTurnProgress)", {
          historyKey,
          streamKey,
        });
        useChatHistoryStore
          .getState()
          .fetchHistory(historyKey, fetchFn, { force: true });
      }, PROGRESS_REFETCH_DEBOUNCE_MS);
    };

    const unsubUser = subscribe(EventType.UserMessage, onChatEvent as never);
    const unsubEnd = subscribe(
      EventType.AssistantMessageEnd,
      onChatEvent as never,
    );
    const unsubProgress = subscribe(
      EventType.AssistantTurnProgress,
      onProgress as never,
    );
    return () => {
      unsubUser();
      unsubEnd();
      unsubProgress();
      if (progressTimer !== undefined) clearTimeout(progressTimer);
      if (settleRefetchTimer !== undefined) clearTimeout(settleRefetchTimer);
    };
  }, [
    historyKey,
    fetchFn,
    streamKey,
    suppressHistoryFetch,
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
    if (suppressHistoryFetch) {
      onSwitch?.();
      return;
    }
    if (isAuraCaptureSessionActive()) {
      onSwitch?.();
      return;
    }
    // Skip the cache invalidation when a turn is actively streaming on
    // this `streamKey`. The historyKey changes mid-stream whenever a
    // fresh-canvas first send triggers `SessionReady` → URL flips
    // `?session=<id>` → the panel's `historyKey` memo recomputes from
    // `project:...` to `session:...:<id>`. Calling `invalidateHistory`
    // on the new key sets `fetchedAt=0`, which flips `isFetchStale`
    // true, drives `historyResolved` to `false`, and (paired with the
    // panel's `scrollResetKey` change on the same event) re-arms the
    // ChatPanel cold-load gate — flashing `.messageContentHidden` over
    // the just-sent user bubble for ~2 frames before the reveal cycle
    // unhides it. The live SSE is the source of truth during a turn;
    // a normal `fetchHistory` (without invalidation) is enough to pick
    // up persisted server state in the background.
    //
    // Also skip invalidation when the entry was just hover-prefetched
    // (fresh `fetchedAt`). The whole point of the sidebar's hover-warm
    // chain in `AgentList` / `ChatsTab` / `ProjectList` is to land the
    // chat-history-store entry as `"ready"` for the destination key
    // before the user clicks, so that `historyResolved` is `true` on
    // the panel's first render and the cold-load gate stays disarmed.
    // Forcing an invalidate-on-mount immediately after the prefetch
    // would flip `historyResolved` back to false for one render and
    // re-arm the gate — exactly the flicker the prefetch is meant to
    // eliminate. The follow-up `fetchHistory({ force: true })` below
    // still hits the network in this branch, so freshness against
    // cross-tab writes is preserved without the visible flash.
    if (invalidateBeforeFetch && !getIsStreaming(streamKey)) {
      const cachedEntry = useChatHistoryStore.getState().entries[historyKey];
      // A freshly hover-prefetched, NON-EMPTY `ready` entry is trusted so
      // the click paints instantly without re-arming the cold-load gate.
      // An EMPTY `ready` entry is deliberately NOT treated as fresh: it is
      // almost always a hover prefetch that raced ahead of the server
      // persisting the transcript (notably a subagent session, whose child
      // transcript is drained asynchronously after the row appears).
      // Trusting it strands the panel on the empty state on click even
      // though a hard refresh then shows the content. Invalidating resets
      // `fetchedAt` to 0 so the `fetchHistory` below revalidates against
      // the network instead of short-circuiting on the stale empty cache.
      const isFreshlyCached =
        cachedEntry?.status === "ready" &&
        cachedEntry.fetchedAt > 0 &&
        cachedEntry.events.length > 0 &&
        Date.now() - cachedEntry.fetchedAt < HISTORY_PREFETCH_FRESH_MS;
      if (!isFreshlyCached) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
    }
    // Kick off IDB hydration in parallel with the network fetch. On a
    // cold app open IDB usually resolves first and paints the last-seen
    // transcript, so the chat view stops flashing a spinner before the
    // server round-trip completes. `hydrateFromCache` no-ops if the
    // in-memory entry is already populated from a prior navigation, or
    // if the network fetch wins the race.
    void useChatHistoryStore.getState().hydrateFromCache(historyKey);
    useChatHistoryStore.getState().fetchHistory(historyKey, fetchFn);
    onSwitch?.();
  }, [historyKey, fetchFn, invalidateBeforeFetch, onSwitch, onClear, streamKey, suppressHistoryFetch]);

  // Pin the active history key in the chat-history-store LRU for the
  // panel's lifetime. The store caps in-memory entries at
  // `MAX_HISTORY_ENTRIES = 8`; without a pin, sidebar prefetching the
  // 9th agent could evict the currently-displayed transcript and the
  // renderer would momentarily snap to the empty state — the original
  // "CEO chat blink" failure mode (an open SuperAgent chat is the
  // most common eviction victim because it is usually opened first).
  // Pinning makes the active key un-evictable; unmount cleanup
  // releases it so navigating away does not leak pins.
  useEffect(() => {
    if (!historyKey) return;
    useChatHistoryStore.getState().pinKey(historyKey);
    return () => {
      useChatHistoryStore.getState().unpinKey(historyKey);
    };
  }, [historyKey]);

  // Caught-up clear path: when persisted history catches up to the
  // ephemeral stream-store events for this key, drop the stream rows
  // so the projector renders straight from history without dragging
  // along now-redundant placeholders.
  //
  // The Phase B projector (`shared/lib/conversation-projector`) already
  // deduplicates stream rows whose `id` matches a history row, so this
  // effect is purely a memory-pressure release: without it, the stream
  // entry's `events[]` grows monotonically across the session.
  //
  // Guards:
  // - Only fire on a fresh `lastMessageAt` transition (new persisted
  //   row landed since the last tick).
  // - Never clear while a turn is actively streaming (we'd wipe the
  //   in-flight assistant placeholder mid-render).
  // - Never clear when the stream still carries a transient error
  //   bubble (it has no persisted analogue to fall back to).
  // - Use `historyHasCaughtUpToStream` to confirm the history snapshot
  //   semantically subsumes the stream — length alone is not enough
  //   (an empty-content assistant row could falsely satisfy it).
  const prevHistoryLastMessageAtRef = useRef<string | null>(null);
  useEffect(() => {
    if (suppressHistoryFetch || historyStatus !== "ready" || !historyKey) {
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

    if (!historyHasCaughtUpToStream(historyMessages, streamEntry?.events ?? [])) {
      return;
    }
    if (hasTransientStreamError(streamEntry?.events ?? [])) {
      return;
    }

    chatHistorySyncLog("history: resetEvents([]) — caught-up clear path", {
      historyKey,
      streamKey,
      historyCount: historyMessages.length,
      historyLastMessageAt,
      previousLastMessageAt,
      replacingStreamCount: streamCount,
    });
    resetEventsRef.current([], { allowWhileStreaming: true });
  }, [
    historyKey,
    historyLastMessageAt,
    historyMessages,
    historyMessages.length,
    historyStatus,
    suppressHistoryFetch,
    isStreaming,
    streamKey,
  ]);

  // Mid-turn refresh recovery: retain the working affordances only while the
  // server can still prove that the canonical session has an attachable
  // execution. A successful active-stream response with no match means the
  // environment-owned run was lost (for example, by a server restart). A
  // failed lookup remains unknown and must not be presented as interruption.
  const inFlightRecoveryRef = useRef<string | null>(null);
  // Per-hook tracking of placeholder ids we have re-pushed from the
  // server-reported in-flight turn. Carries the same role
  // `pendingSpecIdsRef` plays inside `useChatStream`, but scoped to the
  // refresh-recovery flow (where we don't own the original ref). The
  // helpers in `optimistic-artifacts` skip duplicate pushes when the
  // pending id is already tracked here.
  const recoveredPendingSpecIdsRef = useRef<string[]>([]);
  const recoveredPendingTaskIdsRef = useRef<string[]>([]);
  const reconciledInFlightTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (historyStatus !== "ready") return;
    const trailing = findTrailingInFlightAssistant(historyMessages);
    const sidekick = useSidekickStore.getState();
    if (trailing) {
      const localStream = getStreamEntry(streamKey);
      const localIsStreaming = !!localStream?.isStreaming;
      if (localIsStreaming) {
        clearStreamInterrupted(streamKey);
        return;
      }
      if (
        watchAgentInstanceId &&
        !localStream?.interruptionReason &&
        !sidekick.streamingAgentInstanceIds.includes(watchAgentInstanceId)
      ) {
        sidekick.setAgentStreaming(watchAgentInstanceId, true);
      }
      inFlightRecoveryRef.current = watchAgentInstanceId ?? null;
      if (watchAgentInstanceId && projectIdForSidekick) {
        rebuildPendingArtifactsFromHistory(
          historyMessages,
          projectIdForSidekick,
          sidekick,
          {
            pendingSpecIdsRef: recoveredPendingSpecIdsRef,
            pendingTaskIdsRef: recoveredPendingTaskIdsRef,
          },
        );
      }

      if (!watchSessionId) return;
      const reconciliationKey = `${watchSessionId}:${trailing.id}`;
      if (reconciledInFlightTurnRef.current === reconciliationKey) return;
      reconciledInFlightTurnRef.current = reconciliationKey;
      let cancelled = false;
      let completed = false;
      void (async () => {
        try {
          const { streams } = await api.streams.listActiveStreams(
            watchAgentInstanceId
              ? { agent_instance_id: watchAgentInstanceId }
              : {},
          );
          if (cancelled) return;
          const active = selectReattachableChatStream(streams, watchSessionId);
          if (active) {
            completed = true;
            clearStreamInterrupted(streamKey);
            return;
          }

          completed = true;
          markStreamInterrupted(streamKey);
          if (watchAgentInstanceId) {
            useSidekickStore
              .getState()
              .setAgentStreaming(watchAgentInstanceId, false);
            if (inFlightRecoveryRef.current === watchAgentInstanceId) {
              inFlightRecoveryRef.current = null;
            }
          }
          recoveredPendingSpecIdsRef.current = [];
          recoveredPendingTaskIdsRef.current = [];
        } catch {
          // Connectivity failure is not evidence that the execution ended.
          // Leave recovery state intact so a later refresh can reattach.
          if (
            !cancelled &&
            reconciledInFlightTurnRef.current === reconciliationKey
          ) {
            reconciledInFlightTurnRef.current = null;
          }
        }
      })();
      return () => {
        cancelled = true;
        if (
          !completed &&
          reconciledInFlightTurnRef.current === reconciliationKey
        ) {
          reconciledInFlightTurnRef.current = null;
        }
      };
    } else if (
      watchAgentInstanceId &&
      inFlightRecoveryRef.current === watchAgentInstanceId &&
      sidekick.streamingAgentInstanceIds.includes(watchAgentInstanceId)
    ) {
      sidekick.setAgentStreaming(watchAgentInstanceId, false);
      inFlightRecoveryRef.current = null;
      // Drop tracked placeholder ids — once the in-flight marker is
      // gone the matching real spec/task entries should already have
      // landed via WS (`SpecSaved` / `TaskSaved`) or will arrive on
      // the next history refetch.
      recoveredPendingSpecIdsRef.current = [];
      recoveredPendingTaskIdsRef.current = [];
    }
    if (!trailing) {
      reconciledInFlightTurnRef.current = null;
      clearStreamInterrupted(streamKey);
    }
  }, [
    historyMessages,
    historyStatus,
    streamKey,
    watchAgentInstanceId,
    watchSessionId,
    projectIdForSidekick,
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
  const historyResolved = suppressHistoryFetch
    ? true
    : (historyStatus === "ready" || historyStatus === "error") && !isFetchStale;

  const wrapSend = useCallback(
    <TArgs extends readonly unknown[], TReturn>(
      send: (...args: TArgs) => TReturn,
    ): ((...args: TArgs) => TReturn) => {
      return (...args: TArgs) => send(...args);
    },
    [],
  );

  return {
    historyMessages,
    historyResolved,
    isLoading: suppressHistoryFetch ? false : rawLoading || isFetchStale,
    historyError: historyError ?? null,
    wrapSend,
  };
}
