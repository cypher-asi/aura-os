import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ExplorerNode } from "@cypher-asi/zui";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import {
  getMobileProjectDestination,
  projectAgentRoute,
  projectProcessRoute,
  projectRootPath,
  projectStatsRoute,
  projectTasksRoute,
  projectWorkRoute,
} from "../../utils/mobileNavigation";
import { getCollapsedProjects, getLastAgent, setCollapsedProjects } from "../../utils/storage";
import type { useProjectListData } from "./useProjectListData";
import {
  filterTree,
  getLastSelectedId,
  getPreferredProjectAgent,
} from "./project-list-shared";
import { useExplorerMenus } from "./useExplorerMenus";
import {
  ARCHIVED_ROOT_NODE_ID,
  buildAgentNode,
  buildProjectExplorerNode,
  executionNodeId,
  type ProjectExplorerBuildContext,
  type ProjectExplorerNodeStyles,
} from "./project-list-explorer-node";
import {
  isProjectNestedPath,
  registerProjectExplorerAgents,
} from "./project-list-explorer-helpers";
import { useProjectsSidebarEffects } from "./use-projects-sidebar-effects";

function compareUpdatedAtDesc(
  left: { updated_at?: string },
  right: { updated_at?: string },
): number {
  const leftTime = Date.parse(left.updated_at ?? "");
  const rightTime = Date.parse(right.updated_at ?? "");
  const safeLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
  const safeRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
  return safeRightTime - safeLeftTime;
}

function collectExpandableNodeIds(nodes: ExplorerNode[]): string[] {
  const expandedIds: string[] = [];
  for (const node of nodes) {
    if (!node.children || node.children.length === 0) {
      continue;
    }
    if (
      node.id !== ARCHIVED_ROOT_NODE_ID &&
      !node.children[0]?.id?.startsWith("_load_")
    ) {
      expandedIds.push(node.id);
    }
    expandedIds.push(...collectExpandableNodeIds(node.children));
  }
  return expandedIds;
}

