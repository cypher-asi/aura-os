import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Menu } from "@cypher-asi/zui";
import { EmptyState } from "../../../components/EmptyState";
import { AgentEditorModal } from "../components/AgentEditorModal";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton";
import { AgentConversationRow } from "../AgentConversationRow";
import { AgentConversationRowWithHistory, SortableAgentConversationRow } from "./SortableAgentRow";
import { useAgentPrefetch } from "./useAgentPrefetch";
import { useAgentContextMenu } from "./useAgentContextMenu";
import { buildAgentMenuItems, pickReplacementAgentId } from "./agent-list-menu-items";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import {
  useAgents,
  useSelectedAgent,
  useAgentStore,
  useSortedAgents,
} from "../stores";
import { useAuth } from "../../../stores/auth-store";
import { useChatHandoffStore } from "../../../stores/chat-handoff-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { useOverlayScrollbar } from "../../../shared/hooks/use-overlay-scrollbar";
import { createAgentChatHandoffState } from "../../../utils/chat-handoff";
import { standaloneAgentHandoffTarget } from "../../../utils/chat-handoff";
import { DeleteAgentConfirmModal } from "../hooks/DeleteAgentConfirmModal";
import { agentDisplayName } from "../../../lib/derive-project-agent-title";

import type { Agent } from "../../../shared/types";
import styles from "./AgentList.module.css";

interface AgentListProps {
  mode?: "default" | "responsive-controls" | "mobile-library";
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

  const { user } = useAuth();
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

  const {
    ctxMenu,
    ctxMenuRef,
    editTarget,
    setEditTarget,
    deleteTarget,
    setDeleteTarget,
    deleteModalOpen,
    cascade,
    pinnedIds,
    favoriteIds,
    handleContextMenu,
    handleMenuAction,
  } = useAgentContextMenu(agentMap);

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
    navigate(`/agents/${selectedAgentId}`);
  }, [agentId, navigate]);

  const { handleHoverPrefetch } = useAgentPrefetch({
    agents,
    agentId,
    isMobileLibrary,
    isDesktopSidebar,
  });

  const setAgentOrder = useAgentStore((s) => s.setAgentOrder);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveAgentId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveAgentId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const currentIds = visibleSortedAgents.map((a) => a.agent_id);
      const fromIndex = currentIds.indexOf(String(active.id));
      const toIndex = currentIds.indexOf(String(over.id));
      if (fromIndex === -1 || toIndex === -1) return;
      setAgentOrder(arrayMove(currentIds, fromIndex, toIndex));
    },
    [visibleSortedAgents, setAgentOrder],
  );

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
      setOptimisticDeletedAgentId(null);
      if (deletingSelectedAgent) {
        setSelectedAgent(target.agent_id);
        navigate(`/agents/${target.agent_id}`);
      }
    }
  }, [agentId, cascade, deleteTarget, filteredAgents, navigate, setSelectedAgent, sortedAgents]);

  if (visibleSortedAgents.length === 0) {
    return (
      <>
        <EmptyState>Create your first AI agent to start chatting, automating tasks, and more.</EmptyState>
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

  const isDraggable = isDesktopSidebar && !searchQuery;
  const activeAgent = activeAgentId ? agentMap.get(activeAgentId) ?? null : null;
  const rowAgents = isDraggable ? visibleSortedAgents : filteredAgents;

  const entries = rowAgents.map((agent) =>
    isDraggable ? (
      <SortableAgentConversationRow
        key={agent.agent_id}
        agent={agent}
        isMobileLibrary={isMobileLibrary}
        isSelected={agent.agent_id === agentId}
        onClick={() => handleAgentRowClick(agent.agent_id)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => handleHoverPrefetch(agent.agent_id)}
      />
    ) : (
      <AgentConversationRowWithHistory
        key={agent.agent_id}
        agent={agent}
        isMobileLibrary={isMobileLibrary}
        isSelected={agent.agent_id === agentId}
        onClick={() => handleAgentRowClick(agent.agent_id)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => handleHoverPrefetch(agent.agent_id)}
      />
    ),
  );

  const sortableIds = rowAgents.map((a) => a.agent_id);

  return (
    <>
      {isDesktopSidebar ? (
        <div
          className={styles.sidebarRoot}
          data-agent-surface="agent-list"
          data-agent-mode={mode}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveAgentId(null)}
          >
            <div
              ref={scrollRef}
              className={styles.sidebarScrollArea}
              onContextMenu={handleContextMenu}
            >
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <div className={styles.sidebarEntries}>{entries}</div>
              </SortableContext>
            </div>
            <div className={styles.scrollTrack}>
              <div
                className={`${styles.scrollThumb} ${visible ? styles.scrollThumbVisible : ""}`}
                style={thumbStyle}
                onPointerDown={onThumbPointerDown}
              />
            </div>
            {activeAgent &&
              createPortal(
                <DragOverlay dropAnimation={null} style={{ zIndex: 9998 }}>
                  <div className={styles.sortableRowOverlay}>
                    <AgentConversationRow
                      agent={activeAgent}
                      lastMessage={undefined}
                      isSelected={activeAgent.agent_id === agentId}
                      onClick={() => {}}
                      onContextMenu={() => {}}
                      onMouseEnter={() => {}}
                    />
                  </div>
                </DragOverlay>,
                document.body,
              )}
          </DndContext>
        </div>
      ) : (
        <div
          className={styles.list}
          onContextMenu={handleContextMenu}
          data-agent-surface="agent-list"
          data-agent-mode={mode}
        >
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
          projectsStore.refreshAgentInstancesForTemplate(updated.agent_id);
          void fetchAgents({ force: true });
          setEditTarget(null);
        }}
      />
    </>
  );
}
