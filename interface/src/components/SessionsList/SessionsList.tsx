import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { AlarmClock } from "lucide-react";
import { EmptyState } from "../EmptyState";
import {
  SidekickList,
  type SidekickListRow,
  type SidekickListSection,
} from "../SidekickList";
import { Pin } from "lucide-react";
import { isOptimisticSessionId } from "../../stores/sessions-list-store";
import {
  type AnnotatedSession,
  bucketizeByDate,
  deriveSessionLabel,
  type SessionRow,
} from "./session-row-utils";
import { useSessionSummaries } from "./use-session-summaries";
import {
  formatSessionWakeLabel,
  isSessionSnoozed,
  resolveSessionSnoozePresets,
} from "./session-snooze";
import { useIsSessionStreaming } from "../../hooks/use-session-streaming";
import styles from "./SessionsList.module.css";

interface SessionsListProps {
  sessions: AnnotatedSession[];
  loading: boolean;
  selectedSessionId: string | null;
  onSessionClick: (session: AnnotatedSession) => void;
  onDeleteSession?: (session: AnnotatedSession) => void;
  onArchiveSession?: (session: AnnotatedSession) => void;
  onRestoreSession?: (session: AnnotatedSession) => void;
  onRenameSession?: (session: AnnotatedSession, title: string) => void;
  onSetSessionPinned?: (session: AnnotatedSession, pinned: boolean) => void;
  onSetSessionSnoozedUntil?: (
    session: AnnotatedSession,
    snoozedUntil: string | null,
  ) => void;
  /**
   * Optional hover hook — fired on `onMouseEnter` of each row so the
   * caller can pre-warm the destination chat-history-store entry for
   * the hovered session. When the chat-history-store has the entry
   * `"ready"` at click time, `AgentChatPanel`'s `historyResolved`
   * is `true` on first render and `ChatPanel`'s cold-load reveal gate
   * stays disarmed — no `.messageContentHidden` flicker on session
   * navigation.
   */
  onSessionHover?: (session: AnnotatedSession) => void;
  /** Optional substring to filter rows by their resolved label. */
  searchQuery?: string;
  /**
   * Inline failure-banner copy for the most recent delete attempt.
   * `null`/`undefined` hides the banner. Pair with `onDismissError`
   * so the banner can be cleared after the user reads it. The agents
   * `ChatsTab` and the projects `SessionList` both read this from
   * `useSessionsDeleteError(surfaceKey)` so a 500 from
   * `DELETE /api/projects/.../sessions/...` surfaces in the UI
   * instead of vanishing into `console.error`.
   */
  deleteError?: string | null;
  onDismissError?: () => void;
  /**
   * Optional right-aligned content rendered per row. When provided this
   * replaces the default project-name suffix (used by the chat-app's
   * left panel to show the session's agent avatar on the right side of
   * each row). Returning `null`/`undefined` falls back to the default
   * behavior for that single row.
   */
  renderRowSuffix?: (session: AnnotatedSession) => ReactNode;
  /**
   * Per-session stream-lane key resolver. Mirrors `useStreamCore`'s
   * deps shape so the per-row streaming indicator subscribes to the
   * exact lane the chat panel writes to:
   *
   *   - Project chat (`useChatStream`, default): the row's own
   *     `(_projectId, _agentInstanceId, session_id)` triple.
   *   - Standalone-agent chat (`useAgentChatStream`, chat-app left
   *     panel): `(agentId, session_id)` — callers resolve the
   *     session's `agentId` first (e.g. via `bindingsByAgent`).
   *
   * Returning an empty string disables the indicator for that row
   * (the lookup hits the empty `entries[""]` slot, which is never
   * streaming). Passing `undefined` for the whole prop falls back to
   * the project-keyed default, which matches the agents-app
   * `ChatsTab` (each row maps to a project-chat lane) and the
   * projects-app `SessionList`. Phase 4 tests assert against the
   * same key shape via the exported `keyForProjectSession` /
   * `keyForAgentSession` helpers.
   */
  streamKeyForSession?: (session: AnnotatedSession) => string;
}

