import type { ReactNode } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Archive, Gauge, Loader2 } from "lucide-react";
import { Avatar } from "../Avatar";
import { ProjectsPlusButton } from "../ProjectsPlusButton";
import type { useProjectListData } from "./useProjectListData";
import { resolveStatus } from "./project-list-shared";

type ProjectAgentNode = NonNullable<ReturnType<typeof useProjectListData>["agentsByProject"][string]>[number];

export interface ProjectExplorerNodeStyles {
  projectSuffix: string;
  newChatWrap: string;
  agentTrailing: string;
  agentStatusWrap: string;
  agentActionWrap: string;
  agentActionButton: string;
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
  creatingGeneralAgentProjectIds: string[];
  archivingAgentInstanceIds: string[];
  handleQuickAddAgent: (projectId: string) => void;
  handleArchiveAgent: (agent: ProjectAgentNode) => void;
}

export function executionNodeId(projectId: string): string {
  return `execution:${projectId}`;
}

function emptyAgentsNodeId(projectId: string): string {
  return `_empty_${projectId}`;
}

function archivedAgentsNodeId(projectId: string): string {
  return `_archived_${projectId}`;
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
  context: ProjectExplorerBuildContext,
  explorerStyles: ProjectExplorerNodeStyles,
): ReactNode {
  const isCreating = context.creatingGeneralAgentProjectIds.includes(projectId);
  return (
    <span className={explorerStyles.projectSuffix}>
      <span
        onClick={(event) => event.stopPropagation()}
        className={explorerStyles.newChatWrap}
      >
        <ProjectsPlusButton
          onClick={() => context.handleQuickAddAgent(projectId)}
          title="Add Agent"
          disabled={isCreating}
        />
      </span>
    </span>
  );
}

function buildAgentNode(
  agent: ProjectAgentNode,
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
  const statusIndicator = isAutomating ? (
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
  ) : null;
  const canArchive = agent.status !== "archived";
  const isArchiving = context.archivingAgentInstanceIds.includes(agent.agent_instance_id);

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
    suffix: canArchive || statusIndicator ? (
      <span className={explorerStyles.agentTrailing}>
        <span className={explorerStyles.agentStatusWrap}>
          {statusIndicator}
        </span>
        {canArchive ? (
          <span
            className={explorerStyles.agentActionWrap}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              className={explorerStyles.agentActionButton}
              onClick={() => context.handleArchiveAgent(agent)}
              disabled={isArchiving}
              aria-label={`Archive ${agent.name}`}
              title="Archive agent"
            >
              <Archive size={12} />
            </button>
          </span>
        ) : null}
      </span>
    ) : undefined,
    metadata: { type: "agent", projectId },
  };
}

function buildArchivedGroupNode(
  projectId: string,
  archivedAgents: ProjectAgentNode[],
  context: ProjectExplorerBuildContext,
  statusMap: Record<string, string>,
  machineTypesMap: Record<string, string>,
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNode {
  return {
    id: archivedAgentsNodeId(projectId),
    label: "Archived",
    metadata: { type: "agent-group", groupKind: "archived", projectId },
    children: archivedAgents.map((agent) =>
      buildAgentNode(
        agent,
        projectId,
        context,
        statusMap,
        machineTypesMap,
        explorerStyles,
      ),
    ),
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
  const activeAgents = projectAgents.filter((agent) => agent.status !== "archived");
  const archivedAgents = projectAgents.filter((agent) => agent.status === "archived");

  const children: ExplorerNode[] = [
    ...mobileChildren,
    ...activeAgents.map((agent) =>
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

  if (archivedAgents.length > 0) {
    children.push(
      buildArchivedGroupNode(
        projectId,
        archivedAgents,
        context,
        statusMap,
        machineTypesMap,
        explorerStyles,
      ),
    );
  }

  if (children.length === 0) {
    return [
      {
        id: emptyAgentsNodeId(projectId),
        label: "No agents yet",
        icon: <span aria-hidden="true">-</span>,
        disabled: true,
        metadata: { type: "project-empty", projectId },
      },
    ];
  }

  return children;
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
      context,
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
