import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "../../../../api/client";
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
  agentSessionsSurfaceKey,
  projectSessionsSurfaceKey,
  useSessionsDeleteError,
  useSessionsListActions,
  useSessionsListStore,
} from "../../../../stores/sessions-list-store";
import {
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../../../stores/chat-history-store";
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
 * panel. Fans out `loadAgentSessions(agentId)` across every agent in
 * `useAgents()` so the panel surfaces conversations with any agent
 * the user has talked to — not just the canonical CEO chat agent.
 *
 * Rendering reuses the shared `SessionsList` (same component the
 * Agents app's `ChatsTab` and the projects app's `SessionList`
 * mount). Each row's right-side `Avatar` is supplied via
 * `renderRowSuffix`; we resolve the session's agent through a memoized
 * `_agentInstanceId -> Agent` map built from each agent's project
 * bindings (`bindingsByAgent` in the sessions store). Clicking a row
 * navigates to `/chat?agent&project&instance&session` so
 * `ChatAppRoute` can wire both the chat panel and the sidekick to that
 * session's agent before the merged session list has loaded.
 *
 * Hover prefetches the destination's chat-history-store entry so the
 * panel mounts on a `historyResolved=true` first render and skips the
 * cold-load reveal.
 *
 * Header surfaces a `+` button via `useSidebarSearch("chat").setAction`
 * so it lands in the shared sidebar search header next to the search
 * input — same UX as the Agents and Projects apps. Clicking it opens
 * the same `AgentSelectorModal` the Projects app uses for its
 * project-row "+", scoped to the CEO chat agent's auto-Home project so
 * picking an agent attaches it to that project and lands the user in
 * a fresh `/chat` canvas against the new instance.
 */
export function ChatAppLeftPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");
  const { agent: chatAgent, status: agentStatus } = useChatAppAgent();
  const { agents } = useAgents();
  const sessionsVersion = useSessionsListStore((s) => s.version);
  const { loadAgentSessions, removeSession, restoreSession, setDeleteError } =
    useSessionsListActions();
  const { query: searchQuery, setAction } = useSidebarSearch("chat");
  const { sessions, loading } = useChatAppSessions(agents);

  // Fan-out fetch across every agent the user knows about. The store
  // dedupes concurrent loads per-surface internally, so re-running on
  // every `agents` shape change is cheap; `sessionsVersion` bumps
  // (e.g. after `SessionReady`) re-trigger so newly-persisted
  // conversations show up without a manual refresh.
  useEffect(() => {
    for (const a of agents) {
      void loadAgentSessions(a.agent_id);
    }
  }, [agents, sessionsVersion, loadAgentSessions]);

  const bindingsByAgent = useSessionsListStore((s) => s.bindingsByAgent);

  // Map every project-agent-instance the user can see back to its
  // owning `Agent` so we can paint the right avatar on each row. The
  // map is built from the *server-authoritative* `bindingsByAgent`
  // populated by `loadAgentSessions`, NOT from
  // `useProjectsListStore.agentsByProject`, which is scoped to the
  // active org and misses the auto-created Home project bindings for
  // remote agents. Memoized so unrelated store updates (other
  // surfaces' session writes) don't rebuild the map every render.
  const agentByInstanceId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      const bindings = bindingsByAgent[agent.agent_id];
      if (!bindings) continue;
      for (const binding of bindings) {
        map.set(binding.project_agent_id, agent);
      }
    }
    return map;
  }, [agents, bindingsByAgent]);

  const resolveSessionAgent = useCallback(
    (target: AnnotatedSession): Agent | null => {
      return (
        agentByInstanceId.get(target._agentInstanceId) ?? chatAgent ?? null
      );
    },
    [agentByInstanceId, chatAgent],
  );

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
  // server-authoritative bindings populated by the fan-out
  // `loadAgentSessions` above. We prefer the binding whose project name
  // is "Home" (matches `AGENT_HOME_PROJECT_NAME` in
  // `use-standalone-agent-chat.ts`) and fall back to the first binding
  // for legacy agents that don't have a Home row yet — same fallback
  // shape as `useStandaloneAgentChat.effectiveProjectId`.
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
      const agent = resolveSessionAgent(target);
      const params = new URLSearchParams({
        project: target._projectId,
        instance: target._agentInstanceId,
        session: target.session_id,
      });
      if (agent) params.set("agent", agent.agent_id);
      navigate(`/chat?${params.toString()}`);
    },
    [navigate, resolveSessionAgent],
  );

  const handleSessionHover = useCallback((target: AnnotatedSession) => {
    void useChatHistoryStore.getState().fetchHistory(
      sessionHistoryKey(
        target._projectId,
        target._agentInstanceId,
        target.session_id,
      ),
      () =>
        api.listSessionEvents(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        ),
    );
  }, []);

  // Pick the correct surface key for delete error / undo so the inline
  // banner and `restoreSession` land on the agent's own surface (not
  // the project's). Optimistic rows from the project sidekick reuse
  // the same surface keying.
  const surfaceKeyForSession = useCallback(
    (target: AnnotatedSession): string => {
      const agent = resolveSessionAgent(target);
      return agent
        ? agentSessionsSurfaceKey(agent.agent_id)
        : projectSessionsSurfaceKey(target._projectId);
    },
    [resolveSessionAgent],
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

  // Surface a single delete-error banner pinned to the chat agent's
  // surface — that's the dominant target (every CEO chat lands there)
  // and avoids stacking N banners for N agents.
  const primarySurfaceKey = useMemo(
    () =>
      chatAgent ? agentSessionsSurfaceKey(chatAgent.agent_id) : undefined,
    [chatAgent],
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