/**
 * Per-row streaming indicator so each row owns its own
 * `useIsSessionStreaming(session)` subscription. Hoisting the selector
 * out to the parent would re-render every row whenever any session's
 * `isStreaming` flips; subscribing per-row keeps the parent's render
 * cost flat and isolates re-renders to the rows whose lane actually
 * changed. Rendered as the row's `leadingIndicator`; returns `null` when
 * the session isn't streaming so the indicator slot stays collapsed.
 */
function SessionStreamingDot({
  session,
  streamKeyForSession,
}: {
  session: AnnotatedSession;
  streamKeyForSession?: (session: AnnotatedSession) => string;
}): ReactElement | null {
  const isStreaming = useIsSessionStreaming(session, streamKeyForSession);
  if (!isStreaming) return null;
  return (
    <span className={styles.streamingDot} aria-label="Streaming" role="status" />
  );
}

/**
 * Date-bucketed session list shared between the agents app's "Chats"
 * sidekick, the projects app's "Sessions" sidekick, and the chat app's
 * left panel. Every session the API returns is rendered immediately —
 * sessions that don't have a Haiku summary yet show as
 * `NEW_CHAT_PLACEHOLDER` ("New chat") and upgrade in place once
 * `useSessionSummaries` finishes the Haiku round-trip.
 *
 * Empty zero-event sessions are filtered out by aura-storage itself
 * (the `idx_sessions_pa_recent` / `idx_sessions_project_recent`
 * partial indexes from migration 0014, both keyed on
 * `event_count > 0`). aura-os-server is a straight pass-through, so
 * a row here is always navigable — clicking it always lands in a
 * chat with at least one user message.
 *
 * Rendering uses plain `<button>` rows (not the ZUI `Explorer`) so
 * selection state is owned by a single parent-controlled
 * `effectiveSelectedSessionId` across every date bucket. Each
 * per-bucket `Explorer` previously kept its own context / focus state
 * which made it possible for rows in different time-period sections to
 * read as simultaneously highlighted; collapsing to one selection
 * surface eliminates that.
 */
