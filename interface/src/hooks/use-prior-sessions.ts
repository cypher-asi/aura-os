import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { buildDisplayEvents } from "../utils/build-display-messages";
import {
  isOptimisticSessionId,
  useSessionsForSurface,
} from "../stores/sessions-list-store";
import { deriveSessionLabel } from "../components/SessionsList/session-row-utils";
import type { AnnotatedSession } from "../components/SessionsList";
import type { DisplaySessionEvent } from "../shared/types/stream";

/**
 * One labeled boundary rendered by `ChatMessageList` immediately before
 * the first message of a session block, so loaded prior sessions (and
 * the current one) are visually separated. `firstEventId` matches the
 * `id` of the first `DisplaySessionEvent` of that block.
 */
export interface SessionBoundary {
  firstEventId: string;
  label: string;
  startedAt: string;
}

interface UsePriorSessionsOptions {
  /** Sessions-list surface to read older sessions from. */
  surfaceKey: string | undefined;
  /** When set, only consider sessions for this agent instance. */
  agentInstanceId?: string;
  /** The currently-pinned session id (`null` on a fresh canvas). */
  currentSessionId: string | null;
  /** `id` of the current session's first message, used for the current divider. */
  historyFirstEventId: string | undefined;
  /** Ensures the surface's session list is loaded even if no sidekick is mounted. */
  ensureLoaded?: () => void;
  /** Optional pre-derived label for the current session divider. */
  currentSessionLabel?: string;
}

interface UsePriorSessionsResult {
  /** Loaded prior sessions' events, oldest-first, to prepend above `historyMessages`. */
  priorEvents: DisplaySessionEvent[];
  /** Dividers for each loaded prior session (and the current session once any prior is shown). */
  sessionBoundaries: SessionBoundary[];
  /** Whether an older session exists beyond the oldest currently-shown one. */
  hasPriorSession: boolean;
  isLoadingPriorSession: boolean;
  loadPriorSession: () => void;
}

const EMPTY_EVENTS: DisplaySessionEvent[] = [];
const EMPTY_BOUNDARIES: SessionBoundary[] = [];

/**
 * Loads the chronologically previous session(s) for the current chat and
 * exposes them as a prependable event list plus per-session dividers.
 *
 * Sessions are a flat, time-ordered list per agent (no parent pointer),
 * so "prior session" is simply the next-older row after the oldest
 * currently-shown session in the `started_at`-desc list. Each
 * `loadPriorSession()` call walks one step further back, so the caller's
 * button can keep reappearing until history is exhausted.
 *
 * Events are fetched via the project-scoped endpoint using the fields
 * every annotated row carries (`_projectId` / `_agentInstanceId`), which
 * keeps this surface-agnostic across project chat, the agents shell, and
 * the chat app.
 */
