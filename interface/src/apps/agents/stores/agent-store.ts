import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../../../api/client";
import { buildDisplayEvents } from "../../../utils/build-display-messages";
import type { Agent } from "../../../shared/types";
import { isSuperAgent } from "../../../shared/types/permissions";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { BROWSER_DB_STORES, browserDbGet, browserDbSet } from "../../../shared/lib/browser-db";
import { isAuraCaptureSessionActive } from "../../../lib/screenshot-bridge";
import { useAuthStore } from "../../../stores/auth-store";
import { useOrgStore } from "../../../stores/org-store";
import { clearLastStandaloneAgentId } from "../../../utils/storage";

type FetchStatus = "idle" | "loading" | "ready" | "error";

type HistoryEntry = {
  events: DisplaySessionEvent[];
  status: FetchStatus;
  fetchedAt: number;
  error: string | null;
};

type PersistedAgentState = {
  agents: Agent[];
  history: Record<string, HistoryEntry>;
  selectedAgentId: string | null;
  pinnedAgentIds: string[];
  favoriteAgentIds: string[];
};

const PINNED_KEY = "aura:pinnedAgentIds";
const FAVORITE_KEY = "aura:favoriteAgentIds";

function readIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* corrupted – start fresh */ }
  return new Set();
}

function persistIdSet(key: string, ids: Set<string>): void {
  localStorage.setItem(key, JSON.stringify([...ids]));
}

type AgentState = {
  agents: Agent[];
  agentsStatus: FetchStatus;
  agentsError: string | null;

  /**
   * True when this session's first *authoritative* agent fetch (org roster
   * network-confirmed — see `isOrgScopeAuthoritative`) found an account with
   * no agents at all — i.e. a brand-new user — recorded *before* the
   * idempotent CEO/Home ensure creates the default agent. Drives the
   * first-run onboarding choice surface (`OnboardingChoice`), which needs
   * "had no agents" rather than the post-ensure list (that always contains
   * the auto-created CEO). Latches via `firstRunSignalSettledThisSession`:
   * decided at most once per signed-in session, stays true until the auth
   * identity changes, and is never set by pre-settle (unscoped) fetches or
   * by later empty org switches.
   */
  firstRunDetected: boolean;

  history: Record<string, HistoryEntry>;

  selectedAgentId: string | null;

  pinnedAgentIds: Set<string>;
  favoriteAgentIds: Set<string>;

  createAgentModalOpen: boolean;
  openCreateAgentModal: () => void;
  closeCreateAgentModal: () => void;

  fetchAgents: (opts?: { force?: boolean }) => Promise<void>;
  removeAgent: (agentId: string) => void;
  patchAgent: (agent: Agent) => void;
  fetchHistory: (agentId: string, opts?: { force?: boolean }) => Promise<void>;
  prefetchHistory: (agentId: string) => void;
  invalidateHistory: (agentId: string) => void;
  setSelectedAgent: (agentId: string | null) => void;
  togglePin: (agentId: string) => void;
  toggleFavorite: (agentId: string) => void;
};

const HISTORY_TTL_MS = 30_000;
const AGENTS_TTL_MS = 30_000;
const PLACEHOLDER_AGENT_NAME = "New Agent";

/// Per-app-session guard for the idempotent `POST /api/agents/harness/setup`
/// call issued from `fetchAgents`. Lifted to module scope so the auth
/// subscription below can reset it on logout (otherwise a
/// sign-out/sign-in cycle to a different account would skip the
/// ensure-home call).
let hasEnsuredCeoHomeThisSession = false;

/// Per-user-session latch for the first-run decision. The question "is this a
/// brand-new user?" must be answered exactly once per signed-in session, by
/// the first *authoritative* fetch (see `isOrgScopeAuthoritative`):
///   - authoritative fetch returns agents  -> not first run, latch closes
///   - authoritative fetch returns nothing -> first run, latch closes
///   - any fetch returns agents            -> not first run, latch closes
///     (even an unscoped fetch: having any agent anywhere rules out "new")
/// Once latched, later empty results (e.g. the user switches to a freshly
/// created empty org mid-session) can never flip `firstRunDetected` on.
/// Reset alongside `hasEnsuredCeoHomeThisSession` on any auth identity change.
let firstRunSignalSettledThisSession = false;