export function SessionsList({
  sessions,
  loading,
  selectedSessionId,
  onSessionClick,
  onDeleteSession,
  onArchiveSession,
  onRestoreSession,
  onRenameSession,
  onSetSessionPinned,
  onSetSessionSnoozedUntil,
  onSessionHover,
  searchQuery,
  deleteError,
  onDismissError,
  renderRowSuffix,
  streamKeyForSession,
}: SessionsListProps) {
  const safeSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []),
    [sessions],
  );
  // Track which rows are currently scrolled into view so the lazy
  // /summarize backfill in `useSessionSummaries` only fires for rows
  // the user can actually see. Without this gate, opening the
  // sidekick on an account with many legacy untitled sessions would
  // synchronously fire one Haiku LLM call per session — each loading
  // the full event transcript — even for rows the user never scrolls
  // to. Single shared `Set` flipped via the `onVisibilityChange`
  // callback wired into each `SessionRowButton`.
  const [visibleSessionIds, setVisibleSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const handleVisibilityChange = useCallback(
    (sessionId: string, visible: boolean) => {
      setVisibleSessionIds((prev) => {
        if (visible) {
          if (prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.add(sessionId);
          return next;
        }
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    },
    [],
  );

  const summaries = useSessionSummaries(safeSessions, visibleSessionIds);
  const lastHoveredSessionIdRef = useRef<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AnnotatedSession | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [snoozeClockMs, setSnoozeClockMs] = useState(() => Date.now());

  // Live-update of the row label when the backend's on-send title
  // generator (apps/aura-os-server/src/handlers/agents/sessions.rs
  // `generate_session_title`) lands a ChatGPT-style title for a
  // brand-new session is wired globally in
  // `stores/event-store/engine-event-handlers.ts`
  // `handleSessionSummaryUpdated`, not in a React effect here. Doing
  // it globally means the title is captured even if no `SessionsList`
  // is currently mounted (e.g. the user sent the message in the
  // chat panel without the sidekick open) — otherwise the user
  // would have to refresh the app to see the title.

  const sessionById = useMemo(
    () => new Map(safeSessions.map((s) => [s.session_id, s])),
    [safeSessions],
  );

  const titledRows = useMemo<SessionRow[]>(() => {
    const out: SessionRow[] = [];
    const needle = searchQuery?.trim().toLowerCase() ?? "";
    for (const session of safeSessions) {
      const label = deriveSessionLabel(session, summaries[session.session_id]);
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({ session, label });
    }
    return out;
  }, [safeSessions, summaries, searchQuery]);

  const lifecycleActiveRows = useMemo(
    () => titledRows.filter(({ session }) => session.status !== "archived"),
    [titledRows],
  );
  const archivedRows = useMemo(
    () => titledRows.filter(({ session }) => session.status === "archived"),
    [titledRows],
  );
  const snoozedRows = useMemo(
    () =>
      lifecycleActiveRows
        .filter(({ session }) => isSessionSnoozed(session, snoozeClockMs))
        .sort(
          (a, b) =>
            Date.parse(a.session.snoozed_until ?? "") -
            Date.parse(b.session.snoozed_until ?? ""),
        ),
    [lifecycleActiveRows, snoozeClockMs],
  );
  const activeRows = useMemo(
    () =>
      lifecycleActiveRows.filter(
        ({ session }) => !isSessionSnoozed(session, snoozeClockMs),
      ),
    [lifecycleActiveRows, snoozeClockMs],
  );
  const pinnedRows = useMemo(
    () =>
      activeRows
        .filter(({ session }) => Boolean(session.pinned_at))
        .sort(
          (a, b) =>
            new Date(b.session.pinned_at ?? 0).getTime() -
            new Date(a.session.pinned_at ?? 0).getTime(),
        ),
    [activeRows],
  );
  const buckets = useMemo(
    () => bucketizeByDate(activeRows.filter(({ session }) => !session.pinned_at)),
    [activeRows],
  );
  const nextWakeAtMs = useMemo(() => {
    let next: number | null = null;
    for (const { session } of snoozedRows) {
      const wakeMs = Date.parse(session.snoozed_until ?? "");
      if (!Number.isFinite(wakeMs) || wakeMs <= snoozeClockMs) continue;
      next = next == null ? wakeMs : Math.min(next, wakeMs);
    }
    return next;
  }, [snoozeClockMs, snoozedRows]);

  useEffect(() => {
    if (nextWakeAtMs == null) return;
    const delay = Math.min(
      Math.max(nextWakeAtMs - Date.now() + 25, 25),
      2_147_000_000,
    );
    const timer = window.setTimeout(() => setSnoozeClockMs(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [nextWakeAtMs]);
  // Check if sessions span multiple projects — only show the project
  // prefix when there's more than one to avoid noise in the common case.
  const hasMultipleProjects = useMemo(() => {
    const projectIds = new Set(safeSessions.map((s) => s._projectId));
    return projectIds.size > 1;
  }, [safeSessions]);

  // Highlight the row the user is actively in even when the URL hasn't
  // settled yet:
  //
  //   1. `?session=<id>` set: the URL is the source of truth.
  //   2. `?session=` empty + an optimistic row exists: pre-SessionReady
  //      "+ New chat" window. Highlight the placeholder so the user
  //      sees which chat their first send will land in.
  //   3. `?session=` empty + no optimistic row: post-`replaceSessionId`,
  //      pre-`setSearchParams` window. The row was just renamed from
  //      `optimistic:<uuid>` to the server-assigned UUID, but the
  //      router state hasn't propagated through `useSearchParams`
  //      yet. Without a fallback, the just-created row visibly
  //      appears with its summary but reads as unselected for the
  //      gap (and *persistently* in cases where the URL update was
  //      dropped — back/forward stack, suspended tab, etc.). Falling
  //      back to the newest row in the list keeps the selection on
  //      the just-created session, which sorted to the top because
  //      its `started_at` was stamped at insert time. `titledRows`
  //      is already in `sortSessionsDesc` order from
  //      `loadAgentSessions` / `loadProjectSessions` so `[0]` is the
  //      newest.
  const effectiveSelectedSessionId = useMemo(() => {
    if (selectedSessionId) return selectedSessionId;
    const optimistic = activeRows.find(({ session }) =>
      isOptimisticSessionId(session.session_id),
    );
    if (optimistic) return optimistic.session.session_id;
    return activeRows[0]?.session.session_id ?? null;
  }, [selectedSessionId, activeRows]);

  const handleMenuAction = useCallback(
    (actionId: string, rowId: string) => {
      const target = sessionById.get(rowId);
      if (!target) return;
      if (actionId === "rename") {
        setRenameTarget(target);
        setRenameValue(
          deriveSessionLabel(target, summaries[target.session_id]),
        );
      }
      if (actionId === "pin") onSetSessionPinned?.(target, true);
      if (actionId === "unpin") onSetSessionPinned?.(target, false);
      if (actionId === "archive") onArchiveSession?.(target);
      if (actionId === "restore") onRestoreSession?.(target);
      if (actionId === "delete") {
        onDeleteSession?.(target);
        return;
      }
      if (actionId === "wake") {
        onSetSessionSnoozedUntil?.(target, null);
        return;
      }
      if (actionId === "snooze-hour" || actionId === "snooze-tomorrow") {
        const presetId = actionId === "snooze-hour" ? "hour" : "tomorrow";
        const preset = resolveSessionSnoozePresets(new Date()).find(
          (candidate) => candidate.id === presetId,
        );
        if (preset) {
          onSetSessionSnoozedUntil?.(target, preset.snoozedUntil);
        }
      }
    },
    [
      sessionById,
      summaries,
      onSetSessionPinned,
      onSetSessionSnoozedUntil,
      onArchiveSession,
      onRestoreSession,
      onDeleteSession,
    ],
  );

  const menuActionsForRow = useCallback(
    (row: SidekickListRow) => {
      const target = sessionById.get(row.id);
      if (!target) return [];
      if (target.status === "archived") {
        return [
          ...(onRenameSession ? (["rename"] as const) : []),
          ...(onRestoreSession ? (["restore"] as const) : []),
          ...(onDeleteSession ? (["delete"] as const) : []),
        ];
      }
      const snoozed = isSessionSnoozed(target, snoozeClockMs);
      return [
        ...(onRenameSession ? (["rename"] as const) : []),
        ...(onSetSessionPinned && !isOptimisticSessionId(target.session_id)
          ? ([target.pinned_at ? "unpin" : "pin"] as const)
          : []),
        ...(onSetSessionSnoozedUntil &&
        !isOptimisticSessionId(target.session_id)
          ? snoozed
            ? (["wake"] as const)
            : (["snooze-hour", "snooze-tomorrow"] as const)
          : []),
        ...(onArchiveSession ? (["archive"] as const) : []),
        ...(onDeleteSession ? (["delete"] as const) : []),
      ];
    },
    [
      sessionById,
      snoozeClockMs,
      onRenameSession,
      onSetSessionPinned,
      onSetSessionSnoozedUntil,
      onArchiveSession,
      onRestoreSession,
      onDeleteSession,
    ],
  );

  const submitRename = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const title = renameValue.trim();
      if (!renameTarget || !title) return;
      onRenameSession?.(renameTarget, title);
      setRenameTarget(null);
      setRenameValue("");
    },
    [onRenameSession, renameTarget, renameValue],
  );

  const cancelRename = useCallback(() => {
    setRenameTarget(null);
    setRenameValue("");
  }, []);

  const handleRowMouseEnter = useCallback(
    (session: AnnotatedSession) => {
      if (!onSessionHover) return;
      if (lastHoveredSessionIdRef.current === session.session_id) return;
      lastHoveredSessionIdRef.current = session.session_id;
      onSessionHover(session);
    },
    [onSessionHover],
  );

  const toSidekickRow = useCallback(
    ({ session, label }: SessionRow): SidekickListRow => {
      const customSuffix = renderRowSuffix?.(session) ?? null;
      const defaultSuffix =
        hasMultipleProjects && session._projectName ? (
          <span className={styles.sessionProject}>{session._projectName}</span>
        ) : null;
      const suffix = customSuffix !== null ? customSuffix : defaultSuffix;
      const snoozed =
        session.status !== "archived" &&
        isSessionSnoozed(session, snoozeClockMs);
      return {
        id: session.session_id,
        label,
        detail:
          snoozed && session.snoozed_until
            ? formatSessionWakeLabel(session.snoozed_until)
            : undefined,
        icon: snoozed ? (
          <AlarmClock size={13} aria-label="Snoozed" />
        ) : session.pinned_at ? (
          <Pin size={13} aria-label="Pinned" />
        ) : undefined,
        leadingIndicator: (
          <SessionStreamingDot
            session={session}
            streamKeyForSession={streamKeyForSession}
          />
        ),
        suffix,
        onSelect: () => onSessionClick(session),
        onMouseEnter: () => handleRowMouseEnter(session),
        onFocus: () => handleRowMouseEnter(session),
        onVisibilityChange: (visible: boolean) =>
          handleVisibilityChange(session.session_id, visible),
      };
    },
    [
      renderRowSuffix,
      hasMultipleProjects,
      snoozeClockMs,
      streamKeyForSession,
      onSessionClick,
      handleRowMouseEnter,
      handleVisibilityChange,
    ],
  );

  const sections = useMemo<SidekickListSection[]>(
    () => [
      ...(pinnedRows.length > 0
        ? [
            {
              id: "pinned",
              label: "Pinned",
              rows: pinnedRows.map(toSidekickRow),
            },
          ]
        : []),
      ...buckets.map((bucket) => ({
        id: bucket.label,
        label: bucket.label,
        rows: bucket.rows.map(toSidekickRow),
      })),
      ...(snoozedRows.length > 0
        ? [
            {
              id: "snoozed",
              label: "Snoozed",
              rows: snoozedRows.map(toSidekickRow),
              defaultExpanded: Boolean(searchQuery?.trim()),
            },
          ]
        : []),
      ...(archivedRows.length > 0
        ? [
            {
              id: "archived",
              label: `Archived (${archivedRows.length})`,
              rows: archivedRows.map(toSidekickRow),
              defaultExpanded: archivedRows.some(
                ({ session }) => session.session_id === selectedSessionId,
              ),
            },
          ]
        : []),
    ],
    [
      buckets,
      pinnedRows,
      snoozedRows,
      archivedRows,
      searchQuery,
      selectedSessionId,
      toSidekickRow,
    ],
  );

  const errorBanner = deleteError ? (
    <div className={styles.errorBanner} role="alert">
      <span className={styles.errorBannerMessage}>{deleteError}</span>
      {onDismissError && (
        <button
          type="button"
          className={styles.errorBannerDismiss}
          onClick={onDismissError}
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
      {errorBanner}
      {renameTarget ? (
        <form
          className={styles.renameForm}
          onSubmit={submitRename}
          aria-label="Rename session"
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={120}
            aria-label="Session title"
          />
          <button type="submit" disabled={!renameValue.trim()}>
            Save
          </button>
          <button type="button" onClick={cancelRename}>
            Cancel
          </button>
        </form>
      ) : null}
      <SidekickList
        sections={sections}
        selectedId={effectiveSelectedSessionId}
        loading={loading && safeSessions.length === 0}
        loadingLabel="Loading sessions..."
        empty={<EmptyState>No sessions yet</EmptyState>}
        menuActions={
          onRenameSession ||
          onSetSessionPinned ||
          onSetSessionSnoozedUntil ||
          onDeleteSession ||
          onArchiveSession ||
          onRestoreSession
            ? menuActionsForRow
            : undefined
        }
        onMenuAction={
          onRenameSession ||
          onSetSessionPinned ||
          onSetSessionSnoozedUntil ||
          onDeleteSession ||
          onArchiveSession ||
          onRestoreSession
            ? handleMenuAction
            : undefined
        }
        className={styles.chatsList}
      />
    </>
  );
}
