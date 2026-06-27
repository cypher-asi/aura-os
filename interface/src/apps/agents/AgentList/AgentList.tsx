import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Loader2, Pencil, Pin, PinOff, Star, StarOff, Trash2 } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { AgentEditorModal } from "../components/AgentEditorModal";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton";
import { AgentConversationRow } from "../AgentConversationRow";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import {
  api,
  STANDALONE_AGENT_HISTORY_LIMIT,
} from "../../../api/client";
import {
  useAgents,
  useSelectedAgent,
  useAgentStore,
  useSortedAgents,
  warmStandaloneAgentHistory,
  warmStandaloneAgentSession,
} from "../stores";
import { useAuth } from "../../../stores/auth-store";
import { useChatHandoffStore } from "../../../stores/chat-handoff-store";
import { useChatHistoryStore, agentHistoryKey } from "../../../stores/chat-history-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { LeftMenuTree } from "../../../features/left-menu";
import type { LeftMenuEntry } from "../../../features/left-menu";
import { useAgentRowModels, type AgentRowModel } from "./use-agent-row-models";
import { createAgentChatHandoffState } from "../../../utils/chat-handoff";
import { standaloneAgentHandoffTarget } from "../../../utils/chat-handoff";
import { useCascadeDeleteAgent } from "../hooks/use-cascade-delete-agent";
import { DeleteAgentConfirmModal } from "../hooks/DeleteAgentConfirmModal";
import { useDeferredModalOpen } from "../../../shared/hooks/use-deferred-modal-open";
import { agentDisplayName } from "../../../lib/derive-project-agent-title";
import { isAgentOwnedByUser } from "../utils/agent-ownership";

import type { Agent } from "../../../shared/types";
import { isSuperAgent as isSuperAgentByPerms } from "../../../shared/types/permissions";
import styles from "./AgentList.module.css";

function buildAgentMenuItems(
  agent: Agent,
  pinnedIds: Set<string>,
  favoriteIds: Set<string>,
  isOwnAgent: boolean,
): MenuItem[] {
  const isSuperAgent = isSuperAgentByPerms(agent);
  const isPinned = agent.is_pinned || pinnedIds.has(agent.agent_id);
  const isFavorite = favoriteIds.has(agent.agent_id);
  const items: MenuItem[] = [];

  if (isOwnAgent) {
    items.push({ id: "edit", label: "Edit", icon: <Pencil size={14} /> });
  }

  if (!isSuperAgent) {
    items.push(
      isPinned
        ? { id: "unpin", label: "Unpin", icon: <PinOff size={14} /> }
        : { id: "pin", label: "Pin to top", icon: <Pin size={14} /> },
    );
  }

  items.push(
    isFavorite
      ? { id: "unfavorite", label: "Remove from taskbar", icon: <StarOff size={14} /> }
      : { id: "favorite", label: "Add to taskbar", icon: <Star size={14} /> },
  );

  if (!isSuperAgent) {
    items.push({ id: "delete", label: "Delete", icon: <Trash2 size={14} /> });
  }

  return items;
}

function pickReplacementAgentId(agents: Agent[], deletedAgentId: string): string | null {
  const index = agents.findIndex((agent) => agent.agent_id === deletedAgentId);
  if (index === -1) {
    return agents[0]?.agent_id ?? null;
  }

  return agents[index + 1]?.agent_id ?? agents[index - 1]?.agent_id ?? null;
}

interface CtxMenuState {
  x: number;
  y: number;
  agent: Agent;
}

interface AgentListProps {
  mode?: "default" | "responsive-controls" | "mobile-library";
}