/**
 * An agent list result can only decide the first-run question when we know it
 * reflects the user's real scope. That requires the org roster to have been
 * confirmed by the network for this session (`orgsResolved` — the IndexedDB
 * org cache can be stale) AND either the fetch was scoped to the settled
 * active org, or the roster settled to "this user has no orgs at all" (then
 * the unscoped, own-agents list IS the full picture). Evaluated at fetch
 * start so the verdict matches the scope the request was actually made with.
 */
function isOrgScopeAuthoritative(
  orgState: ReturnType<typeof useOrgStore.getState>,
  activeOrgId: string | undefined,
): boolean {
  return orgState.orgsResolved && (activeOrgId !== undefined || orgState.orgs.length === 0);
}

function agentStateKey(userId: string): string {
  return `state:${userId}`;
}

/**
 * Mirror of the server-side repair in `handlers/agents/instances.rs`:
 * a blank `name` coming from storage (either the IndexedDB hydration cache
 * or the network response) would render as an empty sidebar row. Normalise
 * to the canonical `"New Agent"` placeholder so the row is at least
 * visible, and — for project instances — so `maybeRenameFromFirstPrompt`
 * can still derive a real title from the first user message (its guard
 * checks for this exact string).
 */
function repairAgentName<T extends { name: string }>(agent: T): T {
  if (agent.name && agent.name.trim().length > 0) {
    return agent;
  }
  return { ...agent, name: PLACEHOLDER_AGENT_NAME };
}

function repairAgentNames<T extends { name: string }>(agents: T[]): T[] {
  let mutated = false;
  const out = agents.map((agent) => {
    const repaired = repairAgentName(agent);
    if (repaired !== agent) mutated = true;
    return repaired;
  });
  return mutated ? out : agents;
}

function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function hydratePersistedAgentState(userId: string): Promise<void> {
  const cached = await browserDbGet<PersistedAgentState>(
    BROWSER_DB_STORES.agents,
    agentStateKey(userId),
  );
  if (!cached) {
    return;
  }
  // Cache paint is a cold-start optimization only. The IndexedDB read is async,
  // so a network `fetchAgents` could have already committed fresh agents while
  // it was in flight — never clobber that with the stale snapshot.
  const current = useAgentStore.getState();
  if (current.agentsStatus === "ready" || current.agents.length > 0) {
    return;
  }
  useAgentStore.setState({
    agents: repairAgentNames(cached.agents),
    history: cached.history,
    selectedAgentId: cached.selectedAgentId,
    pinnedAgentIds: new Set(cached.pinnedAgentIds),
    favoriteAgentIds: new Set(cached.favoriteAgentIds),
  });
}

