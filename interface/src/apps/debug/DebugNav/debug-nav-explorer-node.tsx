import type { ReactNode } from "react";
import { Bug, Circle } from "lucide-react";
import type {
  DebugRunMetadata,
  DebugRunStatus,
} from "../../../api/debug";
import type { ExplorerNodeWithSuffix } from "../../../lib/zui-compat";

interface Project {
  project_id: string;
  name: string;
}

interface BuildDebugExplorerDataParams {
  projects: Project[];
  /** Runs for projects whose group has been expanded in the nav. */
  runsByProject: Record<string, DebugRunMetadata[]>;
  /** Project ids we have already fetched runs for (possibly empty). */
  loadedProjectIds: ReadonlySet<string>;
}

function statusColor(status: DebugRunStatus): string {
  switch (status) {
    case "running":
      return "#3b82f6";
    case "completed":
      return "var(--color-success, #4aeaa8)";
    case "failed":
      return "var(--color-error, #ef4444)";
    case "interrupted":
      return "var(--color-warning, #f59e0b)";
    default:
      return "var(--color-text-muted)";
  }
}

function buildRunSuffix(run: DebugRunMetadata): ReactNode {
  const counters = run.counters;
  const label = counters.llm_calls
    ? `${counters.llm_calls} llm`
    : counters.events_total
      ? `${counters.events_total} ev`
      : "";
  return label ? (
    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{label}</span>
  ) : null;
}

function runLabel(run: DebugRunMetadata): string {
  const started = run.started_at ? new Date(run.started_at) : null;
  if (started && !Number.isNaN(started.getTime())) {
    return started.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return run.run_id.slice(0, 8);
}

function buildRunNode(
  run: DebugRunMetadata,
  projectId: string,
): ExplorerNodeWithSuffix {
  return {
    id: `${projectId}::${run.run_id}`,
    label: runLabel(run),
    icon: (
      <Circle
        size={8}
        strokeWidth={0}
        fill={statusColor(run.status)}
        aria-hidden
      />
    ),
    suffix: buildRunSuffix(run),
    metadata: { type: "run", runId: run.run_id, projectId },
  };
}

function buildProjectNode(
  project: Project,
  params: BuildDebugExplorerDataParams,
): ExplorerNodeWithSuffix {
  const runs = params.runsByProject[project.project_id] ?? [];
  const loaded = params.loadedProjectIds.has(project.project_id);
  const children: ExplorerNodeWithSuffix[] = loaded
    ? runs.length > 0
      ? runs.map((run) => buildRunNode(run, project.project_id))
      : [
          {
            id: `${project.project_id}::__empty__`,
            label: "No runs yet",
            metadata: { type: "empty" },
          },
        ]
    : [
        {
          id: `${project.project_id}::__loading__`,
          label: "Loading…",
          metadata: { type: "empty" },
        },
      ];
  return {
    id: project.project_id,
    label: project.name || project.project_id,
    icon: <Bug size={14} />,
    suffix: loaded && runs.length > 0 ? (
      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
        {runs.length}
      </span>
    ) : null,
    metadata: { type: "project" },
    children,
  };
}

export function buildDebugExplorerData(
  params: BuildDebugExplorerDataParams,
): ExplorerNodeWithSuffix[] {
  return params.projects.map((project) => buildProjectNode(project, params));
}
