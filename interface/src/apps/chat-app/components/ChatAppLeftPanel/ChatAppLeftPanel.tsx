import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../../../../api/client";
import { buildAgentSessionHistoryFetch } from "../../../../hooks/use-load-older-messages";
import {
  type AnnotatedSession,
  formatDeleteSessionError,
  SessionsList,
} from "../../../../components/SessionsList";
import { EmptyState } from "../../../../components/EmptyState";
import { Avatar } from "../../../../components/Avatar";
import { ProjectsPlusButton } from "../../../../components/ProjectsPlusButton";
import { AgentSelectorModal } from "../../../agents/components/AgentSelectorModal";
import {
  userSessionsSurfaceKey,
  useSessionsDeleteError,
  useSessionsListActions,
  useSessionsListStore,
} from "../../../../stores/sessions-list-store";
import { useChatHistoryStore } from "../../../../stores/chat-history-store";
import { keyForAgentSession } from "../../../../hooks/stream/store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { queryClient } from "../../../../shared/lib/query-client";
import {
  mergeAgentIntoProjectAgents,
  projectQueryKeys,
} from "../../../../queries/project-queries";
import { useSidebarSearch } from "../../../../hooks/use-sidebar-search";
import { useAgentStore, useAgents } from "../../../agents/stores";
import type { Agent, AgentInstance } from "../../../../shared/types";
import { useChatAppAgent } from "../../hooks/use-chat-app-agent";
import { useChatAppSessions } from "../../hooks/use-chat-app-sessions";
import styles from "./ChatAppLeftPanel.module.css";

/**
 * Cross-agent, ChatGPT-style session list for the Chat app's left
 * panel. Calls `loadUserSessions()` once on mount: a single
 * `/api/me/sessions` HTTP request that aura-storage answers with one
 * indexed query against the `idx_sessions_user_recent` partial
 * index (migration 0015). Replaces the previous fan-out which
 * iterated `useAgents()` and called `loadAgentSessions` per agent
 * (each itself fanning out one `listSessions` per project binding):
 * for a user with `A` agents and `B` average bindings the panel's
 * first paint cost `A x (1 + B)` HTTP calls; now it costs `1`.
 *
 * Rendering reuses the shared `SessionsList` (same component the
 * Agents app's `ChatsTab` and the projects app's `SessionList`
 * mount). Each row's right-side `Avatar` is resolved through
 * `_agentId` (server-stamped on each row by `loadUserSessions` from
 * the enriched response) keyed against `useAgents()` -- no
 * `bindingsByAgent` walk required. Clicking a row navigates to
 * `/chat?agent&project&instance&session` so `ChatAppRoute` can wire
 * both the chat panel and the sidekick to that session's agent
 * before the merged session list has loaded.
 *
 * Hover prefetches the destination's chat-history-store entry so the
 * panel mounts on a `historyResolved=true` first render and skips the
 * cold-load reveal.
 *
 * Header surfaces a `+` button via `useSidebarSearch("chat").setAction`
 * so it lands in the shared sidebar search header next to the search
 * input -- same UX as the Agents and Projects apps. Clicking it opens
 * the same `AgentSelectorModal` the Projects app uses for its
 * project-row "+", scoped to the CEO chat agent's auto-Home project so
 * picking an agent attaches it to that project and lands the user in
 * a fresh `/chat` canvas against the new instance. The "+" button's
 * `ceoHomeProjectId` lookup still needs the chat agent's project
 * bindings, so `loadAgentBindings(chatAgent.agent_id)` runs
 * separately -- one bindings fetch, no per-binding session fan-out.
 */