export const useAgentStore = create<AgentState>()(
  subscribeWithSelector((set, get) => {
    let agentsFetchPromise: Promise<void> | null = null;
    let agentsFetchedAt = 0;
    const historyFetchPromises = new Map<string, Promise<void>>();

    return {
      agents: [],
      agentsStatus: "idle",
      agentsError: null,
      firstRunDetected: false,
      history: {},
      selectedAgentId: null,
      pinnedAgentIds: readIdSet(PINNED_KEY),
      favoriteAgentIds: readIdSet(FAVORITE_KEY),

      createAgentModalOpen: false,
      openCreateAgentModal: () => set({ createAgentModalOpen: true }),
      closeCreateAgentModal: () => set({ createAgentModalOpen: false }),

      fetchAgents: async (opts): Promise<void> => {
        const { agentsStatus } = get();

        if (isAuraCaptureSessionActive()) {
          if (agentsStatus === "idle" || agentsStatus === "loading") {
            set({ agentsStatus: "ready", agentsError: null });
          }
          return;
        }

        if (agentsFetchPromise) return agentsFetchPromise;

        if (
          !opts?.force &&
          agentsStatus === "ready" &&
          Date.now() - agentsFetchedAt < AGENTS_TTL_MS
        ) {
          return;
        }

        if (agentsStatus === "idle") {
          set({ agentsStatus: "loading", agentsError: null });
        }

        // Scope the listing to the user's active org so the sidebar
        // shows the full org fleet (every member's agents), matching
        // what the CEO's `list_agents` tool sees. Without `org_id`
        // aura-network filters by `WHERE user_id = $1` and the user
        // only sees agents they created themselves — hiding
        // teammates' agents. `activeOrg` may briefly be null on first
        // mount before `refreshOrgs()` settles; in that window we
        // fall back to the unscoped list (current behaviour).
        const orgStateAtFetch = useOrgStore.getState();
        const activeOrgId = orgStateAtFetch.activeOrg?.org_id;
        const orgScopeAuthoritative = isOrgScopeAuthoritative(orgStateAtFetch, activeOrgId);
        // Ensure the canonical CEO exists *and* has a Home project binding so
        // direct chats can persist. `setup()` is idempotent on both fronts, so
        // calling it once per app session heals three cases in one hop:
        //   - Brand new account: creates the CEO + Home project.
        //   - Existing account missing a binding (the pre-fix state, or after a
        //     dedupe orphaned the old one): creates the Home project + binding.
        //   - Everything already good: no-op on the server.
        // Returns the freshly-created agent (if any) so the caller can splice it
        // into the list. Best-effort: on failure the per-session flag stays
        // false so the next fetch retries.
        const ensureCeoHome = async (): Promise<Agent | null> => {
          if (hasEnsuredCeoHomeThisSession) return null;
          try {
            const { agent, created } = await api.superAgent.setup();
            hasEnsuredCeoHomeThisSession = true;
            return created ? agent : null;
          } catch {
            return null;
          }
        };

        const commitAgents = (list: Agent[]): void => {
          if (isAuraCaptureSessionActive()) {
            set({ agentsStatus: "ready", agentsError: null });
            return;
          }
          agentsFetchedAt = Date.now();
          set({
            agents: sortAgents(repairAgentNames(list)),
            agentsStatus: "ready",
            agentsError: null,
          });
        };

        agentsFetchPromise = api.agents
          .list(activeOrgId)
          .then(async (initialAgents) => {
            if (isAuraCaptureSessionActive()) {
              set({ agentsStatus: "ready", agentsError: null });
              return;
            }

            let agents = initialAgents;
            const superAgents = agents.filter((a) => isSuperAgent(a));

            if (superAgents.length > 1) {
              // Bootstrap races or permission-round-trip bugs on older
              // aura-network deployments can leave the list with >1 CEO
              // agent (the TS `isSuperAgent` fallback happily matches
              // every duplicate). Ask the server to dedupe first so the
              // ensure-home call below operates on a single canonical
              // record.
              try {
                const { deleted } = await api.superAgent.cleanup();
                if (deleted.length > 0) {
                  agents = await api.agents.list(activeOrgId);
                }
              } catch {
                // cleanup is best-effort; stale duplicates will stick
                // around until the next refresh.
              }
            }

            // When we already have rows to show, commit them immediately and
            // run the idempotent CEO/Home ensure as a follow-up — the list is
            // no longer gated behind that extra round-trip. When the list is
            // empty there is nothing to show yet, so wait for `setup()` (it may
            // create the very first agent) before committing.
            if (agents.length > 0) {
              // Any agent anywhere means this is not a brand-new user; close
              // the first-run question for the rest of the session so a later
              // empty (e.g. brand-new org) fetch can't reopen it.
              firstRunSignalSettledThisSession = true;
              commitAgents(agents);
              const createdAgent = await ensureCeoHome();
              if (createdAgent && !isAuraCaptureSessionActive()) {
                set((s) => ({
                  agents: sortAgents(
                    repairAgentNames([
                      ...s.agents.filter((a) => a.agent_id !== createdAgent.agent_id),
                      createdAgent,
                    ]),
                  ),
                }));
              }
            } else {
              // Only treat an empty list as "first run" AND only create the
              // default CEO when the fetch's scope was authoritative (the
              // network-confirmed org roster says we queried the right
              // scope — see `isOrgScopeAuthoritative`). The first mount can
              // fire before org state settles; that pre-settle list can be
              // empty even for existing users whose agents are only visible
              // under their org. If we ran ensureCeoHome here, the CEO would
              // exist by the time the authoritative refetch arrives, masking
              // the true first-run signal.
              if (!isAuraCaptureSessionActive() && orgScopeAuthoritative) {
                if (!firstRunSignalSettledThisSession) {
                  // First authoritative answer of the session and it's
                  // "zero agents": this is a genuinely new user. Latch the
                  // decision BEFORE the ensure below creates the CEO.
                  firstRunSignalSettledThisSession = true;
                  set({ firstRunDetected: true });
                }
                const createdAgent = await ensureCeoHome();
                commitAgents(createdAgent ? [...agents, createdAgent] : agents);
              } else {
                // Pre-settle fetch — commit the empty list but do NOT
                // create the CEO yet. The authoritative refetch (org
                // subscription below, or the scope-drift check in
                // `finally`) will handle it.
                commitAgents(agents);
              }
            }
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : "Failed to fetch agents";
            set({ agentsStatus: "error", agentsError: message });
          })
          .finally(() => {
            agentsFetchPromise = null;
            // A forced refetch that raced this fetch (the org-settle
            // subscription fires while we're in flight) was swallowed by the
            // in-flight dedupe above and will never re-fire on its own — the
            // org only *settles* once. If the scope drifted while we were in
            // flight, re-run now so the authoritative list (and the
            // first-run verdict) still lands.
            if (isAuraCaptureSessionActive()) return;
            if (!useAuthStore.getState().user?.user_id) return;
            const orgStateNow = useOrgStore.getState();
            const orgIdNow = orgStateNow.activeOrg?.org_id;
            const authoritativeNow = isOrgScopeAuthoritative(orgStateNow, orgIdNow);
            const scopeChanged = orgIdNow !== activeOrgId;
            // Authority rising with the same org id only matters while the
            // first-run question is still open or nothing was committed —
            // skip the extra round-trip when we already painted a fleet.
            const authorityRose =
              authoritativeNow &&
              !orgScopeAuthoritative &&
              (get().agents.length === 0 || get().agentsStatus !== "ready");
            if (scopeChanged || authorityRose) {
              void get().fetchAgents({ force: true });
            }
          });

        return agentsFetchPromise;
      },

      removeAgent: (agentId): void => {
        set((s) => ({
          agents: s.agents.filter((a) => a.agent_id !== agentId),
        }));
      },

      patchAgent: (updated): void => {
        const repaired = repairAgentName(updated);
        set((s) => ({
          agents: s.agents.map((a) =>
            a.agent_id === repaired.agent_id ? repaired : a,
          ),
        }));
      },

      fetchHistory: async (agentId, opts): Promise<void> => {
        const entry = get().history[agentId];
        const now = Date.now();

        if (
          !opts?.force &&
          entry?.status === "ready" &&
          now - entry.fetchedAt < HISTORY_TTL_MS
        ) {
          return;
        }

        const existing = historyFetchPromises.get(agentId);
        if (existing) return existing;

        if (!entry || entry.status !== "ready") {
          set((s) => ({
            history: {
              ...s.history,
              [agentId]: {
                events: entry?.events ?? [],
                status: "loading",
                fetchedAt: entry?.fetchedAt ?? 0,
                error: null,
              },
            },
          }));
        }

        const promise = api.agents
          .listEvents(agentId, { limit: STANDALONE_AGENT_HISTORY_LIMIT })
          .then((raw) => {
            const events = buildDisplayEvents(raw);
            set((s) => ({
              history: {
                ...s.history,
                [agentId]: {
                  events,
                  status: "ready",
                  fetchedAt: Date.now(),
                  error: null,
                },
              },
            }));
          })
          .catch((err: unknown) => {
            const message =
              err instanceof Error ? err.message : "Failed to fetch history";
            set((s) => ({
              history: {
                ...s.history,
                [agentId]: {
                  events: entry?.events ?? [],
                  status: "error",
                  fetchedAt: entry?.fetchedAt ?? 0,
                  error: message,
                },
              },
            }));
          })
          .finally(() => {
            historyFetchPromises.delete(agentId);
          });

        historyFetchPromises.set(agentId, promise);
        return promise;
      },

      prefetchHistory: (agentId): void => {
        get()
          .fetchHistory(agentId)
          .catch(() => {
            // fire-and-forget; error state is in the store
          });
      },

      invalidateHistory: (agentId): void => {
        set((s) => {
          const { [agentId]: _, ...rest } = s.history;
          return { history: rest };
        });
      },

      setSelectedAgent: (agentId): void => {
        if (agentId) {
          void import("../../../lib/analytics").then(({ track }) => track("agent_selected"));
        }
        set({ selectedAgentId: agentId });
      },

      togglePin: (agentId): void => {
        set((s) => {
          const next = new Set(s.pinnedAgentIds);
          if (next.has(agentId)) next.delete(agentId);
          else next.add(agentId);
          persistIdSet(PINNED_KEY, next);
          return { pinnedAgentIds: next };
        });
      },

      toggleFavorite: (agentId): void => {
        set((s) => {
          const next = new Set(s.favoriteAgentIds);
          if (next.has(agentId)) next.delete(agentId);
          else next.add(agentId);
          persistIdSet(FAVORITE_KEY, next);
          return { favoriteAgentIds: next };
        });
      },
    };
  }),
);

