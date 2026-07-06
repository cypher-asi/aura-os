import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api, ApiClientError } from "../api/client";
import { sessionsApi } from "../shared/api/agents";
// `useProjectsListStore` and `useAgentStore` are both loaded
// dynamically inside the loader bodies (the sole consumers in this
// file) to break a static circular dep that would otherwise put
// `useAuthStore` in TDZ at boot:
//   auth-store -> event-store -> engine-event-handlers ->
//   sessions-list-store -> projects-list-store -> useAuthStore.subscribe(...)
//   (and the same chain through apps/agents/stores/agent-store)
// Both projects-list-store and agent-store call
// `useAuthStore.subscribe(...)` at module top level, and any static
// import here would force their evaluation while auth-store's own
// top-level `const useAuthStore = create(...)` is still running,
// throwing "Cannot access 'useAuthStore' before initialization".
import type { AnnotatedSession } from "../components/SessionsList";
import type { Session } from "../shared/types";

/**
 * Server-authoritative project_agent binding for an agent template,
 * matches the shape returned by `GET /api/agents/:agent_id/projects`
 * (see [`list_agent_project_bindings`](apps/aura-os-server/src/handlers/agents/crud/delete.rs)).
 */
export interface AgentProjectBinding {
  project_agent_id: string;
  project_id: string;
  project_name: string;
}

/** Per-agent fetch state for `bindingsByAgent`. Used by consumers that
 *  need to distinguish "still loading" from "loaded empty" — e.g. the
 *  agents shell wants to render `pending` rather than the standalone
 *  fresh-canvas view while the binding fetch is in flight. */
export type BindingsLoadStatus = "idle" | "loading" | "loaded" | "error";

/** Synthetic session-id prefix for optimistic rows inserted on send. */
export const OPTIMISTIC_SESSION_ID_PREFIX = "optimistic:";

/**
 * `true` when the row is an optimistic placeholder this client inserted
 * after the user pressed `+` and sent a message but before the server
 * has streamed back `SessionReady` with the real id.
 */
export function isOptimisticSessionId(sessionId: string): boolean {
  return sessionId.startsWith(OPTIMISTIC_SESSION_ID_PREFIX);
}

export function findMostRecentRealSession(
  sessions: AnnotatedSession[] | undefined,
): AnnotatedSession | null {
  if (!sessions || sessions.length === 0) return null;
  return sessions.find((s) => !isOptimisticSessionId(s.session_id)) ?? null;
}

export function findMostRecentRealSessionForInstance(
  sessions: AnnotatedSession[] | undefined,
  agentInstanceId: string | undefined,
): AnnotatedSession | null {
  if (!agentInstanceId || !sessions || sessions.length === 0) return null;
  return (
    sessions.find(
      (s) =>
        s._agentInstanceId === agentInstanceId &&
        !isOptimisticSessionId(s.session_id),
    ) ?? null
  );
}

/**
 * Builds an `AnnotatedSession` placeholder for the just-sent first
 * turn of a fresh chat. Empty `summary_of_previous_context` falls
 * through to `NEW_CHAT_PLACEHOLDER` ("New chat") in
 * `deriveSessionLabel`, matching how a real zero-summary session
 * would render. `started_at` defaults to now so the row sorts to the
 * top of `sortSessionsDesc`.
 */
export function buildOptimisticSession(args: {
  optimisticId: string;
  projectId: string;
  projectName: string;
  agentInstanceId: string;
  startedAt?: string;
}): AnnotatedSession {
  const startedAt = args.startedAt ?? new Date().toISOString();
  const session: Session = {
    session_id: args.optimisticId,
    agent_instance_id: args.agentInstanceId,
    project_id: args.projectId,
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "active",
    started_at: startedAt,
    ended_at: null,
  };
  return {
    ...session,
    _projectName: args.projectName,
    _projectId: args.projectId,
    _agentInstanceId: args.agentInstanceId,
  };
}

/**
 * Centralized session-list state shared by every surface that lists
 * sessions: the agents `ChatsTab` sidekick, the projects `SessionList`
 * sidekick, and both default-session redirect hooks. Keeping one store
 * means we only fetch each list once per surface, and the redirects
 * read the same array the sidekick is rendering instead of duplicating
 * the API call.
 *
 * Surface keys are namespaced so the agents-app and projects-app
 * surfaces never collide:
 * - `agent:{agentId}`     — every session across the agent's bindings
 * - `project:{projectId}` — every session across an entire project
 *
 * `version` is preserved as a write-side bump that consumers fold into
 * their effect dependencies; calling `bumpVersion()` after a stream
 * emits `SessionReady` (or after the chat-input "+" new-chat reset)
 * re-runs the load so newly-persisted sessions surface without a
 * manual refresh.
 */

const EMPTY_SESSIONS: AnnotatedSession[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isSessionLike(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  return (
    typeof value.session_id === "string" &&
    typeof value.agent_instance_id === "string" &&
    typeof value.project_id === "string" &&
    typeof value.started_at === "string"
  );
}

function coerceSessionArray<T extends Session>(
  value: unknown,
  source: string,
): T[] {
  const candidate = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.sessions)
      ? value.sessions
      : null;

  if (!candidate) {
    console.warn(`${source} returned a non-array session list; ignoring`, {
      receivedType: value === null ? "null" : typeof value,
    });
    return [];
  }

  const sessions = candidate.filter(isSessionLike) as T[];
  if (sessions.length !== candidate.length) {
    console.warn(`${source} returned malformed session rows; ignoring invalid rows`, {
      received: candidate.length,
      accepted: sessions.length,
    });
  }
  return sessions;
}

