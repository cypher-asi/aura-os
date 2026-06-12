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
import { buildProjectRowAppearance } from "../../../../features/project-row-appearance";
import type { ProjectAppearance } from "../../../../shared/api/appearance";
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
  appearance?: ProjectAppearance,
): ExplorerNodeWithSuffix {
  const projectAgents = data.agentsByProject[project.project_id];
  // Mirror the Projects-app sidebar: hide infrastructure-role rows
  // (`Loop`, `Executor`) so each `run-once` task click does not stack
  // another duplicate "Run task" Executor in the Tasks-app sidebar.
  const children =
    projectAgents !== undefined
      ? projectAgents
          .filter(isUserFacingAgentInstance)
          .map((agent) =>
            buildTaskAgentNode(
              agent,
              project.project_id,
              data,
              statusMap,
              machineTypesMap,
              explorerStyles,
            ),
          )
      : [{ id: `_load_${project.project_id}`, label: "Loading...", disabled: true }];

  return {
    id: project.project_id,
    label: project.name,
    // Appearance-derived fields shared with every project-list
    // surface so the styling stays consistent across apps.
    ...buildProjectRowAppearance(project.project_id, appearance),
    suffix: buildTaskProjectSuffix(
      project.project_id,
      data.actions.handleAddAgent,
      explorerStyles,
    ),
    metadata: { type: "project" },
    children,
  };
}