let _prevAgentUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const userId = state.user?.user_id ?? null;
  if (userId === _prevAgentUserId) return;
  _prevAgentUserId = userId;

  hasEnsuredCeoHomeThisSession = false;
  firstRunSignalSettledThisSession = false;

  if (!userId) {
    // Drop the cached last-used agent id so it can't leak into the next
    // session: `AgentIndexRedirect` would otherwise redirect a freshly
    // logged-in (possibly different) user to the previous user's agent,
    // which isn't in their fleet — landing them on an empty, unselected
    // chat surface.
    clearLastStandaloneAgentId();
  }

  // Reset per-user store state on EVERY identity change, not just logout: a
  // direct account switch (A -> B without passing through a signed-out
  // state) must not leak A's agents or `firstRunDetected` into B's session —
  // and A's non-empty list would otherwise make `hydratePersistedAgentState`
  // skip painting B's cache. On plain logout->login this is a no-op reset of
  // an already-reset store.
  useAgentStore.setState({
    agents: [],
    agentsStatus: "idle",
    agentsError: null,
    firstRunDetected: false,
    history: {},
    selectedAgentId: null,
    pinnedAgentIds: new Set(),
    favoriteAgentIds: new Set(),
  });

  if (userId) {
    void hydratePersistedAgentState(userId);
  }
});