function isAgentProjectBinding(value: unknown): value is AgentProjectBinding {
  if (!isRecord(value)) return false;
  return (
    typeof value.project_agent_id === "string" &&
    typeof value.project_id === "string" &&
    typeof value.project_name === "string"
  );
}

function coerceAgentProjectBindings(
  value: unknown,
  source: string,
): AgentProjectBinding[] {
  if (!Array.isArray(value)) {
    console.warn(`${source} returned a non-array binding list; ignoring`, {
      receivedType: value === null ? "null" : typeof value,
    });
    return [];
  }
  const bindings = value.filter(isAgentProjectBinding);
  if (bindings.length !== value.length) {
    console.warn(`${source} returned malformed bindings; ignoring invalid rows`, {
      received: value.length,
      accepted: bindings.length,
    });
  }
  return bindings;
}

function ensureAnnotatedSessionArray(
  value: AnnotatedSession[] | undefined,
): AnnotatedSession[] {
  return Array.isArray(value) ? value : EMPTY_SESSIONS;
}

export function agentSessionsSurfaceKey(agentId: string): string {
  return `agent:${agentId}`;
}

export function projectSessionsSurfaceKey(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Singleton surface key for the current user's cross-agent session
 * list. Backed by `loadUserSessions` against the
 * `/api/me/sessions` endpoint (aura-storage migration 0015's
 * `idx_sessions_user_recent` partial index). Used exclusively by
 * the chat-app left panel; per-agent and per-project surfaces
 * continue to key off `agentSessionsSurfaceKey` /
 * `projectSessionsSurfaceKey` because those are already 1 HTTP
 * call each post-`perf/instant-session-list`.
 */
export const USER_SESSIONS_SURFACE_KEY = "user:me";

export function userSessionsSurfaceKey(): string {
  return USER_SESSIONS_SURFACE_KEY;
}

interface SessionsListStore {
  /** Newest-first AnnotatedSession arrays keyed by surface. */
  sessionsBySurface: Record<string, AnnotatedSession[]>;
  /** Active in-flight load per surface (for empty-state UX). */
  loadingBySurface: Record<string, boolean>;
  /**
   * Server-authoritative project_agent bindings keyed by template
   * `agent_id`. Populated by `loadAgentSessions` from
   * `api.agents.listProjectBindings`, which walks every project the
   * caller's JWT can see — including the auto-created Home project
   * that may not be present in the active-org-scoped
   * `useProjectsListStore.projects` snapshot. This is the source the
   * agents-app sidekick uses to find which `(project, project_agent)`
   * pairs to fan out `listSessions` over, so an agent whose only
   * binding is in a project not visible in the active sidebar still
   * shows its session history.
   */
  bindingsByAgent: Record<string, AgentProjectBinding[]>;
  /** Per-agent load status for `bindingsByAgent`. */
  bindingsLoadStatusByAgent: Record<string, BindingsLoadStatus>;
  /**
   * Pending session summaries keyed by their *real* `session_id`. The
   * on-send title generator (Haiku) can land before `SessionReady`
   * delivers the real id to the client, in which case
   * `setSessionSummary` has no row yet to patch. Stashing the summary
   * here lets `replaceSessionId` apply it the moment the optimistic
   * placeholder is swapped for the real id, so the title survives
   * the swap without ever cross-contaminating an unrelated optimistic
   * row that happens to be in flight for a different session.
   */
  pendingSummariesById: Record<string, string>;
  /**
   * Most-recent failed-delete message per surface, surfaced inline by
   * `SessionsList` as a small dismissible banner. `null` (or missing
   * key) means "no error to show". Lives in the store rather than
   * local component state so the agents-app `ChatsTab` and the
   * projects-app `SessionList` reuse the same plumbing without each
   * building their own toast wrapper.
   */
  deleteErrorBySurface: Record<string, string | null>;
  /** Bumped on every relevant write so polling consumers can re-run. */
  version: number;
  bumpVersion: () => void;
  /** Fan-out fetch across every project the agent is bound to. */
  loadAgentSessions: (agentId: string) => Promise<void>;
  /**
   * Bindings-only refresh for an agent. Populates `bindingsByAgent`
   * without the per-binding session fan-out `loadAgentSessions`
   * does. Used by the chat-app left panel for the "+" button's
   * `ceoHomeProjectId` lookup, which needs the chat agent's project
   * binding list but no longer needs to fan out session calls (the
   * panel reads sessions from `loadUserSessions` instead).
   */
  loadAgentBindings: (agentId: string) => Promise<void>;
  /**
   * User-scoped cross-agent session fetch. Single HTTP call that
   * collapses the chat-app left panel's previous `A x (1 + B)` fan-out
   * (one `listProjectBindings` per agent + one `listSessions` per
   * binding) into one indexed query against aura-storage's
   * `idx_sessions_user_recent` partial index (migration 0015).
   *
   * Annotates each row with `_agentId`, `_projectId`,
   * `_agentInstanceId`, `_projectName` so the left panel can
   * render avatars and project labels off the row directly. Project
   * name comes from `useProjectsListStore.projects` (the wire shape
   * deliberately omits it -- aura-storage has no `projects` table,
   * and pre-fetched names live in the FE cache); rows whose
   * project is missing from the cache fall back to an empty
   * `_projectName`, matching the
   * `hasMultipleProjects && session._projectName` render guard in
   * `SessionsList`.
   */
  loadUserSessions: () => Promise<void>;
  /** Single project-wide fetch annotating rows with project metadata. */
  loadProjectSessions: (projectId: string, projectName: string) => Promise<void>;
  /** Optimistic delete; pair with `restoreSession` to undo on error. */
  removeSession: (surfaceKey: string, sessionId: string) => void;
  restoreSession: (surfaceKey: string, session: AnnotatedSession) => void;
  /**
   * Insert a placeholder row for a brand-new session immediately, before
   * the server has streamed back `SessionReady`. Caller should pair with
   * `replaceSessionId` once the real id arrives. Idempotent on
   * `session_id`. The row carries the `OPTIMISTIC_SESSION_ID_PREFIX`
   * marker so concurrent `loadAgentSessions` / `loadProjectSessions`
   * calls preserve it across the merge.
   */
  addOptimisticSession: (surfaceKey: string, session: AnnotatedSession) => void;
  /**
   * Rewrite a row's `session_id` in place. Used to swap an optimistic
   * id for the real one once `SessionReady` arrives, keeping the row's
   * sort position and any summary that may have been resolved against
   * the optimistic id intact.
   */
  replaceSessionId: (
    surfaceKey: string,
    oldSessionId: string,
    newSessionId: string,
  ) => void;
  /**
   * Patch the persisted `summary_of_previous_context` for a session
   * across every surface that currently holds a row for it. Driven
   * by the `session_summary_updated` WebSocket event published from
   * the backend's on-send title generator (see
   * `apps/aura-os-server/src/handlers/agents/sessions.rs`
   * `generate_session_title`), so the sidekick label flips from
   * "New chat" to the ChatGPT-style title before the assistant turn
   * finishes streaming. Surfaces that don't currently hold the row
   * keep their existing array reference to avoid spurious renders.
   */
  setSessionSummary: (sessionId: string, summary: string) => void;
  /** Surface the user-facing reason a delete failed for `surfaceKey`. */
  setDeleteError: (surfaceKey: string, message: string | null) => void;
}

export function sortSessionsDesc(
  sessions: AnnotatedSession[],
): AnnotatedSession[] {
  return [...sessions].sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

/** Hard cap on how long a locally-known row may be carried across a
 *  stale list reload before we trust the server's view. 5 minutes is
 *  generous: the typical window between a `SessionReady` swap and the
 *  next list call materializing the real id is sub-second; the cap is
 *  purely a safety net for orphaned local state. */
const PENDING_ROW_PRESERVE_TTL_MS = 5 * 60 * 1000;

/**
 * Carry forward locally-known rows that the server's just-returned
 * list doesn't include yet. Two failure modes this guards against,
 * both of which manifested as "row flickers out and back in" in
 * `SessionsList`:
 *
 *   1. Optimistic placeholders inserted before SessionReady arrives.
 *      `list_sessions` filters out zero-event sessions, so a refetch
 *      kicked off after `+ New chat` (e.g. by another component's
 *      `bumpVersion`) won't include the just-created session. Once
 *      `replaceSessionId` swaps the marker for the real id, the
 *      placeholder is no longer optimistic and falls into case (2).
 *   2. Just-swapped real-id rows. After `replaceSessionId` runs, a
 *      stale list response that started flying before the swap will
 *      arrive without the new id. Without preservation the just-
 *      created row disappears from the sidekick for ~the
 *      `loadSessions` round-trip, then pops back when the next
 *      version-bump triggers a follow-up load. The user sees this
 *      as a "New chat" row vanishing right after sending the first
 *      message.
 *
 * Real-id preservation is bounded by a `started_at`/TTL guard so a
 * server that's authoritatively dropped a row (delete from another
 * tab, soft-delete, etc.) eventually wins out. `removeSession` is the
 * primary path for "drop a row I know is gone" — this preservation is
 * for the race where the server *will* return the row but hasn't yet.
 */
function preservePendingRows(
  prev: AnnotatedSession[] | undefined,
  next: AnnotatedSession[],
): AnnotatedSession[] {
  if (!prev || prev.length === 0) return next;
  const seen = new Set(next.map((s) => s.session_id));
  const newestServerMsByBinding = new Map<string, number>();
  const newestServerMs = next.reduce(
    (acc, s) => {
      const rowMs = new Date(s.started_at).getTime();
      if (Number.isNaN(rowMs)) return acc;
      const key = `${s._projectId}:${s._agentInstanceId}`;
      newestServerMsByBinding.set(
        key,
        Math.max(newestServerMsByBinding.get(key) ?? 0, rowMs),
      );
      return Math.max(acc, rowMs);
    },
    0,
  );
  const nowMs = Date.now();
  const carried = prev.filter((s) => {
    if (seen.has(s.session_id)) return false;
    const rowMs = new Date(s.started_at).getTime();
    if (isOptimisticSessionId(s.session_id)) {
      if (Number.isNaN(rowMs)) return true;
      const key = `${s._projectId}:${s._agentInstanceId}`;
      if ((newestServerMsByBinding.get(key) ?? 0) >= rowMs) return false;
      return true;
    }
    if (Number.isNaN(rowMs)) return false;
    if (rowMs <= newestServerMs) return false;
    if (nowMs - rowMs > PENDING_ROW_PRESERVE_TTL_MS) return false;
    return true;
  });
  if (carried.length === 0) return next;
  return sortSessionsDesc([...next, ...carried]);
}

/**
 * Apply `pendingSummariesById` titles to any incoming session rows
 * whose server-provided `summary_of_previous_context` is empty. The
 * Haiku title generator can land via the `session_summary_updated`
 * WebSocket event before the just-triggered `loadProjectSessions` /
 * `loadAgentSessions` resolves. Without this merge the load would
 * overwrite the in-memory row with the server's empty summary and the
 * cached title would never make it back onto the row, leaving the
 * sidekick stuck on "New chat".
 *
 * Returns the same array reference when nothing changes so consumers
 * subscribed via `useShallow` don't see a spurious update.
 */
function applyPendingSummariesToList(
  list: AnnotatedSession[],
  pendingSummariesById: Record<string, string>,
): AnnotatedSession[] {
  let mutated = false;
  const next = list.map((row) => {
    const cached = pendingSummariesById[row.session_id];
    if (!cached) return row;
    if (row.summary_of_previous_context) return row;
    mutated = true;
    return { ...row, summary_of_previous_context: cached };
  });
  return mutated ? next : list;
}

/**
 * Drop entries from `pendingSummariesById` that have now been
 * materialized onto a row in `list`. Keeps the cache from growing
 * unboundedly while leaving entries that haven't yet found a home
 * (the optimistic-row swap path still consumes those in
 * `replaceSessionId`).
 */
function dropAppliedEntries(
  pendingSummariesById: Record<string, string>,
  list: AnnotatedSession[],
): Record<string, string> {
  const ids = Object.keys(pendingSummariesById);
  if (ids.length === 0) return pendingSummariesById;
  let next: Record<string, string> | null = null;
  for (const row of list) {
    const cached = pendingSummariesById[row.session_id];
    if (cached === undefined) continue;
    if (row.summary_of_previous_context !== cached) continue;
    if (!next) next = { ...pendingSummariesById };
    delete next[row.session_id];
  }
  return next ?? pendingSummariesById;
}

// Per-surface request-id counters keep racing responses from clobbering
// each other when, e.g., a stream-driven `bumpVersion` lands while a
// previous load is still in flight.
const surfaceRequestIds: Record<string, number> = {};

/**
 * Pre-migration-0015 cross-agent fan-out used as a fallback when
 * `/api/me/sessions` 404s (aura-storage Render deploy hasn't picked
 * up the new endpoint yet -- see the call site in
 * [`loadUserSessions`] for the full story). Walks the user's agent
 * list, fetches every agent's `listProjectBindings`, then fans
 * `listSessions` per binding, mirroring the per-agent path
 * [`loadAgentSessions`] takes. Each call is wrapped in `.catch`
 * fail-open so one bad agent / binding can't poison the entire panel
 * -- matches the server-side fallback's resilience guarantee in
 * `list_project_sessions_legacy`.
 *
 * Returns rows already annotated with `_agentId`, `_agentInstanceId`,
 * `_projectId`, `_projectName` so the caller's fast-path annotation
 * step can be skipped. Project names come straight from the binding
 * (`listProjectBindings` already carries `project_name`), which is
 * strictly more accurate than the fast path's
 * `useProjectsListStore`-cache lookup for projects that live outside
 * the active org (e.g. the auto-Home project of a remote agent
 * bound on creation).
 *
 * `useAgentStore` is loaded dynamically to keep the auth-store TDZ
 * boundary intact -- see the import block at the top of this file.
 */
async function loadUserSessionsLegacy(): Promise<AnnotatedSession[]> {
  const { useAgentStore } = await import("../apps/agents/stores/agent-store");
  // Idempotent: `fetchAgents` short-circuits on a recent ready state
  // and dedupes concurrent callers via its in-flight promise. We
  // await unconditionally so the fan-out always sees a populated
  // list on cold mount; the no-op branch is cheap.
  await useAgentStore.getState().fetchAgents();
  const agents = useAgentStore.getState().agents;
  if (agents.length === 0) return [];

  const perAgent = await Promise.all(
    agents.map(async (agent): Promise<AnnotatedSession[]> => {
      let bindings: AgentProjectBinding[];
      try {
        bindings = coerceAgentProjectBindings(
          await api.agents.listProjectBindings(agent.agent_id),
          "GET /api/agents/:agentId/projects",
        );
      } catch (err) {
        console.warn(
          "loadUserSessionsLegacy: listProjectBindings failed; skipping agent",
          { agentId: agent.agent_id, err },
        );
        return [];
      }
      const perBinding = await Promise.all(
        bindings.map((b) =>
          api
            .listSessions(b.project_id, b.project_agent_id)
            .then((list) =>
              coerceSessionArray<Session>(
                list,
                "GET /api/projects/:projectId/agents/:agentInstanceId/sessions",
              ).map<AnnotatedSession>((s) => ({
                ...s,
                _projectName: b.project_name,
                _projectId: b.project_id,
                _agentInstanceId: b.project_agent_id,
                _agentId: agent.agent_id,
              })),
            )
            .catch(() => [] as AnnotatedSession[]),
        ),
      );
      return perBinding.flat();
    }),
  );

  return sortSessionsDesc(perAgent.flat());
}

export const useSessionsListStore = create<SessionsListStore>((set, get) => ({
  sessionsBySurface: {},
  loadingBySurface: {},
  bindingsByAgent: {},
  bindingsLoadStatusByAgent: {},
  pendingSummariesById: {},
  deleteErrorBySurface: {},
  version: 0,

  bumpVersion: () => set((s) => ({ version: s.version + 1 })),

  loadAgentSessions: async (agentId) => {
    const surfaceKey = agentSessionsSurfaceKey(agentId);
    const requestId = (surfaceRequestIds[surfaceKey] ?? 0) + 1;
    surfaceRequestIds[surfaceKey] = requestId;

    set((state) => ({
      loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: true },
      bindingsLoadStatusByAgent: {
        ...state.bindingsLoadStatusByAgent,
        [agentId]: "loading",
      },
    }));

    // Authoritative binding discovery comes from the server, NOT from
    // the active-org-scoped `useProjectsListStore`. The previous
    // implementation walked `projects × agentsByProject`, which only
    // exposes bindings whose project is currently in the active org's
    // projects list. The server-side chat / persistence pipeline
    // (`find_matching_project_agents`, `list_agent_project_bindings`)
    // walks every project the JWT can see — including the auto-created
    // Home project a remote agent gets bound to on creation. The mismatch
    // meant chats persisted fine but the sidekick "Chats" tab silently
    // listed zero bindings and rendered "No sessions yet" while sessions
    // existed in storage.
    let bindings: AgentProjectBinding[];
    try {
      bindings = coerceAgentProjectBindings(
        await api.agents.listProjectBindings(agentId),
        "GET /api/agents/:agentId/projects",
      );
    } catch (err) {
      if (surfaceRequestIds[surfaceKey] !== requestId) return;
      console.error("Failed to load agent project bindings", err);
      set((state) => ({
        loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: false },
        bindingsLoadStatusByAgent: {
          ...state.bindingsLoadStatusByAgent,
          [agentId]: "error",
        },
      }));
      return;
    }
    if (surfaceRequestIds[surfaceKey] !== requestId) return;

    set((state) => ({
      bindingsByAgent: { ...state.bindingsByAgent, [agentId]: bindings },
      bindingsLoadStatusByAgent: {
        ...state.bindingsLoadStatusByAgent,
        [agentId]: "loaded",
      },
    }));

    try {
      const results = await Promise.all(
        bindings.map((b) =>
          api
            .listSessions(b.project_id, b.project_agent_id)
            .then((list) =>
              coerceSessionArray<Session>(
                list,
                "GET /api/projects/:projectId/agents/:agentInstanceId/sessions",
              ).map<AnnotatedSession>((s) => ({
                ...s,
                _projectName: b.project_name,
                _projectId: b.project_id,
                _agentInstanceId: b.project_agent_id,
              })),
            )
            .catch(() => [] as AnnotatedSession[]),
        ),
      );
      if (surfaceRequestIds[surfaceKey] !== requestId) return;
      const merged = sortSessionsDesc(results.flat());
      set((state) => {
        const withCachedTitles = applyPendingSummariesToList(
          merged,
          state.pendingSummariesById,
        );
        const finalList = preservePendingRows(
          state.sessionsBySurface[surfaceKey],
          withCachedTitles,
        );
        const nextPending = dropAppliedEntries(
          state.pendingSummariesById,
          finalList,
        );
        return {
          sessionsBySurface: {
            ...state.sessionsBySurface,
            [surfaceKey]: finalList,
          },
          ...(nextPending !== state.pendingSummariesById
            ? { pendingSummariesById: nextPending }
            : {}),
        };
      });
    } catch (err) {
      console.error("Failed to load agent sessions", err);
    } finally {
      if (surfaceRequestIds[surfaceKey] === requestId) {
        set((state) => ({
          loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: false },
        }));
      }
    }
  },

  loadAgentBindings: async (agentId) => {
    set((state) => ({
      bindingsLoadStatusByAgent: {
        ...state.bindingsLoadStatusByAgent,
        [agentId]: "loading",
      },
    }));
    try {
      const bindings = coerceAgentProjectBindings(
        await api.agents.listProjectBindings(agentId),
        "GET /api/agents/:agentId/projects",
      );
      set((state) => ({
        bindingsByAgent: { ...state.bindingsByAgent, [agentId]: bindings },
        bindingsLoadStatusByAgent: {
          ...state.bindingsLoadStatusByAgent,
          [agentId]: "loaded",
        },
      }));
    } catch (err) {
      console.error("Failed to load agent project bindings", err);
      set((state) => ({
        bindingsLoadStatusByAgent: {
          ...state.bindingsLoadStatusByAgent,
          [agentId]: "error",
        },
      }));
    }
  },

  loadUserSessions: async () => {
    const surfaceKey = userSessionsSurfaceKey();
    const requestId = (surfaceRequestIds[surfaceKey] ?? 0) + 1;
    surfaceRequestIds[surfaceKey] = requestId;

    set((state) => ({
      loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: true },
    }));

    try {
      // Fast path: single indexed query into aura-storage's
      // `idx_sessions_user_recent` partial index (migration 0015).
      // Returns `null` instead of throwing on a 404 so the legacy
      // fan-out can step in -- aura-storage's Render deploy can lag
      // the aura-os-server deploy by a deploy cycle, during which
      // `/api/me/sessions` 404s. This is the FE companion of the
      // server-side fallback in `list_project_sessions` (commit
      // fb9a45...); the chat-app left panel surface couldn't be
      // fixed server-side because the server can't enumerate a
      // user's agents without going through aura-network.
      //
      // ONLY a 404 trips the fallback; 5xx / network / other 4xx
      // errors still bubble up so genuine outages keep surfacing as
      // a console.error and don't silently mask themselves as an
      // empty list.
      const fastList = await sessionsApi.listMySessions().catch((err) => {
        if (err instanceof ApiClientError && err.status === 404) {
          return null;
        }
        throw err;
      });
      if (surfaceRequestIds[surfaceKey] !== requestId) return;

      let annotated: AnnotatedSession[];
      if (fastList !== null) {
        // Resolve project names from the projects-list-store cache.
        // The wire shape from `/api/me/sessions` deliberately omits
        // `project_name` (aura-storage has no `projects` table -- the
        // canonical name lives in aura-os, mirrored client-side in
        // `useProjectsListStore.projects`). Reading the snapshot
        // here is a one-shot lookup, not a subscription, so a later
        // projects refresh won't auto-rename rows; the next
        // `loadUserSessions` call (e.g. on `bumpVersion`) picks up
        // the updated names. Dynamic import (vs. static at the top of
        // this file) is load-bearing: see the comment on the import
        // block at the top for the auth-store TDZ cycle it breaks.
        const { useProjectsListStore } = await import("./projects-list-store");
        const projectsById = new Map(
          useProjectsListStore
            .getState()
            .projects.map((p) => [p.project_id, p.name]),
        );

        const safeFastList = coerceSessionArray<
          Awaited<ReturnType<typeof sessionsApi.listMySessions>>[number]
        >(fastList, "GET /api/me/sessions");
        annotated = sortSessionsDesc(
          safeFastList.map<AnnotatedSession>((s) => ({
            ...s,
            _projectName: projectsById.get(s.project_id) ?? "",
            _projectId: s.project_id,
            _agentInstanceId: s.agent_instance_id,
            _agentId: s.agent_id,
          })),
        );
      } else {
        annotated = await loadUserSessionsLegacy();
        if (surfaceRequestIds[surfaceKey] !== requestId) return;
      }

      set((state) => {
        const withCachedTitles = applyPendingSummariesToList(
          annotated,
          state.pendingSummariesById,
        );
        const finalList = preservePendingRows(
          state.sessionsBySurface[surfaceKey],
          withCachedTitles,
        );
        const nextPending = dropAppliedEntries(
          state.pendingSummariesById,
          finalList,
        );
        return {
          sessionsBySurface: {
            ...state.sessionsBySurface,
            [surfaceKey]: finalList,
          },
          ...(nextPending !== state.pendingSummariesById
            ? { pendingSummariesById: nextPending }
            : {}),
        };
      });
    } catch (err) {
      console.error("Failed to load user sessions", err);
    } finally {
      if (surfaceRequestIds[surfaceKey] === requestId) {
        set((state) => ({
          loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: false },
        }));
      }
    }
  },

  loadProjectSessions: async (projectId, projectName) => {
    const surfaceKey = projectSessionsSurfaceKey(projectId);
    const requestId = (surfaceRequestIds[surfaceKey] ?? 0) + 1;
    surfaceRequestIds[surfaceKey] = requestId;

    set((state) => ({
      loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: true },
    }));

    try {
      const list = coerceSessionArray<Session>(
        await api.listProjectSessions(projectId),
        "GET /api/projects/:projectId/sessions",
      );
      if (surfaceRequestIds[surfaceKey] !== requestId) return;
      const annotated = sortSessionsDesc(
        list.map<AnnotatedSession>((s) => ({
          ...s,
          _projectName: projectName,
          _projectId: s.project_id,
          _agentInstanceId: s.agent_instance_id,
        })),
      );
      set((state) => {
        const withCachedTitles = applyPendingSummariesToList(
          annotated,
          state.pendingSummariesById,
        );
        const finalList = preservePendingRows(
          state.sessionsBySurface[surfaceKey],
          withCachedTitles,
        );
        const nextPending = dropAppliedEntries(
          state.pendingSummariesById,
          finalList,
        );
        return {
          sessionsBySurface: {
            ...state.sessionsBySurface,
            [surfaceKey]: finalList,
          },
          ...(nextPending !== state.pendingSummariesById
            ? { pendingSummariesById: nextPending }
            : {}),
        };
      });
    } catch (err) {
      console.error("Failed to load project sessions", err);
    } finally {
      if (surfaceRequestIds[surfaceKey] === requestId) {
        set((state) => ({
          loadingBySurface: { ...state.loadingBySurface, [surfaceKey]: false },
        }));
      }
    }
  },

  removeSession: (surfaceKey, sessionId) => {
    const current = ensureAnnotatedSessionArray(
      get().sessionsBySurface[surfaceKey],
    );
    if (current.length === 0) return;
    const next = current.filter((s) => s.session_id !== sessionId);
    if (next.length === current.length) return;
    set((state) => {
      const nextPending = { ...state.pendingSummariesById };
      // Drop any cached pending summary for this id so deleted sessions
      // don't leak entries into `pendingSummariesById`.
      delete nextPending[sessionId];
      return {
        sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
        pendingSummariesById: nextPending,
      };
    });
  },

  restoreSession: (surfaceKey, session) => {
    const current = ensureAnnotatedSessionArray(
      get().sessionsBySurface[surfaceKey],
    );
    if (current.some((s) => s.session_id === session.session_id)) return;
    const next = sortSessionsDesc([...current, session]);
    set((state) => ({
      sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
    }));
  },

  addOptimisticSession: (surfaceKey, session) => {
    const current = ensureAnnotatedSessionArray(
      get().sessionsBySurface[surfaceKey],
    );
    if (current.some((s) => s.session_id === session.session_id)) return;
    const next = sortSessionsDesc([...current, session]);
    set((state) => ({
      sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
    }));
  },

  replaceSessionId: (surfaceKey, oldSessionId, newSessionId) => {
    if (oldSessionId === newSessionId) return;
    const current = ensureAnnotatedSessionArray(
      get().sessionsBySurface[surfaceKey],
    );
    if (current.length === 0) return;
    const idx = current.findIndex((s) => s.session_id === oldSessionId);
    if (idx === -1) return;
    // If a row with `newSessionId` already exists (e.g. a parallel
    // load brought it in before SessionReady landed), drop the
    // optimistic placeholder rather than producing two rows for the
    // same session.
    if (current.some((s) => s.session_id === newSessionId)) {
      const next = current.filter((s) => s.session_id !== oldSessionId);
      set((state) => ({
        sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
      }));
      return;
    }
    // Pick up any title that landed before SessionReady. Stashed by
    // `setSessionSummary` keyed on the REAL session id so an in-flight
    // Haiku title for *this* session attaches to the row exactly when
    // we know the optimistic placeholder maps to it — no
    // cross-contamination with other in-flight optimistic rows.
    const pendingSummary = get().pendingSummariesById[newSessionId];
    const next = current.slice();
    const swapped: AnnotatedSession = { ...current[idx], session_id: newSessionId };
    if (pendingSummary !== undefined) {
      swapped.summary_of_previous_context = pendingSummary;
    }
    next[idx] = swapped;
    set((state) => {
      const nextPending =
        pendingSummary !== undefined
          ? (() => {
              const copy = { ...state.pendingSummariesById };
              delete copy[newSessionId];
              return copy;
            })()
          : state.pendingSummariesById;
      return {
        sessionsBySurface: { ...state.sessionsBySurface, [surfaceKey]: next },
        ...(nextPending !== state.pendingSummariesById
          ? { pendingSummariesById: nextPending }
          : {}),
      };
    });
  },

  setSessionSummary: (sessionId, summary) => {
    // Patch the matching real-id row in every surface that holds it.
    // Optimistic placeholder rows are NOT matched here: a Title-K event
    // arriving while opt-(K+1) is in flight for a different session
    // used to stamp opt-(K+1) with Title-K, which then survived
    // `replaceSessionId`'s swap and surfaced as a duplicate row.
    // Instead we always cache the summary in `pendingSummariesById`
    // keyed by the REAL session id so `replaceSessionId` can apply it
    // when (and only when) it knows the optimistic placeholder really
    // does map to this session.
    const sessionsBySurface = get().sessionsBySurface;
    let mutated = false;
    let foundRow = false;
    const nextBySurface: Record<string, AnnotatedSession[]> = {};
    for (const [key, listValue] of Object.entries(sessionsBySurface)) {
      const list = ensureAnnotatedSessionArray(listValue);
      const idx = list.findIndex((s) => s.session_id === sessionId);
      if (idx === -1) {
        nextBySurface[key] = list;
        continue;
      }
      foundRow = true;
      if (list[idx].summary_of_previous_context === summary) {
        nextBySurface[key] = list;
        continue;
      }
      const nextList = list.slice();
      nextList[idx] = { ...list[idx], summary_of_previous_context: summary };
      nextBySurface[key] = nextList;
      mutated = true;
    }
    set((state) => ({
      ...(mutated ? { sessionsBySurface: nextBySurface } : {}),
      pendingSummariesById: {
        ...state.pendingSummariesById,
        [sessionId]: summary,
      },
      // If the title arrives before any mounted surface has materialized
      // the real row, wake the list loaders so they can merge the cached
      // title instead of leaving "New chat" until a manual refresh.
      ...(!foundRow ? { version: state.version + 1 } : {}),
    }));
  },

  setDeleteError: (surfaceKey, message) => {
    set((state) => ({
      deleteErrorBySurface: {
        ...state.deleteErrorBySurface,
        [surfaceKey]: message,
      },
    }));
  },
}));

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

