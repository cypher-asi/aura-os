import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Avatar } from "../../../../components/Avatar";
import { ProjectsPlusButton } from "../../../../components/ProjectsPlusButton";
import type { ProjectExplorerNodeStyles } from "../../../../components/ProjectList/project-list-explorer-node";
import type { useProjectListData } from "../../../../components/ProjectList/useProjectListData";
import {
  isUserFacingAgentInstance,
  resolveStatus,
} from "../../../../components/ProjectList/project-list-shared";
import type { ExplorerNodeWithSuffix } from "../../../../lib/zui-compat";
import { agentDisplayName } from "../../../../lib/derive-project-agent-title";

function buildTaskProjectSuffix(
  projectId: string,
  handleAddAgent: (projectId: string) => void,
  explorerStyles: ProjectExplorerNodeStyles,
): ReactNode {
  return (
    <span className={explorerStyles.projectSuffix}>
      <span
        onClick={(event) => event.stopPropagation()}
        className={explorerStyles.newChatWrap}
      >
        <ProjectsPlusButton
          onClick={() => handleAddAgent(projectId)}
          title="Add Agent"
        />
      </span>
    </span>
  );
}

function buildTaskAgentNode(
  agent: NonNullable<ReturnType<typeof useProjectListData>["agentsByProject"][string]>[number],
  projectId: string,
  data: ReturnType<typeof useProjectListData>,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNodeWithSuffix {
  const isAutomating =
    data.automatingProjectId === projectId &&
    data.automatingAgentInstanceId === agent.agent_instance_id;
  const rawStatus =
    statusMap[agent.agent_instance_id] ??
    statusMap[agent.agent_id] ??
    agent.status;
  const machineType =
    machineTypesMap[agent.agent_instance_id] ??
    machineTypesMap[agent.agent_id];
  const isLocal = !machineType || machineType === "local";
  const resolvedStatus = resolveStatus(rawStatus) ?? (isLocal ? "idle" : undefined);
  const displayName = agentDisplayName(agent.name);

  return {
    id: agent.agent_instance_id,
    label: displayName,
    icon: (
      <Avatar
        avatarUrl={agent.icon ?? undefined}
        name={displayName}
        type="agent"
        size={18}
        status={resolvedStatus}
        isLocal={isLocal}
      />
    ),
    suffix: isAutomating ? (
      <span className={explorerStyles.sessionIndicator}>
        <Loader2
          size={10}
          className={explorerStyles.automationSpinner}
        />
      </span>
    ) : data.sidekick.streamingAgentInstanceIds.includes(agent.agent_instance_id) ? (
      <span className={explorerStyles.sessionIndicator}>
        <span className={explorerStyles.streamingDot} />
      </span>
    ) : undefined,
    metadata: { type: "agent", projectId },
  };
}

export function buildTasksExplorerNode(
  project: { project_id: string; name: string },
  data: ReturnType<typeof useProjectListData>,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
  getAgentOrder: (projectId: string) => string[] = () => [],
  onTasksAgentReorder?: (projectId: string, orderedAgentIds: string[]) => void,
): ExplorerNodeWithSuffix {
  const projectAgents = data.agentsByProject[project.project_id];
  const orderIds = getAgentOrder(project.project_id);

  // Mirror the Projects-app sidebar: hide infrastructure-role rows
  // (`Loop`, `Executor`) so each `run-once` task click does not stack
  // another duplicate "Run task" Executor in the Tasks-app sidebar.
  let children;
  if (projectAgents === undefined) {
    children = [{ id: `_load_${project.project_id}`, label: "Loading...", disabled: true }];
  } else {
    const userFacing = projectAgents.filter(isUserFacingAgentInstance);
    const sorted = orderIds.length > 0
      ? [...userFacing].sort((a, b) => {
          const aIdx = orderIds.indexOf(a.agent_id);
          const bIdx = orderIds.indexOf(b.agent_id);
          return (aIdx === -1 ? Infinity : aIdx) - (bIdx === -1 ? Infinity : bIdx);
        })
      : userFacing;
    children = sorted.map((agent) =>
      buildTaskAgentNode(agent, project.project_id, data, statusMap, machineTypesMap, explorerStyles),
    );
  }

  const instanceToAgentId = new Map(
    (data.agentsByProject[project.project_id] ?? []).map((a) => [a.agent_instance_id, a.agent_id]),
  );
  const onChildReorder = onTasksAgentReorder
    ? (orderedInstanceIds: string[]) => {
        const orderedAgentIds = orderedInstanceIds
          .map((id) => instanceToAgentId.get(id))
          .filter((id): id is string => Boolean(id));
        onTasksAgentReorder(project.project_id, orderedAgentIds);
      }
    : undefined;

  return {
    id: project.project_id,
    label: project.name,
    suffix: buildTaskProjectSuffix(
      project.project_id,
      data.actions.handleAddAgent,
      explorerStyles,
    ),
    metadata: { type: "project", childDraggable: Boolean(onChildReorder), onChildReorder },
    children,
  };
}
