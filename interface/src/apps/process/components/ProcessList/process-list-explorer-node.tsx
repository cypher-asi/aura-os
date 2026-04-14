import type { ReactNode } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Cpu } from "lucide-react";
import { ProjectsPlusButton } from "../../../../components/ProjectsPlusButton";
import type { ProjectExplorerNodeStyles } from "../../../../components/ProjectList/project-list-explorer-node";
import type { ExplorerNodeWithSuffix } from "../../../../lib/zui-compat";

interface BuildProcessExplorerDataParams {
  processes: {
    enabled: boolean;
    name: string;
    process_id: string;
    project_id?: string | null;
  }[];
  projects: {
    name: string;
    project_id: string;
  }[];
  processesByProject: Record<string, BuildProcessExplorerDataParams["processes"]>;
  explorerStyles: ProjectExplorerNodeStyles;
  onAddProcess: (projectId: string | null) => void;
}

function buildEnabledIndicator(
  enabled: boolean,
  explorerStyles: ProjectExplorerNodeStyles,
): ReactNode {
  return (
    <span className={explorerStyles.sessionIndicator}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          display: "inline-block",
          background: enabled
            ? "var(--color-success)"
            : "var(--color-text-muted)",
        }}
      />
    </span>
  );
}

function buildProcessNode(
  process: BuildProcessExplorerDataParams["processes"][number],
  explorerStyles: ProjectExplorerNodeStyles,
): ExplorerNodeWithSuffix {
  return {
    id: process.process_id,
    label: process.name,
    icon: <Cpu size={16} />,
    suffix: buildEnabledIndicator(process.enabled, explorerStyles),
    metadata: { type: "process", projectId: process.project_id ?? null },
  };
}

function buildProjectProcessNode(
  project: BuildProcessExplorerDataParams["projects"][number],
  params: BuildProcessExplorerDataParams,
): ExplorerNodeWithSuffix {
  return {
    id: project.project_id,
    label: project.name,
    suffix: (
      <span className={params.explorerStyles.projectSuffix}>
        <span
          onClick={(event) => event.stopPropagation()}
          className={params.explorerStyles.newChatWrap}
        >
          <ProjectsPlusButton
            onClick={() => params.onAddProcess(project.project_id)}
            title="Add Process"
          />
        </span>
      </span>
    ),
    metadata: { type: "project" },
    children: (params.processesByProject[project.project_id] ?? []).map((process) =>
      buildProcessNode(process, params.explorerStyles),
    ),
  };
}

export function buildProcessExplorerData(
  params: BuildProcessExplorerDataParams,
): ExplorerNode[] {
  const projectNodes = params.projects.map((project) =>
    buildProjectProcessNode(project, params),
  );
  const orphanNodes = (params.processesByProject.__unassigned__ ?? []).map((process) =>
    buildProcessNode(process, params.explorerStyles),
  );
  return [...projectNodes, ...orphanNodes];
}