interface AgentRowProps {
  agent: Agent;
  model: AgentRowModel | undefined;
  isMobileLibrary: boolean;
  isSelected: boolean;
  /** Id-arg callbacks so the list can pass referentially-stable handlers. */
  onSelect: (agentId: string) => void;
  onHover: (agentId: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

// Thin wrapper that binds the per-row click/hover closures from the list's
// stable id-arg callbacks and forwards the batched `AgentRowModel` to the
// memoized presentational row. Deliberately NOT memoized itself: it re-renders
// with its parent but carries no store subscriptions, so the heavy memoized
// `AgentConversationRow` only re-renders when its own props actually change.
function AgentRow({
  agent,
  model,
  isMobileLibrary,
  isSelected,
  onSelect,
  onHover,
  onContextMenu,
}: AgentRowProps) {
  const handleClick = useCallback(() => onSelect(agent.agent_id), [onSelect, agent.agent_id]);
  const handleMouseEnter = useCallback(() => onHover(agent.agent_id), [onHover, agent.agent_id]);

  return (
    <AgentConversationRow
      agent={agent}
      lastMessage={model?.lastMessage}
      showMetadataOnly={isMobileLibrary}
      isSelected={isSelected}
      status={model?.status}
      isLocal={model?.isLocal}
      busy={model?.busy}
      loopActivity={model?.loopActivity ?? null}
      isPinned={model?.isPinned}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={handleMouseEnter}
    />
  );
}

// Initial virtualizer size estimate for an agent row (avatar + two lines).
// The shared `LeftMenuTree` measures the real height from the DOM after mount.
const AGENT_ROW_ESTIMATED_HEIGHT = 58;

export function AgentList({ mode = "default" }: AgentListProps) {
  const { agents, status: agentsStatus, fetchAgents } = useAgents();
  const { setSelectedAgent } = useSelectedAgent();
  const isMobileLibrary = mode === "mobile-library";
  const isDesktopSidebar = mode === "default";
  const { query: searchQuery, setAction } = useSidebarSearch("agents");
  const location = useLocation();
  const navigate = useNavigate();
  const { agentId } = useParams();
  const [showEditor, setShowEditor] = useState(false);
  const [pendingCreatedAgentId, setPendingCreatedAgentId] = useState<string | null>(null);
  const shouldOpenMobileCreate = isMobileLibrary && new URLSearchParams(location.search).get("create") === "1";
  const createAgentModalOpen = useAgentStore((s) => s.createAgentModalOpen);
  const closeCreateAgentModal = useAgentStore((s) => s.closeCreateAgentModal);

  useEffect(() => {
    if (createAgentModalOpen) {
      setShowEditor(true);
      closeCreateAgentModal();
    }
  }, [createAgentModalOpen, closeCreateAgentModal]);
  const pendingCreateAgentHandoff = useChatHandoffStore((state) => state.pendingCreateAgentHandoff);
  const beginCreateAgentHandoff = useChatHandoffStore((state) => state.beginCreateAgentHandoff);

  // The sidebar is the always-mounted owner of the agent list, so it kicks off
  // the fetch on app open. (Previously `AgentMainPanel` did this; that became a
  // passthrough when the chat moved into `ConversationSurfaceHost`, and the
  // boot fetch was lost — leaving the list empty until a lazy trigger fired.)
  // `fetchAgents` is idempotent: it short-circuits on a recent ready state and
  // dedupes concurrent callers via its in-flight promise.
  useEffect(() => {
    void fetchAgents().catch(() => {});
  }, [fetchAgents]);

  useEffect(() => {
    if (shouldOpenMobileCreate) {
      setShowEditor(true);
    }
  }, [shouldOpenMobileCreate]);

  useEffect(() => {
    if (!pendingCreatedAgentId) {
      return;
    }
    if (pendingCreateAgentHandoff?.target === standaloneAgentHandoffTarget(pendingCreatedAgentId)) {
      return;
    }
    setShowEditor(false);
    setPendingCreatedAgentId(null);
  }, [pendingCreateAgentHandoff, pendingCreatedAgentId]);

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const { user } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [optimisticDeletedAgentId, setOptimisticDeletedAgentId] = useState<string | null>(null);
  const cascade = useCascadeDeleteAgent(deleteTarget);
  // Defer opening the confirm modal until bindings have loaded so the
  // modal opens once at its final size (footer button label depends on
  // bindings.length; without this it widens mid-render).
  const { isOpen: deleteModalOpen } = useDeferredModalOpen({
    requestedOpen: !!deleteTarget,
    prepare: () => cascade.refresh(),
  });
  useEffect(() => {
    setAction(
      "agents",
      <ProjectsPlusButton onClick={() => setShowEditor(true)} title="New Agent" />,
    );
    return () => setAction("agents", null);
  }, [setAction]);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.agent_id, a])),
    [agents],
  );

  useEffect(() => {
    if (!ctxMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleAgentSaved = useCallback(
    (agent: Agent) => {
      setPendingCreatedAgentId(agent.agent_id);
      beginCreateAgentHandoff(standaloneAgentHandoffTarget(agent.agent_id), agent.name);
      fetchAgents({ force: true });
      navigate(`/agents/${agent.agent_id}`, {
        state: createAgentChatHandoffState(),
      });
    },
    [beginCreateAgentHandoff, fetchAgents, navigate],
  );

  const handleEditorClose = useCallback(() => {
    setShowEditor(false);
    if (shouldOpenMobileCreate) {
      navigate("/agents", { replace: true });
    }
  }, [navigate, shouldOpenMobileCreate]);

  const handleAgentRowClick = useCallback((selectedAgentId: string) => {
    if (selectedAgentId === agentId) return;
    // Warm the destination history on click too (not just hover): a direct
    // click — keyboard, touch, or a fast pointer that never fires a hover —
    // would otherwise reach `/agents/:id` with an `idle` history entry and
    // re-arm `ChatPanel`'s cold-load gate. `warmStandaloneAgentHistory` is
    // idempotent, so overlapping with a prior hover prefetch stays cheap.
    if (!isMobileLibrary) {
      warmStandaloneAgentHistory(selectedAgentId);
    }
    navigate(`/agents/${selectedAgentId}`);
  }, [agentId, isMobileLibrary, navigate]);

  // Pre-warm the chat-history-store entries the standalone chat reads so
  // `ChatPanel`'s cold-load gate (`.messageContentHidden` + the fading
  // overlay) doesn't arm on agent switch. Shared with the click handler and
  // the post-login auto-redirect via `warmStandaloneAgentHistory`.
  const handleHoverPrefetch = useCallback((selectedAgentId: string) => {
    if (isMobileLibrary) return;
    warmStandaloneAgentHistory(selectedAgentId);
  }, [isMobileLibrary]);

  // Prefetch last-message previews for the OTHER agents in the sidebar so
  // each row can render a recent-message snippet. Excludes the currently
  // selected agent because `AgentChatRoute` is already fetching that one —
  // queuing it here would just put the foreground request at the back of
  // the line on cold boot. The currently-selected fetch also gates our
  // start so the active chat's history round-trip doesn't contend with
  // preview prefetches for every other agent.
  const prefetchAgentIds = useMemo(() => {
    if (!isDesktopSidebar) return [];
    return agents.map((a) => a.agent_id).filter((id) => id !== agentId);
  }, [agents, isDesktopSidebar, agentId]);

  const activeHistoryResolved = useChatHistoryStore((s) => {
    if (!isDesktopSidebar || !agentId) return true;
    const entry = s.entries[agentHistoryKey(agentId)];
    return entry?.status === "ready" || entry?.status === "error";
  });

  useEffect(() => {
    if (prefetchAgentIds.length === 0) return;
    if (!activeHistoryResolved) return;
    // Small concurrency gate + idle scheduling so the foreground chat has
    // finished loading before we spray the storage backend with preview
    // fetches for every other agent. The chat-history store TTL-caches,
    // so repeats are cheap.
    const CONCURRENCY = 2;
    let cancelled = false;
    const queue = [...prefetchAgentIds];
    const runWhenIdle = (cb: () => void) => {
      const ric = (
        window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback;
      if (typeof ric === "function") {
        ric(cb, { timeout: 500 });
      } else {
        setTimeout(cb, 0);
      }
    };
    const worker = async () => {
      while (!cancelled && queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        try {
          await useChatHistoryStore.getState().fetchHistory(
            agentHistoryKey(id),
            () =>
              api.agents.listEvents(id, {
                limit: STANDALONE_AGENT_HISTORY_LIMIT,
              }),
          );
        } catch {
          // errors are stored on the history entry; keep draining the queue
        }
        if (cancelled) break;
        // Also warm the most-recent project session for this agent so
        // clicking it lands on a `historyResolved=true` first render and
        // skips the cold-load reveal cycle. Best-effort; failures are
        // already absorbed by the loader and `fetchHistory`.
        warmStandaloneAgentSession(id);
      }
    };
    runWhenIdle(() => {
      if (cancelled) return;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, prefetchAgentIds.length) },
        () => worker(),
      );
      void Promise.all(workers);
    });
    return () => {
      cancelled = true;
    };
  }, [prefetchAgentIds, activeHistoryResolved]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const agent = agentMap.get(target.id);
      if (agent) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, agent });
      }
    },
    [agentMap],
  );

  const togglePin = useAgentStore((s) => s.togglePin);
  const toggleFavorite = useAgentStore((s) => s.toggleFavorite);
  const pinnedIds = useAgentStore((s) => s.pinnedAgentIds);
  const favoriteIds = useAgentStore((s) => s.favoriteAgentIds);

  const handleMenuAction = useCallback(
    (actionId: string) => {
      if (!ctxMenu) return;
      switch (actionId) {
        case "edit":
          setEditTarget(ctxMenu.agent);
          break;
        case "pin":
        case "unpin":
          togglePin(ctxMenu.agent.agent_id);
          break;
        case "favorite":
        case "unfavorite":
          toggleFavorite(ctxMenu.agent.agent_id);
          break;
        case "delete":
          setDeleteTarget(ctxMenu.agent);
          cascade.reset();
          break;
      }
      setCtxMenu(null);
    },
    [cascade, ctxMenu, togglePin, toggleFavorite],
  );

  const sortedAgents = useSortedAgents();
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);

  useEffect(() => {
    if (agents.length === 0) return;
    registerAgents(agents.map((a) => ({ id: a.agent_id, machineType: a.machine_type })));
    const remote = agents.filter((a) => a.machine_type === "remote" && a.network_agent_id);
    if (remote.length > 0) registerRemote(remote);
  }, [agents, registerAgents, registerRemote]);

  const visibleSortedAgents = useMemo(
    () => sortedAgents.filter((agent) => agent.agent_id !== optimisticDeletedAgentId),
    [optimisticDeletedAgentId, sortedAgents],
  );

  const filteredAgents = useMemo(() => {
    if (!searchQuery) return visibleSortedAgents;
    const q = searchQuery.toLowerCase();
    return visibleSortedAgents.filter((a) => {
      const haystack = `${a.name} ${a.role} ${a.personality} ${a.system_prompt}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [visibleSortedAgents, searchQuery]);

  // Resolve every row's live state (avatar status, busy, loop, pin, preview)
  // once at the list level so the rows themselves carry no store
  // subscriptions and stay cheap to (re-)mount on a pane switch.
  const rowModels = useAgentRowModels(filteredAgents, {
    includePreview: !isMobileLibrary,
  });

  // Map agents to the shared `LeftMenuTree`'s custom-row variant: the tree
  // owns layout, virtualization, the overlay scrollbar, and the reveal
  // cascade, while each row stays the rich `AgentConversationRow`. Built
  // fresh each render (not memoized) so rows pick up new model values; the
  // memoized row bails unless its own props changed.
  const entries: LeftMenuEntry[] = filteredAgents.map((agent) => ({
    kind: "custom",
    id: agent.agent_id,
    estimatedHeight: AGENT_ROW_ESTIMATED_HEIGHT,
    content: (
      <AgentRow
        agent={agent}
        model={rowModels.get(agent.agent_id)}
        isMobileLibrary={isMobileLibrary}
        isSelected={agent.agent_id === agentId}
        onSelect={handleAgentRowClick}
        onHover={handleHoverPrefetch}
        onContextMenu={handleContextMenu}
      />
    ),
  }));

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deletingSelectedAgent = agentId === target.agent_id;
    const replacementAgentId = deletingSelectedAgent
      ? pickReplacementAgentId(filteredAgents, target.agent_id)
        ?? pickReplacementAgentId(sortedAgents, target.agent_id)
      : null;

    setOptimisticDeletedAgentId(target.agent_id);

    if (deletingSelectedAgent) {
      setSelectedAgent(replacementAgentId);
      navigate(replacementAgentId ? `/agents/${replacementAgentId}` : "/agents");
    }

    try {
      await cascade.deleteWithCascade();
      setOptimisticDeletedAgentId(null);
      setDeleteTarget(null);
    } catch {
      // Restore the row in the sidebar so the user can retry.
      setOptimisticDeletedAgentId(null);
      if (deletingSelectedAgent) {
        setSelectedAgent(target.agent_id);
        navigate(`/agents/${target.agent_id}`);
      }
      // Keep `deleteTarget` set so the modal stays open with `cascade.error` rendered.
    }
  }, [agentId, cascade, deleteTarget, filteredAgents, navigate, setSelectedAgent, sortedAgents]);

  if (visibleSortedAgents.length === 0) {
    // While the list is still loading (and the cache hasn't hydrated any rows
    // yet), don't flash the "create your first agent" copy — that's only the
    // truth once the fetch has settled. Mirrors `AgentIndexRedirect`.
    const isLoadingAgents = agentsStatus === "idle" || agentsStatus === "loading";
    return (
      <>
        {isLoadingAgents ? (
          <EmptyState icon={<Loader2 size={16} className="animate-spin" aria-hidden />}>
            Loading agents…
          </EmptyState>
        ) : (
          <EmptyState>Create your first AI agent to start chatting, automating tasks, and more.</EmptyState>
        )}
        <AgentEditorModal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          onSaved={handleAgentSaved}
          closeOnSave={false}
          isTransitioning={!!pendingCreatedAgentId}
        />
      </>
    );
  }

  return (
    <>
      <div
        className={styles.treeRoot}
        data-agent-surface="agent-list"
        data-agent-mode={mode}
      >
        <LeftMenuTree
          ariaLabel="Agents"
          entries={entries}
          onContextMenu={handleContextMenu}
          revealEnabled={isDesktopSidebar}
        />
      </div>

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <Menu
              items={buildAgentMenuItems(
                ctxMenu.agent,
                pinnedIds,
                favoriteIds,
                isAgentOwnedByUser(ctxMenu.agent, user),
              )}
              onChange={handleMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={200}
              isOpen
            />
          </div>,
          document.body,
        )}

      <DeleteAgentConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteTarget(null);
          cascade.reset();
        }}
        onDelete={handleDelete}
        deleting={cascade.deleting}
        deleteError={cascade.error}
        bindings={cascade.bindings}
        agentName={agentDisplayName(deleteTarget?.name)}
      />

      <AgentEditorModal
        isOpen={showEditor}
        onClose={handleEditorClose}
        onSaved={handleAgentSaved}
        closeOnSave={false}
        isTransitioning={!!pendingCreatedAgentId}
        titleOverride={isMobileLibrary ? "Create Remote Agent" : undefined}
        submitLabelOverride={isMobileLibrary ? "Create Remote Agent" : undefined}
      />

      <AgentEditorModal
        isOpen={!!editTarget}
        agent={editTarget ?? undefined}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          const projectsStore = useProjectsListStore.getState();
          useAgentStore.getState().patchAgent(updated);
          projectsStore.patchAgentTemplateFields(updated);
          // The agent template's `local_workspace_path` flows into every
          // project instance's `workspace_path` via `resolve_workspace_path`
          // on the server. Refresh the agent caches for each project
          // hosting an instance so the env-overlay's "Workspace Folder"
          // row picks up the new path without requiring a manual reload.
          projectsStore.refreshAgentInstancesForTemplate(updated.agent_id);
          void fetchAgents({ force: true });
          setEditTarget(null);
        }}
      />
    </>
  );
}
