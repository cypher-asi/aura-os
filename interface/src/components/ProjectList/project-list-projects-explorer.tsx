import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ExplorerNode } from "@cypher-asi/zui";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import {
  getMobileProjectDestination,
  projectAgentRoute,
  projectFilesRoute,
  projectRootPath,
  projectStatsRoute,
  projectWorkRoute,
} from "../../utils/mobileNavigation";
import { getCollapsedProjects, getLastAgent, setCollapsedProjects } from "../../utils/storage";
import type { useProjectListData } from "./useProjectListData";
import { filterTree, getLastSelectedId } from "./project-list-shared";
import { useExplorerMenus } from "./useExplorerMenus";
import {
  buildProjectExplorerNode,
  executionNodeId,
  type ProjectExplorerNodeStyles,
} from "./project-list-explorer-node";
import {
  isProjectNestedPath,
  registerProjectExplorerAgents,
} from "./project-list-explorer-helpers";
import { useProjectsSidebarEffects } from "./use-projects-sidebar-effects";

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
      handleAddAgent: data.actions.handleAddAgent,
    }),
    [data],
  );

  const explorerData = useMemo(
    () =>
      data.projects
        .filter((project) => project.name.trim())
        .map((project) =>
          buildProjectExplorerNode(
            project,
            nodeBuildContext,
            statusMap,
            machineTypesMap,
            explorerStyles,
          ),
        ),
    [data.projects, explorerStyles, machineTypesMap, nodeBuildContext, statusMap],
  );

  const filteredExplorerData = useMemo(
    () => filterTree(explorerData, data.searchQuery),
    [data.searchQuery, explorerData],
  );

  const computedExpandedIds = useMemo(
    () =>
      explorerData
        .filter(
          (node) =>
            node.children &&
            node.children.length > 0 &&
            !node.children[0]?.id?.startsWith("_load_"),
        )
        .map((node) => node.id),
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
  persistExpandedState: (nodeId: string, expanded: boolean) => void;
} {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(getCollapsedProjects()),
  );
  const [expandedIds, setExpandedIds] = useState<string[]>(
    () => computedExpandedIds.filter((id) => !collapsedIds.has(id)),
  );

  useEffect(() => {
    if (loadingProjects) return;
    setExpandedIds((previousIds) => {
      const previousSet = new Set(previousIds);
      const nextIds = computedExpandedIds.filter(
        (id) => !previousSet.has(id) && !collapsedIds.has(id),
      );
      return nextIds.length > 0 ? [...previousIds, ...nextIds] : previousIds;
    });
  }, [collapsedIds, computedExpandedIds, loadingProjects]);

  const persistExpandedState = useCallback((nodeId: string, expanded: boolean) => {
    setExpandedIds((previousIds) => {
      if (expanded) {
        return previousIds.includes(nodeId) ? previousIds : [...previousIds, nodeId];
      }
      return previousIds.filter((existingId) => existingId !== nodeId);
    });

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

  return { defaultExpandedIds, expandedIds, persistExpandedState };
}

function useSelectedProjectNode(
  data: ReturnType<typeof useProjectListData>,
): { defaultSelectedIds: string[]; selectedNodeId: string | null } {
  const selectedNodeId = useMemo(() => {
    if (data.agentInstanceId) return data.agentInstanceId;
    if (
      data.isMobileLayout &&
      data.projectId &&
      (data.location.pathname.endsWith("/execution") ||
        data.location.pathname.endsWith("/work") ||
        data.location.pathname.endsWith("/stats"))
    ) {
      return executionNodeId(data.projectId);
    }
    return null;
  }, [data]);

  const defaultSelectedIds = useMemo(() => {
    if (selectedNodeId) return [selectedNodeId];
    if (data.projectId) return [data.projectId];
    return [];
  }, [data.projectId, selectedNodeId]);

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
      if (mobileDestination === "tasks") {
        navigate(projectWorkRoute(nodeId));
        return;
      }
      if (mobileDestination === "files") {
        navigate(projectFilesRoute(nodeId));
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
    if (agents.length === 0) return;

    const lastAgentId = getLastAgent(nodeId);
    const targetAgent =
      (lastAgentId
        ? agents.find((agent) => agent.agent_instance_id === lastAgentId)
        : undefined) ?? agents[0];
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
  persistExpandedState: (nodeId: string, expanded: boolean) => void,
): (nodeId: string, expanded: boolean) => void {
  const navigate = useNavigate();

  return useCallback((nodeId: string, expanded: boolean) => {
    if (data.projectMap.has(nodeId)) {
      persistExpandedState(nodeId, expanded);
    }

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
  }, [data, navigate, persistExpandedState]);
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
  const { defaultExpandedIds, expandedIds, persistExpandedState } =
    useProjectExpandedIds(computedExpandedIds, loadingProjects);
  const { defaultSelectedIds, selectedNodeId } = useSelectedProjectNode(data);
  const handleProjectSelection = useProjectSelectionHandler(data);
  const handleChildSelection = useProjectChildSelectionHandler(data);
  const handleSelect = useProjectSelectHandler(
    projectMap,
    handleProjectSelection,
    handleChildSelection,
  );
  const handleExpand = useProjectExpandHandler(data, persistExpandedState);
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