function buildArchivedRootNode(
  context: ProjectExplorerBuildContext,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNode {
  const archivedAgents = Object.entries(context.agentsByProject)
    .flatMap(([projectId, agents]) =>
      (agents ?? [])
        .filter((agent) => agent.status === "archived")
        .map((agent) => ({ projectId, agent })),
    )
    .sort((left, right) => compareUpdatedAtDesc(left.agent, right.agent));

  return {
    id: ARCHIVED_ROOT_NODE_ID,
    label: "Archived",
    metadata: { type: "archived-root" },
    children: archivedAgents.length > 0
      ? archivedAgents.map(({ projectId, agent }) =>
          buildAgentNode(
            agent,
            projectId,
            context,
            statusMap,
            machineTypesMap,
            explorerStyles,
          ),
        )
      : [
          {
            id: "_empty_archived",
            label: "No archived agents",
            icon: <span aria-hidden="true">-</span>,
            disabled: true,
            metadata: { type: "project-empty", projectId: ARCHIVED_ROOT_NODE_ID },
          },
        ],
  };
}

function useProjectExplorerData(
  data: ReturnType<typeof useProjectListData>,
  explorerStyles: ProjectExplorerNodeStyles,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
): {
  computedExpandedIds: string[];
  explorerData: ExplorerNode[];
  filteredExplorerData: ExplorerNode[];
} {
  const nodeBuildContext = useMemo(
    () => ({
      agentsByProject: data.agentsByProject,
      automatingProjectId: data.automatingProjectId,
      automatingAgentInstanceId: data.automatingAgentInstanceId,
      isMobileLayout: data.isMobileLayout,
      streamingAgentInstanceId: data.sidekick.streamingAgentInstanceId,
      creatingGeneralAgentProjectIds: data.actions.creatingGeneralAgentProjectIds,
      archivingAgentInstanceIds: data.actions.archivingAgentInstanceIds,
      handleQuickAddAgent: data.actions.handleQuickAddAgent,
      handleArchiveAgent: data.actions.handleArchiveAgent,
    }),
    [data],
  );

  const explorerData = useMemo(
    () => {
      const projectNodes = data.projects
        .filter((project) => project.name.trim())
        .map((project) =>
          buildProjectExplorerNode(
            project,
            nodeBuildContext,
            statusMap,
            machineTypesMap,
            explorerStyles,
          ),
        );
      return [
        ...projectNodes,
        buildArchivedRootNode(
          nodeBuildContext,
          statusMap,
          machineTypesMap,
          explorerStyles,
        ),
      ];
    },
    [data.projects, explorerStyles, machineTypesMap, nodeBuildContext, statusMap],
  );

  const filteredExplorerData = useMemo(
    () => filterTree(explorerData, data.searchQuery),
    [data.searchQuery, explorerData],
  );

  const computedExpandedIds = useMemo(
    () => collectExpandableNodeIds(explorerData),
    [explorerData],
  );

  return { computedExpandedIds, explorerData, filteredExplorerData };
}

function useProjectExpandedIds(
  computedExpandedIds: string[],
  loadingProjects: boolean,
): {
  defaultExpandedIds: string[];
  expandedIds: string[];
  setExpandedState: (nodeId: string, expanded: boolean, persist: boolean) => void;
} {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(getCollapsedProjects()),
  );
  const [expandedIds, setExpandedIds] = useState<string[]>(
    () => computedExpandedIds.filter((id) => !collapsedIds.has(id)),
  );

  useEffect(() => {
    if (loadingProjects) return;
    // Sync newly discovered expandable nodes into local UI state without
    // resetting any manual expand/collapse choices the user already made.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedIds((previousIds) => {
      const previousSet = new Set(previousIds);
      const nextIds = computedExpandedIds.filter(
        (id) => !previousSet.has(id) && !collapsedIds.has(id),
      );
      return nextIds.length > 0 ? [...previousIds, ...nextIds] : previousIds;
    });
  }, [collapsedIds, computedExpandedIds, loadingProjects]);

  const setExpandedState = useCallback((nodeId: string, expanded: boolean, persist: boolean) => {
    setExpandedIds((previousIds) => {
      if (expanded) {
        return previousIds.includes(nodeId) ? previousIds : [...previousIds, nodeId];
      }
      return previousIds.filter((existingId) => existingId !== nodeId);
    });

    if (!persist) {
      return;
    }

    setCollapsedIds((previousIds) => {
      const nextIds = new Set(previousIds);
      if (expanded) {
        nextIds.delete(nodeId);
      } else {
        nextIds.add(nodeId);
      }
      setCollapsedProjects([...nextIds]);
      return nextIds;
    });
  }, []);

  const defaultExpandedIds = useMemo(
    () => computedExpandedIds.filter((id) => !collapsedIds.has(id)),
    [collapsedIds, computedExpandedIds],
  );

  return { defaultExpandedIds, expandedIds, setExpandedState };
}