export function ChatAppLeftPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");
  const { agent: chatAgent, status: agentStatus } = useChatAppAgent();
  const { agents } = useAgents();
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const {
    loadAgentBindings,
    loadUserSessions,
    removeSession,
    restoreSession,
    setDeleteError,
  } = useSessionsListActions();
  const { query: searchQuery, setAction } = useSidebarSearch("chat");
  const { sessions, loading } = useChatAppSessions(agents);

  // Single user-scoped fetch in place of the previous
  // `agents.forEach(loadAgentSessions)` fan-out. Per
  // aura-storage migration 0015 + the server-side join, this is one
  // indexed query against `idx_sessions_user_recent` -- collapses
  // what was `A x (1 + B)` HTTP calls (A agents, B avg bindings each)
  // into 1. `sessionsVersion` bumps (e.g. after `SessionReady`)
  // re-trigger so newly-persisted conversations surface without a
  // manual refresh, matching the previous behavior.
  useEffect(() => {
    void loadUserSessions();
  }, [sessionsVersion, loadUserSessions]);

  // Bindings-only refresh for the chat agent so the "+" button below
  // can resolve `ceoHomeProjectId` from `bindingsByAgent`. We don't
  // call `loadAgentSessions` here because that would re-introduce
  // the per-binding session fan-out we just collapsed; binding
  // discovery is a single
  // `GET /api/agents/:id/projects` call regardless.
  useEffect(() => {
    if (!chatAgent) return;
    void loadAgentBindings(chatAgent.agent_id);
  }, [chatAgent, loadAgentBindings]);

  // Resolve each row's owning `Agent` from `_agentId` -- stamped
  // by `loadUserSessions` from the `/api/me/sessions` enriched
  // response. The previous implementation built a `_agentInstanceId
  // -> Agent` map by walking `bindingsByAgent` for every agent; that
  // was contingent on the per-agent fan-out having populated those
  // bindings. With the single user-scoped fetch we no longer have
  // (and don't need) bindings for agents other than the chat agent,
  // so the row carries its own template-id keyed lookup. Falls back
  // to `chatAgent` when the row's agent is missing from
  // `useAgents()` (e.g. a binding to an agent the active org no
  // longer surfaces) -- same fallback the avatar render relied on
  // before.
  const agentsByTemplateId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.agent_id, agent);
    return map;
  }, [agents]);

  const resolveSessionAgent = useCallback(
    (target: AnnotatedSession): Agent | null => {
      if (target._agentId) {
        const found = agentsByTemplateId.get(target._agentId);
        if (found) return found;
      }
      return chatAgent ?? null;
    },
    [agentsByTemplateId, chatAgent],
  );

  // The agent id the destination chat surface will actually fetch
  // events under. `/api/me/sessions` stamps every row with its
  // server-authoritative owning `_agentId`, so we navigate by that id
  // directly -- NOT by the `Agent` object `resolveSessionAgent`
  // returns. `useAgents()` is scoped to the active org, so a session
  // owned by an agent the active org doesn't surface (a different
  // org, a personal agent, an executor instance) resolves to no
  // `Agent` and `resolveSessionAgent` falls back to `chatAgent`.
  // Navigating with that fallback wrote `agent=<chatAgent>` into the
  // URL and the per-session events read
  // (`GET /api/agents/:agent_id/sessions/:session_id/events`) 404'd
  // its ownership check ("session not found") because the session
  // belongs to a different agent. Falling back to `chatAgent` only
  // when the row has no `_agentId` at all keeps the fresh-canvas /
  // legacy paths working. The avatar + stream-key resolvers keep
  // using `resolveSessionAgent` (a missing avatar is cosmetic).
  const resolveSessionAgentId = useCallback(
    (target: AnnotatedSession): string | null => {
      if (target._agentId) return target._agentId;
      return chatAgent?.agent_id ?? null;
    },
    [chatAgent],
  );

  // Lazily pull an agent that owns a listed session but isn't in the
  // active-org `useAgents()` snapshot into `useAgentStore`, so the
  // row avatar, the sidekick (`AgentInfoPanel`), and `ChatAppRoute`'s
  // `agentById` lookup all converge on the right agent without
  // re-introducing the per-agent fan-out we collapsed. Fired on
  // click / hover only (not on first paint) so we fetch exactly the
  // agents the user actually opens. Deduped via `hydratingAgentIdsRef`
  // so a burst of hovers can't fan out duplicate `GET /api/agents/:id`
  // calls for the same id.
  const hydratingAgentIdsRef = useRef<Set<string>>(new Set());
  const ensureAgentHydrated = useCallback((agentId: string) => {
    const store = useAgentStore.getState();
    if (store.agents.some((a) => a.agent_id === agentId)) return;
    if (hydratingAgentIdsRef.current.has(agentId)) return;
    hydratingAgentIdsRef.current.add(agentId);
    api.agents
      .get(agentId)
      .then((agent) => {
        const s = useAgentStore.getState();
        if (s.agents.some((a) => a.agent_id === agent.agent_id)) {
          s.patchAgent(agent);
        } else {
          useAgentStore.setState((prev) => ({
            agents: [...prev.agents, agent],
          }));
        }
      })
      .catch((err) => {
        console.warn("Failed to hydrate session agent into store", {
          agentId,
          err,
        });
      })
      .finally(() => {
        hydratingAgentIdsRef.current.delete(agentId);
      });
  }, []);

  const renderRowSuffix = useCallback(
    (target: AnnotatedSession) => {
      const agent = resolveSessionAgent(target);
      if (!agent) return null;
      return (
        <Avatar
          avatarUrl={agent.icon ?? undefined}
          name={agent.name}
          type="agent"
          size={20}
          className={styles.rowAvatar}
        />
      );
    },
    [resolveSessionAgent],
  );

  // Resolve the CEO chat agent's auto-Home project_id from the
  // server-authoritative bindings populated by the
  // `loadAgentBindings(chatAgent.agent_id)` call above. We prefer the
  // binding whose project name is "Home" (matches
  // `AGENT_HOME_PROJECT_NAME` in `use-standalone-agent-chat.ts`) and
  // fall back to the first binding for legacy agents that don't have
  // a Home row yet -- same fallback shape as
  // `useStandaloneAgentChat.effectiveProjectId`.
  const chatAgentBindings = useSessionsListStore((s) =>
    chatAgent ? s.bindingsByAgent[chatAgent.agent_id] : undefined,
  );
  const ceoHomeProjectId = useMemo<string | null>(() => {
    if (!chatAgentBindings || chatAgentBindings.length === 0) return null;
    const homeBinding =
      chatAgentBindings.find((b) => b.project_name === "Home") ??
      chatAgentBindings[0];
    return homeBinding?.project_id ?? null;
  }, [chatAgentBindings]);

  const [selectorOpen, setSelectorOpen] = useState(false);

  const handleOpenSelector = useCallback(() => {
    if (!ceoHomeProjectId) return;
    setSelectorOpen(true);
  }, [ceoHomeProjectId]);

  const handleCloseSelector = useCallback(() => {
    setSelectorOpen(false);
  }, []);

  // Mirror the projects-app's `handleAgentCreated` cache writes
  // (`use-project-list-actions.ts`) so the new instance shows up in
  // `useProjectsListStore.agentsByProject` immediately. That feeds
  // `useStandaloneAgentChat.agentProjects` on the destination route so
  // the first turn ships the right `body.project_id` instead of falling
  // back to `undefined`. We then route into `/chat?...` rather than
  // `/projects/.../agents/...` so the user stays in the Chat app.
  //
  // The "Standard Agent" row in `AgentSelectorModal` creates a brand-new
  // project-local agent (`build_general_agent` in
  // `apps/aura-os-server/src/handlers/agents/instances/mod.rs`) whose
  // `agent_id` is NOT yet in `useAgentStore.agents`. `ChatAppRoute`
  // resolves `?agent=<id>` against that store and falls back to the CEO
  // agent on a miss — which is why selecting "Standard Agent" used to
  // look like a no-op. Fetch the new agent and mirror it into the
  // store (matching the CEO-side pattern in `use-chat-app-agent.ts`)
  // before navigating so the destination route mounts the right agent
  // on its first render. The forced `fetchAgents({ force: true })` is
  // a background heal so any other surface that reads `useAgents()`
  // converges without a reload.
  const handleAgentCreated = useCallback(
    async (instance: AgentInstance) => {
      const pid = instance.project_id;
      const projectsStore = useProjectsListStore.getState();
      projectsStore.setAgentsByProject((prev) => ({
        ...prev,
        [pid]: mergeAgentIntoProjectAgents(prev[pid], instance),
      }));
      queryClient.setQueryData(
        projectQueryKeys.agentInstance(pid, instance.agent_instance_id),
        instance,
      );
      void projectsStore.refreshProjectAgents(pid);

      const agentStore = useAgentStore.getState();
      const alreadyPresent = agentStore.agents.some(
        (a) => a.agent_id === instance.agent_id,
      );
      if (!alreadyPresent) {
        try {
          const newAgent = await api.agents.get(instance.agent_id);
          const store = useAgentStore.getState();
          const present = store.agents.some(
            (a) => a.agent_id === newAgent.agent_id,
          );
          if (present) {
            store.patchAgent(newAgent);
          } else {
            useAgentStore.setState((s) => ({
              agents: [...s.agents, newAgent],
            }));
          }
        } catch (err) {
          console.warn(
            "Failed to hydrate newly-created agent into store; route will rely on background fetchAgents",
            err,
          );
        }
      }
      void agentStore.fetchAgents({ force: true });

      setSelectorOpen(false);
      const params = new URLSearchParams({
        agent: instance.agent_id,
        project: pid,
        instance: instance.agent_instance_id,
      });
      navigate(`/chat?${params.toString()}`);
    },
    [navigate],
  );

  useEffect(() => {
    setAction(
      "chat",
      <ProjectsPlusButton
        onClick={handleOpenSelector}
        title="New chat"
        disabled={!ceoHomeProjectId}
      />,
    );
    return () => setAction("chat", null);
  }, [ceoHomeProjectId, handleOpenSelector, setAction]);

  const handleSessionClick = useCallback(
    (target: AnnotatedSession) => {
      const agentId = resolveSessionAgentId(target);
      const params = new URLSearchParams({
        project: target._projectId,
        instance: target._agentInstanceId,
        session: target.session_id,
      });
      if (agentId) {
        params.set("agent", agentId);
      }
      // Heal the store so the destination route's `agentById` lookup
      // and the sidekick resolve the right agent instead of falling
      // back to the CEO chat agent. Only the row's own `_agentId`
      // needs hydration -- the `chatAgent` fallback is already a
      // fully-resolved `Agent` object in the store.
      if (target._agentId) {
        ensureAgentHydrated(target._agentId);
      }
      navigate(`/chat?${params.toString()}`);
    },
    [navigate, resolveSessionAgentId, ensureAgentHydrated],
  );

  // Hover-warm the chat-history-store entry the destination panel will
  // actually read on click. The Chat app routes into
  // `useStandaloneAgentChat` which keys history at
  // `agent:<agentId>:session:<sessionId>` and fetches via
  // `/api/agents/<agentId>/sessions/<sessionId>/events` (see
  // `use-standalone-agent-chat.ts`). The earlier prefetch wrote to the
  // project-scoped `session:<projectId>:<agentInstanceId>:<sessionId>`
  // key + `/api/projects/.../events` endpoint — different cache slot,
  // different shape, so click always cold-loaded the network. Resolve
  // the row's owning agent through `agentByInstanceId` and key + fetch
  // exactly as the panel will, then briefly pin the key so the LRU
  // (`MAX_HISTORY_ENTRIES = 8`) can't drop the warm slot before the
  // click lands.
  const handleSessionHover = useCallback(
    (target: AnnotatedSession) => {
      // Warm the exact key + endpoint the destination panel reads, so
      // we must key by the row's true `_agentId` (the same id
      // `handleSessionClick` navigates with). Keying by
      // `resolveSessionAgent`'s `chatAgent` fallback warmed the wrong
      // cache slot and fetched against the wrong agent for any row
      // owned by an out-of-active-org agent.
      const agentId = resolveSessionAgentId(target);
      if (!agentId) return;
      const key = `agent:${agentId}:session:${target.session_id}`;
      const store = useChatHistoryStore.getState();
      store.pinKey(key);
      // Release the pin after a window long enough to bridge typical
      // hover→click latency without leaking pins on rows the user
      // never actually opens.
      setTimeout(() => {
        useChatHistoryStore.getState().unpinKey(key);
      }, 30_000);
      void store.fetchHistory(
        key,
        buildAgentSessionHistoryFetch(
          agentId,
          target.session_id,
          STANDALONE_AGENT_HISTORY_LIMIT,
        ),
      );
    },
    [resolveSessionAgentId],
  );

  // The chat-app left panel renders rows out of the user-scoped
  // `userSessionsSurfaceKey()` surface (single fetch via
  // `loadUserSessions`), so delete / restore / error must land on
  // that surface -- not the per-agent or per-project surface the
  // older fan-out reader used. The `_unused` underscore on the row
  // is intentional: the surface key here is independent of the row,
  // we keep the helper signature stable so the existing `handleDelete`
  // call shape doesn't have to change.
  const surfaceKeyForSession = useCallback(
    (_target: AnnotatedSession): string => userSessionsSurfaceKey(),
    [],
  );

  const handleDelete = useCallback(
    (target: AnnotatedSession) => {
      const surfaceKey = surfaceKeyForSession(target);
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
    [removeSession, restoreSession, setDeleteError, surfaceKeyForSession],
  );

  // Single delete-error banner pinned to the user-sessions surface
  // -- same surface every row in this panel renders out of, and the
  // single surface every delete/restore now lands on. Replaces the
  // earlier per-chat-agent banner that only worked because the panel
  // used to read from `agent:<chatAgent.agent_id>` rows.
  const primarySurfaceKey = useMemo(
    () => userSessionsSurfaceKey(),
    [],
  );
  const deleteError = useSessionsDeleteError(primarySurfaceKey);

  const handleDismissError = useCallback(() => {
    if (!primarySurfaceKey) return;
    setDeleteError(primarySurfaceKey, null);
  }, [primarySurfaceKey, setDeleteError]);

  // Chat-app sessions render through `useStandaloneAgentChat`, which
  // drives `useAgentChatStream` keyed by `(agentId, session_id)` —
  // distinct from the project-keyed default `SessionsList` uses for
  // the agents/projects sidekicks. Resolve each session's owning
  // agent via the same `bindingsByAgent`-backed map the avatar
  // suffix uses and emit the agent-side streamKey so the per-row
  // streaming indicator subscribes to the lane the panel actually
  // writes to. An unresolved agent returns an empty key (no
  // indicator) rather than guessing — the row would otherwise light
  // up against a project lane the chat panel never touches.
  //
  // Declared above the early-return guard below so the Hook order
  // stays stable across renders where `chatAgent` is still loading.
  const streamKeyForSession = useCallback(
    (target: AnnotatedSession): string => {
      const agent = resolveSessionAgent(target);
      if (!agent) return "";
      return keyForAgentSession(agent.agent_id, target.session_id);
    },
    [resolveSessionAgent],
  );

  if (!chatAgent) {
    if (agentStatus === "loading") {
      return (
        <div className={styles.loadingState}>
          <Loader2 size={16} className="animate-spin" aria-hidden />
          <span>Starting chat…</span>
        </div>
      );
    }
    return <EmptyState>Couldn't load chat history.</EmptyState>;
  }

  return (
    <div className={styles.root} data-agent-surface="chat-app-sessions-list">
      <SessionsList
        sessions={sessions}
        loading={loading}
        selectedSessionId={selectedSessionId}
        onSessionClick={handleSessionClick}
        onSessionHover={handleSessionHover}
        onDeleteSession={handleDelete}
        searchQuery={searchQuery}
        deleteError={deleteError}
        onDismissError={handleDismissError}
        renderRowSuffix={renderRowSuffix}
        streamKeyForSession={streamKeyForSession}
      />
      {ceoHomeProjectId && (
        <AgentSelectorModal
          isOpen={selectorOpen}
          projectId={ceoHomeProjectId}
          onClose={handleCloseSelector}
          onCreated={handleAgentCreated}
        />
      )}
    </div>
  );
}