/**
 * Returns the same array reference across re-renders when the
 * underlying store entry hasn't changed. The empty fallback is a
 * module-level singleton so consumers that call this for not-yet-loaded
 * surfaces don't churn `useShallow` consumers.
 */
export function useSessionsForSurface(
  surfaceKey: string | undefined,
): AnnotatedSession[] {
  return useSessionsListStore(
    useShallow((state) => {
      if (!surfaceKey) return EMPTY_SESSIONS;
      return ensureAnnotatedSessionArray(state.sessionsBySurface[surfaceKey]);
    }),
  );
}

export function useSessionsLoading(surfaceKey: string | undefined): boolean {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return false;
    return state.loadingBySurface[surfaceKey] ?? false;
  });
}

/**
 * Most-recent failed-delete message for the surface, or `null` when
 * the last delete succeeded (or none has run yet). `SessionsList`
 * subscribes to this to render its inline error banner.
 */
export function useSessionsDeleteError(
  surfaceKey: string | undefined,
): string | null {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return null;
    return state.deleteErrorBySurface[surfaceKey] ?? null;
  });
}

/**
 * Most-recent session by `started_at` for the surface, skipping any
 * optimistic placeholder rows. Sessions are stored already-sorted
 * desc; we walk for the first non-synthetic id rather than picking
 * `[0]` blindly so default-session redirects can never write a
 * synthetic `?session=optimistic:...` into the URL (which would 400
 * the very next history fetch). Optimistic rows can leak past the
 * `replaceSessionId` swap if `SessionReady` never arrives — e.g. the
 * panel is unmounted mid-stream — and would otherwise be picked here
 * as the most-recent target.
 */