function useSelectedProjectNode(
  data: ReturnType<typeof useProjectListData>,
): { defaultSelectedIds: string[]; selectedNodeId: string | null } {
  const selectedNodeId = useMemo(() => {
    if (data.agentInstanceId) return data.agentInstanceId;
    if (
      data.isMobileLayout &&
      data.projectId &&
      isProjectNestedPath(data.location.pathname, false)
    ) {
      return executionNodeId(data.projectId);
    }
    return null;
  }, [data.agentInstanceId, data.isMobileLayout, data.location.pathname, data.projectId]);

  const handoffTarget = useMemo(() => {
    if (!data.projectId || !data.agentInstanceId) {
      return null;
    }
    return `project:${data.projectId}:${data.agentInstanceId}`;
  }, [data.agentInstanceId, data.projectId]);

  const shouldFreezeSelection =
    handoffTarget !== null &&
    data.pendingCreateAgentHandoff?.target === handoffTarget;
  const stableSelectionRef = useRef<{ selectedNodeId: string | null; defaultSelectedIds: string[] }>({
    selectedNodeId,
    defaultSelectedIds: selectedNodeId ? [selectedNodeId] : (data.projectId ? [data.projectId] : []),
  });

  const defaultSelectedIds = useMemo(() => {
    if (selectedNodeId) return [selectedNodeId];
    if (data.projectId) return [data.projectId];
    return [];
  }, [data.projectId, selectedNodeId]);

  useEffect(() => {
    if (shouldFreezeSelection) {
      return;
    }
    stableSelectionRef.current = { selectedNodeId, defaultSelectedIds };
  }, [defaultSelectedIds, selectedNodeId, shouldFreezeSelection]);

  if (shouldFreezeSelection) {
    return stableSelectionRef.current;
  }

  return { defaultSelectedIds, selectedNodeId };
}

function useProjectSelectionHandler(
  data: ReturnType<typeof useProjectListData>,
): (nodeId: string) => void {
  const navigate = useNavigate();

  return useCallback((nodeId: string) => {
    const mobileDestination = getMobileProjectDestination(data.location.pathname);
    const isNested = isProjectNestedPath(
      data.location.pathname,
      Boolean(data.agentInstanceId),
    );
    if (nodeId !== data.projectId) {
      data.sidekick.closePreview();
    }
    if (data.isMobileLayout) {
      if (nodeId === data.projectId && isNested) {
        navigate(projectRootPath(nodeId));
        return;
      }
      if (mobileDestination === "execution") {
        navigate(projectWorkRoute(nodeId));
        return;
      }
      if (mobileDestination === "tasks") {
        navigate(projectTasksRoute(nodeId));
        return;
      }
      if (mobileDestination === "process") {
        navigate(projectProcessRoute(nodeId));
        return;
      }
      if (mobileDestination === "stats") {
        navigate(projectStatsRoute(nodeId));
        return;
      }
      navigate(projectAgentRoute(nodeId));
      return;
    }

    const agents = data.agentsByProject[nodeId];
    if (!agents) {
      navigate(projectAgentRoute(nodeId));
      return;
    }
    if (agents.length === 0) {
      navigate(projectAgentRoute(nodeId));
      return;
    }

    const lastAgentId = getLastAgent(nodeId);
    const targetAgent = getPreferredProjectAgent(agents, lastAgentId);
    if (!targetAgent) {
      navigate(projectAgentRoute(nodeId));
      return;
    }
    navigate(`/projects/${nodeId}/agents/${targetAgent.agent_instance_id}`);
  }, [data, navigate]);
}

function useProjectChildSelectionHandler(
  data: ReturnType<typeof useProjectListData>,
): (nodeId: string) => void {
  const navigate = useNavigate();

  return useCallback((nodeId: string) => {
    if (nodeId.startsWith("execution:")) {
      const projectId = nodeId.slice("execution:".length);
      if (projectId !== data.projectId) {
        data.sidekick.closePreview();
      }
      const nextPath = projectWorkRoute(projectId);
      if (data.location.pathname !== nextPath) {
        navigate(nextPath);
      }
      return;
    }

    const meta = data.agentMeta.get(nodeId);
    if (!meta) return;
    if (meta.projectId !== data.projectId) {
      data.sidekick.closePreview();
    }

    const nextPath = `/projects/${meta.projectId}/agents/${nodeId}`;
    if (data.location.pathname !== nextPath) {
      navigate(nextPath);
    }
  }, [data, navigate]);
}