export function usePriorSessions({
  surfaceKey,
  agentInstanceId,
  currentSessionId,
  historyFirstEventId,
  ensureLoaded,
  currentSessionLabel,
}: UsePriorSessionsOptions): UsePriorSessionsResult {
  const sessions = useSessionsForSurface(surfaceKey);

  const instanceSessions = useMemo(() => {
    return sessions.filter(
      (s) =>
        !isOptimisticSessionId(s.session_id) &&
        (!agentInstanceId || s._agentInstanceId === agentInstanceId),
    );
  }, [sessions, agentInstanceId]);

  // Load order is newest-prior-first: the first click loads the session
  // immediately older than the current one, the next click the one older
  // than that, and so on.
  const [loadedSessionIds, setLoadedSessionIds] = useState<string[]>([]);
  const [eventsBySessionId, setEventsBySessionId] = useState<
    Record<string, DisplaySessionEvent[]>
  >({});
  const [isLoadingPriorSession, setIsLoadingPriorSession] = useState(false);
  const loadingRef = useRef(false);

  // Reset the loaded stack whenever the user switches to a different
  // session (or to a fresh canvas). Using the render-time "adjust state
  // when a prop changes" pattern (rather than an effect) keeps the reset
  // synchronous with the new session so no stale prior history flashes.
  const [anchorSessionId, setAnchorSessionId] = useState(currentSessionId);
  if (anchorSessionId !== currentSessionId) {
    setAnchorSessionId(currentSessionId);
    setLoadedSessionIds([]);
    setEventsBySessionId({});
    setIsLoadingPriorSession(false);
  }

  // Mirror the active session so a stale in-flight fetch (started before
  // the user switched sessions) can detect it should drop its result.
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    ensureLoaded?.();
  }, [surfaceKey, ensureLoaded]);

  // The id of the oldest session currently shown — the anchor we step
  // back from to find the next-older session.
  const oldestShownId =
    loadedSessionIds.length > 0
      ? loadedSessionIds[loadedSessionIds.length - 1]
      : currentSessionId;

  const nextOlder = useMemo<AnnotatedSession | null>(() => {
    if (!oldestShownId) return null;
    const idx = instanceSessions.findIndex(
      (s) => s.session_id === oldestShownId,
    );
    if (idx === -1) return null;
    return instanceSessions[idx + 1] ?? null;
  }, [instanceSessions, oldestShownId]);

  const hasPriorSession = currentSessionId != null && nextOlder != null;

  const loadPriorSession = useCallback(() => {
    if (loadingRef.current) return;
    const target = nextOlder;
    if (!target) return;
    const anchorAtCall = currentSessionIdRef.current;
    loadingRef.current = true;
    setIsLoadingPriorSession(true);
    api
      .listSessionEvents(
        target._projectId,
        target._agentInstanceId,
        target.session_id,
      )
      .then((events) => {
        // Drop results if the user switched sessions mid-flight.
        if (currentSessionIdRef.current !== anchorAtCall) return;
        const display = buildDisplayEvents(events);
        setEventsBySessionId((prev) => ({
          ...prev,
          [target.session_id]: display,
        }));
        setLoadedSessionIds((prev) =>
          prev.includes(target.session_id) ? prev : [...prev, target.session_id],
        );
      })
      .catch((err) => {
        console.error("Failed to load prior session", err);
      })
      .finally(() => {
        loadingRef.current = false;
        setIsLoadingPriorSession(false);
      });
  }, [nextOlder]);

  // Oldest-first order for display: reverse the newest-first load order.
  const displayOrderIds = useMemo(
    () => [...loadedSessionIds].reverse(),
    [loadedSessionIds],
  );

  const priorEvents = useMemo(() => {
    if (displayOrderIds.length === 0) return EMPTY_EVENTS;
    const out: DisplaySessionEvent[] = [];
    for (const id of displayOrderIds) {
      const events = eventsBySessionId[id];
      if (events) out.push(...events);
    }
    return out;
  }, [displayOrderIds, eventsBySessionId]);

  const sessionBoundaries = useMemo(() => {
    if (displayOrderIds.length === 0) return EMPTY_BOUNDARIES;
    const sessionById = new Map(
      instanceSessions.map((s) => [s.session_id, s]),
    );
    const boundaries: SessionBoundary[] = [];
    for (const id of displayOrderIds) {
      const events = eventsBySessionId[id];
      const firstEventId = events?.[0]?.id;
      if (!firstEventId) continue;
      const session = sessionById.get(id);
      boundaries.push({
        firstEventId,
        label: session ? deriveSessionLabel(session, undefined) : "Earlier session",
        startedAt: session?.started_at ?? "",
      });
    }
    // Mark where the current session begins so the user can tell prior
    // history apart from the conversation they opened.
    if (historyFirstEventId && currentSessionId) {
      const current = sessionById.get(currentSessionId);
      boundaries.push({
        firstEventId: historyFirstEventId,
        label:
          currentSessionLabel ??
          (current ? deriveSessionLabel(current, undefined) : "Current session"),
        startedAt: current?.started_at ?? "",
      });
    }
    return boundaries;
  }, [
    displayOrderIds,
    eventsBySessionId,
    instanceSessions,
    historyFirstEventId,
    currentSessionId,
    currentSessionLabel,
  ]);

  return {
    priorEvents,
    sessionBoundaries,
    hasPriorSession,
    isLoadingPriorSession,
    loadPriorSession,
  };
}