// Hydrate immediately for an already-authenticated user. The auth subscription
// above only fires on a userId *change*; on a warm load the agent-store module
// is imported lazily (after auth has already restored the session), so that
// transition has long passed. Without this, the IndexedDB cache never paints
// and the list waits for the network round-trip. Mirrors the projects store,
// which hydrates on both org- and auth-settle.
const _initialAgentUserId = useAuthStore.getState().user?.user_id ?? null;
if (_initialAgentUserId) {
  _prevAgentUserId = _initialAgentUserId;
  void hydratePersistedAgentState(_initialAgentUserId);
}

// Re-fetch the org-scoped agent fleet when the active org settles or changes.
// The first mount fetch can run before `refreshOrgs()` lands (org id null →
// unscoped, own-agents-only list); this picks up the full org fleet once the
// org is known — the projects store already does the equivalent.
//
// Two triggers:
//  - the active org id changed (org switch, or the roster hydrated/settled
//    onto a different org than the fetch used);
//  - the scope became authoritative (`refreshOrgs()` succeeded) while the
//    committed list is still empty/unready. This covers the org id NOT
//    changing at settle time: a cached `activeOrg` that the network then
//    confirms, and a user with zero orgs (id stays null) whose unscoped
//    list only becomes trustworthy — and first-run-decidable — once the
//    roster proves there is no org scope to query.
let _prevAgentOrgId: string | null = useOrgStore.getState().activeOrg?.org_id ?? null;
let _prevAgentOrgAuthoritative: boolean = (() => {
  const s = useOrgStore.getState();
  return isOrgScopeAuthoritative(s, s.activeOrg?.org_id);
})();
useOrgStore.subscribe((state) => {
  const orgId = state.activeOrg?.org_id ?? null;
  const authoritative = isOrgScopeAuthoritative(state, state.activeOrg?.org_id);
  const orgChanged = orgId !== _prevAgentOrgId;
  const authorityRose = authoritative && !_prevAgentOrgAuthoritative;
  _prevAgentOrgId = orgId;
  _prevAgentOrgAuthoritative = authoritative;
  if (isAuraCaptureSessionActive()) return;
  if (!orgChanged && !authorityRose) return;
  if (!useAuthStore.getState().user?.user_id) return;
  if (!orgChanged) {
    // Authority-only edge: skip the extra round-trip when a fleet is
    // already painted from the same org id — the first-run question is
    // closed and the list can't change scope.
    const agentState = useAgentStore.getState();
    if (agentState.agents.length > 0 && agentState.agentsStatus === "ready") return;
  }
  void useAgentStore.getState().fetchAgents({ force: true });
});

useAgentStore.subscribe((state) => {
  const userId = useAuthStore.getState().user?.user_id;
  if (!userId) {
    return;
  }
  void browserDbSet(BROWSER_DB_STORES.agents, agentStateKey(userId), {
    agents: state.agents,
    history: state.history,
    selectedAgentId: state.selectedAgentId,
    pinnedAgentIds: [...state.pinnedAgentIds],
    favoriteAgentIds: [...state.favoriteAgentIds],
  });
});
