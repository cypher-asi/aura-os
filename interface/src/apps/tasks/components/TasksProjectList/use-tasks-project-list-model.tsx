import { useCallback, useEffect, useMemo, type KeyboardEventHandler, type MouseEventHandler } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";
import { useNavigate } from "react-router-dom";
import { useProfileStatusStore } from "../../../../stores/profile-status-store";
import { useProjectListData } from "../../../../components/ProjectList/useProjectListData";
import { useExplorerMenus } from "../../../../components/ProjectList/useExplorerMenus";
import { buildLeftMenuEntries, useLeftMenuExpandedGroups } from "../../../../features/left-menu";
import type { ProjectExplorerNodeStyles } from "../../../../components/ProjectList/project-list-explorer-node";
import { buildTasksExplorerNode } from "./tasks-project-list-explorer-node";
import { useTasksProjectListEffects } from "./use-tasks-project-list-effects";

function useTaskAgentRegistration(
  agentsByProject: ReturnType<typeof useProjectListData>["agentsByProject"],
): void {
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);

  useEffect(() => {
    const allAgents: { id: string; machineType: string }[] = [];
    const remoteAgents: { agent_id: string }[] = [];

    for (const agents of Object.values(agentsByProject)) {
      for (const agent of agents) {
        allAgents.push({ id: agent.agent_id, machineType: agent.machine_type });
        allAgents.push({ id: agent.agent_instance_id, machineType: agent.machine_type });
        if (agent.machine_type === "remote") {
          remoteAgents.push({ agent_id: agent.agent_id });
        }
      }
    }

    if (allAgents.length > 0) {
      registerAgents(allAgents);
    }
    if (remoteAgents.length > 0) {
      registerRemote(remoteAgents);
    }
  }, [agentsByProject, registerAgents, registerRemote]);
}

function useTaskExplorerData(
  data: ReturnType<typeof useProjectListData>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNode[] {
  const statusMap = useProfileStatusStore((s) => s.statuses);
  const machineTypesMap = useProfileStatusStore((s) => s.machineTypes);

  return useMemo(
    () =>
      data.projects
        .filter((project) => project.name.trim())
        .map((project) =>
          buildTasksExplorerNode(
            project,
            data,
            statusMap,
            machineTypesMap,
            explorerStyles,
          ),
        ),
    [data, explorerStyles, machineTypesMap, statusMap],
  );
}

function buildDefaultExpandedIds(explorerData: ExplorerNode[]): string[] {
  return explorerData
    .filter(
      (node) =>
        node.children &&
        node.children.length > 0 &&
        !node.children[0]?.id?.startsWith("_load_"),
    )
    .map((node) => node.id);
}

function useTaskNavigationHandlers(
  data: ReturnType<typeof useProjectListData>,
  setGroupExpanded: (groupId: string, expanded: boolean) => void,
): {
  handleChildSelection: (nodeId: string) => void;
  handleProjectExpand: (nodeId: string, expanded: boolean) => void;
} {
  const navigate = useNavigate();

  const handleChildSelection = useCallback((nodeId: string) => {
    const meta = data.agentMeta.get(nodeId);
    if (!meta) return;
    if (meta.projectId !== data.projectId) {
      data.sidekick.closePreview();
    }
    navigate(`/tasks/${meta.projectId}/agents/${nodeId}`);
  }, [data, navigate]);

  const handleProjectExpand = useCallback((nodeId: string, expanded: boolean) => {
    const isNested = Boolean(data.agentInstanceId);
    setGroupExpanded(nodeId, expanded);
    if (!expanded && nodeId === data.projectId && isNested) {
      data.sidekick.closePreview();
      return;
    }
    if (expanded && data.projectMap.has(nodeId) && !(nodeId in data.agentsByProject)) {
      void data.refreshProjectAgents(nodeId);
    }
  }, [data, setGroupExpanded]);

  return { handleChildSelection, handleProjectExpand };
}

function useTaskLeftMenuEntries(
  explorerData: ExplorerNode[],
  expandedIds: string[],
  searchActive: boolean,
  selectedNodeId: string | null,
  handleProjectExpand: (nodeId: string, expanded: boolean) => void,
  handleChildSelection: (nodeId: string) => void,
): ReturnType<typeof buildLeftMenuEntries> {
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(explorerData, {
        expandedIds: expandedIdSet,
        selectedNodeId,
        searchActive,
        groupTestIdPrefix: "project",
        itemTestIdPrefix: "node",
        onGroupActivate: (nodeId) =>
          handleProjectExpand(nodeId, !expandedIdSet.has(nodeId)),
        onItemSelect: handleChildSelection,
      }),
    [
      expandedIdSet,
      explorerData,
      handleChildSelection,
      handleProjectExpand,
      searchActive,
      selectedNodeId,
    ],
  );

  return entries;
}

export function useTasksProjectListModel(
  explorerStyles: ProjectExplorerNodeStyles,
): {
  actions: ReturnType<typeof useProjectListData>["actions"];
  entries: ReturnType<typeof buildLeftMenuEntries>;
  handleContextMenu: MouseEventHandler<HTMLDivElement>;
  handleKeyDown: KeyboardEventHandler<HTMLDivElement>;
  isEmptyState: boolean;
} {
  const data = useProjectListData("tasks");
  useTasksProjectListEffects(data);
  useTaskAgentRegistration(data.agentsByProject);

  const explorerData = useTaskExplorerData(data, explorerStyles);
  const defaultExpandedIds = useMemo(
    () => buildDefaultExpandedIds(explorerData),
    [explorerData],
  );
  const { expandedIds, setGroupExpanded } =
    useLeftMenuExpandedGroups(defaultExpandedIds);
  const searchActive = data.searchQuery.trim().length > 0;
  const {
    handleChildSelection,
    handleProjectExpand,
  } = useTaskNavigationHandlers(data, setGroupExpanded);
  const entries = useTaskLeftMenuEntries(
    explorerData,
    expandedIds,
    searchActive,
    data.agentInstanceId ?? null,
    handleProjectExpand,
    handleChildSelection,
  );

  const { handleContextMenu, handleKeyDown } = useExplorerMenus(
    data.projectMap,
    data.agentMeta,
    data.actions,
  );

  return {
    actions: data.actions,
    entries,
    handleContextMenu,
    handleKeyDown,
    isEmptyState: !data.loadingProjects && data.projects.length === 0,
  };
}
