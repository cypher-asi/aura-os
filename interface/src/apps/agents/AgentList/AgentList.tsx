import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Menu, Modal, Button } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Pencil, Pin, PinOff, Star, StarOff, Trash2 } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { AgentEditorModal } from "../../../components/AgentEditorModal";
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
} from "../stores";
import { useAuth } from "../../../stores/auth-store";
import { useChatHandoffStore } from "../../../stores/chat-handoff-store";
import { useChatHistoryStore, agentHistoryKey } from "../../../stores/chat-history-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { useOverlayScrollbar } from "../../../hooks/use-overlay-scrollbar";
import { createAgentChatHandoffState } from "../../../utils/chat-handoff";
import { standaloneAgentHandoffTarget } from "../../../utils/chat-handoff";
import { getApiErrorDetails, getApiErrorMessage } from "../../../utils/api-errors";

import type { Agent } from "../../../types";
import { isSuperAgent as isSuperAgentByPerms } from "../../../types/permissions";
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

function getDeleteAgentErrorMessage(err: unknown): string {
  const details = getApiErrorDetails(err);
  const message = getApiErrorMessage(err);
  return details ? `${message} ${details}` : message;
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

function AgentConversationRowWithHistory({
  agent,
  isMobileLibrary,
  isSelected,
  onClick,
  onContextMenu,
  onMouseEnter,
}: {
  agent: Agent;
  isMobileLibrary: boolean;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
}) {
  const lastMessage = useChatHistoryStore((state) => {
    if (isMobileLibrary) return undefined;
    const messages = state.entries[agentHistoryKey(agent.agent_id)]?.events;
    return messages?.length ? messages[messages.length - 1] : undefined;
  });

  return (
    <AgentConversationRow
      agent={agent}
      lastMessage={lastMessage}
      showMetadataOnly={isMobileLibrary}
      isSelected={isSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
    />
  );
}

export function AgentList({ mode = "default" }: AgentListProps) {
  const { agents, fetchAgents } = useAgents();
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
  const pendingCreateAgentHandoff = useChatHandoffStore((state) => state.pendingCreateAgentHandoff);
  const beginCreateAgentHandoff = useChatHandoffStore((state) => state.beginCreateAgentHandoff);

  // Desktop/tablet: `AgentMainPanel` loads the agent list. Mobile standalone library (`/agents`)
  // renders this list without the main panel — fetch here only in that mode.
  useEffect(() => {
    if (!isMobileLibrary) return;
    void fetchAgents().catch(() => {});
  }, [fetchAgents, isMobileLibrary]);

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
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [optimisticDeletedAgentId, setOptimisticDeletedAgentId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { thumbStyle, visible, onThumbPointerDown } = useOverlayScrollbar(scrollRef);

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
    navigate(`/agents/${selectedAgentId}`);
  }, [navigate]);

  const handleHoverPrefetch = useCallback((selectedAgentId: string) => {
    if (isMobileLibrary) return;
    useChatHistoryStore.getState().prefetchHistory(
      agentHistoryKey(selectedAgentId),
      () =>
        api.agents.listEvents(selectedAgentId, {
          limit: STANDALONE_AGENT_HISTORY_LIMIT,
        }),
    );
  }, [isMobileLibrary]);

  const prefetchAgentIds = useMemo(
    () => (isDesktopSidebar ? agents.map((a) => a.agent_id) : []),
    [agents, isDesktopSidebar],
  );

  useEffect(() => {
    if (prefetchAgentIds.length === 0) return;
    // Prefetch last-message previews for the sidebar with a small concurrency
    // gate so first paint isn't blocked by a flood of parallel requests. The
    // chat-history store TTL-caches, so repeats are cheap.
    const CONCURRENCY = 4;
    let cancelled = false;
    const queue = [...prefetchAgentIds];
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
      }
    };
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, prefetchAgentIds.length) },
      () => worker(),
    );
    void Promise.all(workers);
    return () => {
      cancelled = true;
    };
  }, [prefetchAgentIds]);

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
          setDeleteError(null);
          break;
      }
      setCtxMenu(null);
    },
    [ctxMenu, togglePin, toggleFavorite],
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

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deletingSelectedAgent = agentId === target.agent_id;
    const replacementAgentId = deletingSelectedAgent
      ? pickReplacementAgentId(filteredAgents, target.agent_id)
        ?? pickReplacementAgentId(sortedAgents, target.agent_id)
      : null;

    setDeleteLoading(true);
    setDeleteError(null);
    setDeleteTarget(null);
    setOptimisticDeletedAgentId(target.agent_id);

    if (deletingSelectedAgent) {
      setSelectedAgent(replacementAgentId);
      navigate(replacementAgentId ? `/agents/${replacementAgentId}` : "/agents");
    }

    try {
      await api.agents.delete(target.agent_id);
      useAgentStore.getState().removeAgent(target.agent_id);
      setOptimisticDeletedAgentId(null);
      useAgentStore.getState().fetchAgents({ force: true });
    } catch (err) {
      setOptimisticDeletedAgentId(null);
      if (deletingSelectedAgent) {
        setSelectedAgent(target.agent_id);
        navigate(`/agents/${target.agent_id}`);
      }
      setDeleteTarget(target);
      setDeleteError(getDeleteAgentErrorMessage(err));
    } finally {
      setDeleteLoading(false);
    }
  }, [agentId, deleteTarget, filteredAgents, navigate, setSelectedAgent, sortedAgents]);

  if (visibleSortedAgents.length === 0) {
    return (
      <>
        <EmptyState>Add an agent to get started.</EmptyState>
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

  const entries = filteredAgents.map((agent) => (
    <AgentConversationRowWithHistory
      key={agent.agent_id}
      agent={agent}
      isMobileLibrary={isMobileLibrary}
      isSelected={agent.agent_id === agentId}
      onClick={() => handleAgentRowClick(agent.agent_id)}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => handleHoverPrefetch(agent.agent_id)}
    />
  ));

  return (
    <>
      {isDesktopSidebar ? (
        <div className={styles.sidebarRoot}>
          <div
            ref={scrollRef}
            className={styles.sidebarScrollArea}
            onContextMenu={handleContextMenu}
          >
            <div className={styles.sidebarEntries}>{entries}</div>
          </div>
          <div className={styles.scrollTrack}>
            <div
              className={`${styles.scrollThumb} ${visible ? styles.scrollThumbVisible : ""}`}
              style={thumbStyle}
              onPointerDown={onThumbPointerDown}
            />
          </div>
        </div>
      ) : (
        <div className={styles.list} onContextMenu={handleContextMenu}>
          {entries}
        </div>
      )}

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
                !!user?.network_user_id && user.network_user_id === ctxMenu.agent.user_id,
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

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title="Delete Agent"
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
              className={styles.dangerButton}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className={styles.confirmMessage}>
          Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
        </div>
        {deleteError && <div className={styles.errorText}>{deleteError}</div>}
      </Modal>

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
          useAgentStore.getState().patchAgent(updated);
          useProjectsListStore.getState().patchAgentTemplateFields(updated);
          void fetchAgents({ force: true });
          setEditTarget(null);
        }}
      />
    </>
  );
}