function useProjectExpandHandler(
  data: ReturnType<typeof useProjectListData>,
  setExpandedState: (nodeId: string, expanded: boolean, persist: boolean) => void,
): (nodeId: string, expanded: boolean) => void {
  const navigate = useNavigate();

  return useCallback((nodeId: string, expanded: boolean) => {
    const isProjectGroup = data.projectMap.has(nodeId);
    setExpandedState(nodeId, expanded, isProjectGroup);

    const isNested = isProjectNestedPath(
      data.location.pathname,
      Boolean(data.agentInstanceId),
    );
    if (!expanded && nodeId === data.projectId && isNested) {
      data.sidekick.closePreview();
      if (data.isMobileLayout) {
        navigate(projectRootPath(nodeId));
      }
      return;
    }

    if (expanded && data.projectMap.has(nodeId) && !(nodeId in data.agentsByProject)) {
      void data.refreshProjectAgents(nodeId);
    }
  }, [data, navigate, setExpandedState]);
}

function useProjectSelectHandler(
  projectMap: ReturnType<typeof useProjectListData>["projectMap"],
  handleProjectSelection: (nodeId: string) => void,
  handleChildSelection: (nodeId: string) => void,
): (ids: Iterable<string>) => void {
  return useCallback((ids: Iterable<string>) => {
    const selectedId = getLastSelectedId(ids);
    if (!selectedId) return;
    if (projectMap.has(selectedId)) {
      handleProjectSelection(selectedId);
      return;
    }
    handleChildSelection(selectedId);
  }, [handleChildSelection, handleProjectSelection, projectMap]);
}

function useProjectToggleHandler(
  expandedIds: string[],
  handleExpand: (nodeId: string, expanded: boolean) => void,
): (nodeId: string) => void {
  return useCallback((nodeId: string) => {
    handleExpand(nodeId, !expandedIds.includes(nodeId));
  }, [expandedIds, handleExpand]);
}

export function useProjectsExplorerModel(
  data: ReturnType<typeof useProjectListData>,
  explorerStyles: ProjectExplorerNodeStyles,
) {
  useProjectsSidebarEffects(data);

  const statusMap = useProfileStatusStore((s) => s.statuses);
  const machineTypesMap = useProfileStatusStore((s) => s.machineTypes);
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemoteAgents = useProfileStatusStore((s) => s.registerRemoteAgents);

  const { projects, loadingProjects, agentsByProject, searchQuery, actions, projectMap, agentMeta } =
    data;

  useEffect(() => {
    registerProjectExplorerAgents(
      agentsByProject,
      registerAgents,
      registerRemoteAgents,
    );
  }, [agentsByProject, registerAgents, registerRemoteAgents]);

  const { computedExpandedIds, explorerData, filteredExplorerData } =
    useProjectExplorerData(data, explorerStyles, statusMap, machineTypesMap);
  const { defaultExpandedIds, expandedIds, setExpandedState } =
    useProjectExpandedIds(computedExpandedIds, loadingProjects);
  const { defaultSelectedIds, selectedNodeId } = useSelectedProjectNode(data);
  const handleProjectSelection = useProjectSelectionHandler(data);
  const handleChildSelection = useProjectChildSelectionHandler(data);
  const handleSelect = useProjectSelectHandler(
    projectMap,
    handleProjectSelection,
    handleChildSelection,
  );
  const handleExpand = useProjectExpandHandler(data, setExpandedState);
  const handleProjectToggle = useProjectToggleHandler(expandedIds, handleExpand);

  const { handleContextMenu, handleKeyDown } = useExplorerMenus(
    projectMap,
    agentMeta,
    actions,
  );

  return {
    actions,
    defaultExpandedIds,
    defaultSelectedIds,
    explorerData,
    expandedIds,
    filteredExplorerData,
    handleChildSelection,
    handleContextMenu,
    handleExpand,
    handleKeyDown,
    handleProjectSelection,
    handleProjectToggle,
    handleSelect,
    isEmptyState: !loadingProjects && projects.length === 0,
    loadingProjects,
    projectId: data.projectId,
    searchActive: searchQuery.trim().length > 0,
    selectedNodeId,
  };
}