export function useMostRecentSession(
  surfaceKey: string | undefined,
): AnnotatedSession | null {
  return useSessionsListStore((state) => {
    if (!surfaceKey) return null;
    return findMostRecentRealSession(
      ensureAnnotatedSessionArray(state.sessionsBySurface[surfaceKey]),
    );
  });
}

/**
 * Stable string fingerprint of an agent's `(projectId, projectAgentId)`
 * bindings. Returns "" when no bindings have been fetched yet OR when
 * the server reports the agent has none. Use [`useAgentBindingsLoadStatus`]
 * if you need to discriminate "not yet fetched" from "fetched empty".
 *
 * Reads from `bindingsByAgent`, populated by `loadAgentSessions` from
 * the server endpoint `GET /api/agents/:agent_id/projects`. This is
 * deliberately NOT derived from `useProjectsListStore` — that store is
 * scoped to the active org and misses bindings (like the auto-Home
 * project) that the agent actually has on the server.
 */
export function useAgentBindingsKey(agentId: string | undefined): string {
  return useSessionsListStore((s) => {
    if (!agentId) return "";
    const bindings = s.bindingsByAgent[agentId];
    if (!bindings || bindings.length === 0) return "";
    const parts = bindings.map(
      (b) => `${b.project_id}:${b.project_agent_id}`,
    );
    parts.sort();
    return parts.join(",");
  });
}

