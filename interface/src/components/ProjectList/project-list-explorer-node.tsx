import type { ReactNode } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Gauge, Loader2 } from "lucide-react";
import { Avatar } from "../Avatar";
import { ProjectsPlusButton } from "../ProjectsPlusButton";
import type { useProjectListData } from "./useProjectListData";
import { resolveStatus } from "./project-list-shared";

export interface ProjectExplorerNodeStyles {
  projectSuffix: string;
  newChatWrap: string;
  sessionIndicator: string;
  automationSpinner: string;
  streamingDot: string;
}

interface ProjectExplorerBuildContext {
  agentsByProject: ReturnType<typeof useProjectListData>["agentsByProject"];
  automatingProjectId: string | null;
  automatingAgentInstanceId: string | null;
  isMobileLayout: boolean;
  streamingAgentInstanceId: string | null;
  handleAddAgent: (projectId: string) => void;
}

export function executionNodeId(projectId: string): string {
  return `execution:${projectId}`;
}

function emptyAgentsNodeId(projectId: string): string {
  return `_empty_${projectId}`;
}

function buildExecutionNode(projectId: string): ExplorerNode {
  return {
    id: executionNodeId(projectId),
    label: "Execution",
    icon: <Gauge size={16} />,
    metadata: { type: "execution", projectId },
  };
}

function buildProjectSuffix(
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

function buildAgentNode(
  agent: NonNullable<ProjectExplorerBuildContext["agentsByProject"][string]>[number],
  projectId: string,
  context: ProjectExplorerBuildContext,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNode {
  const isAutomating =
    context.automatingProjectId === projectId &&
    context.automatingAgentInstanceId === agent.agent_instance_id;
  const rawStatus =
    statusMap[agent.agent_instance_id] ??
    statusMap[agent.agent_id] ??
    agent.status;
  const machineType =
    machineTypesMap[agent.agent_instance_id] ??
    machineTypesMap[agent.agent_id];
  const isLocal = !machineType || machineType === "local";
  const resolvedStatus = resolveStatus(rawStatus) ?? (isLocal ? "idle" : undefined);

  return {
    id: agent.agent_instance_id,
    label: agent.name,
    icon: (
      <Avatar
        avatarUrl={agent.icon ?? undefined}
        name={agent.name}
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
    ) : context.streamingAgentInstanceId === agent.agent_instance_id ? (
      <span className={explorerStyles.sessionIndicator}>
        <span className={explorerStyles.streamingDot} />
      </span>
    ) : undefined,
    metadata: { type: "agent", projectId },
  };
}

function buildProjectChildren(
  projectId: string,
  context: ProjectExplorerBuildContext,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNode[] {
  const projectAgents = context.agentsByProject[projectId];
  if (projectAgents === undefined) {
    return [{ id: `_load_${projectId}`, label: "Loading...", disabled: true }];
  }

  const mobileChildren = context.isMobileLayout ? [buildExecutionNode(projectId)] : [];
  if (projectAgents.length === 0) {
    return [
      ...mobileChildren,
      {
        id: emptyAgentsNodeId(projectId),
        label: "No agents yet",
        icon: <span aria-hidden="true">-</span>,
        disabled: true,
        metadata: { type: "project-empty", projectId },
      },
    ];
  }

  return [
    ...mobileChildren,
    ...projectAgents.map((agent) =>
      buildAgentNode(
        agent,
        projectId,
        context,
        statusMap,
        machineTypesMap,
        explorerStyles,
      ),
    ),
  ];
}

export function buildProjectExplorerNode(
  project: { project_id: string; name: string },
  context: ProjectExplorerBuildContext,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNode {
  return {
    id: project.project_id,
    label: project.name,
    suffix: buildProjectSuffix(
      project.project_id,
      context.handleAddAgent,
      explorerStyles,
    ),
    metadata: { type: "project" },
    children: buildProjectChildren(
      project.project_id,
      context,
      statusMap,
      machineTypesMap,
      explorerStyles,
    ),
  };
}