/**
 * Per-agent load status for [`bindingsByAgent`]. Lets callers like
 * `AgentChatRoute`'s conversation-target resolver render a `pending` state while
 * the binding fetch is in flight instead of falling back to the
 * fresh-canvas standalone view (which would otherwise flash on cold
 * load before bindings arrive).
 */
export function useAgentBindingsLoadStatus(
  agentId: string | undefined,
): BindingsLoadStatus {
  return useSessionsListStore((s) => {
    if (!agentId) return "idle";
    return s.bindingsLoadStatusByAgent[agentId] ?? "idle";
  });
}

interface SessionsListActions {
  loadAgentSessions: (agentId: string) => Promise<void>;
  loadAgentBindings: (agentId: string) => Promise<void>;
  loadUserSessions: () => Promise<void>;
  loadProjectSessions: (projectId: string, projectName: string) => Promise<void>;
  removeSession: (surfaceKey: string, sessionId: string) => void;
  restoreSession: (surfaceKey: string, session: AnnotatedSession) => void;
  addOptimisticSession: (surfaceKey: string, session: AnnotatedSession) => void;
  replaceSessionId: (
    surfaceKey: string,
    oldSessionId: string,
    newSessionId: string,
  ) => void;
  setSessionSummary: (sessionId: string, summary: string) => void;
  setDeleteError: (surfaceKey: string, message: string | null) => void;
}

/**
 * Convenience accessor for the imperative actions; using
 * `useSessionsListStore.getState()` inline works too but this keeps the
 * action-vs-state split visible in the call sites.
 */
export function useSessionsListActions(): SessionsListActions {
  return useSessionsListStore(
    useShallow((s) => ({
      loadAgentSessions: s.loadAgentSessions,
      loadAgentBindings: s.loadAgentBindings,
      loadUserSessions: s.loadUserSessions,
      loadProjectSessions: s.loadProjectSessions,
      removeSession: s.removeSession,
      restoreSession: s.restoreSession,
      addOptimisticSession: s.addOptimisticSession,
      replaceSessionId: s.replaceSessionId,
      setSessionSummary: s.setSessionSummary,
      setDeleteError: s.setDeleteError,
    })),
  );
}
