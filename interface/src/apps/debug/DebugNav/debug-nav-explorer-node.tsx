import type { ReactNode } from "react";
import { Bug, Circle, Activity } from "lucide-react";
import type {
  DebugRunMetadata,
  DebugRunStatus,
} from "../../../shared/api/debug";
import type { ExplorerNodeWithSuffix } from "../../../lib/zui-compat";
import styles from "./DebugNav.module.css";

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

export const RUNNING_NOW_GROUP_ID = "__running_now__";

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
  return label ? <span className={styles.navSuffix}>{label}</span> : null;
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
    suffix:
      loaded && runs.length > 0 ? (
        <span className={styles.navSuffix}>{runs.length}</span>
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

export interface RunningRunItem {
  projectId: string;
  projectName: string;
  run: DebugRunMetadata;
}

/**
 * Build a "Running now" section header that groups every in-progress
 * run across the workspace. Labels scope the project name into the
 * row itself (instead of the usual date) so users can tell which
 * project the run belongs to without expanding its group.
 *
 * Returns `null` when there are no running runs — callers use this to
 * omit the section header entirely rather than render an empty group.
 */
export function buildRunningNowSection(
  runs: readonly RunningRunItem[],
): ExplorerNodeWithSuffix | null {
  if (runs.length === 0) return null;
  const children: ExplorerNodeWithSuffix[] = runs.map(
    ({ projectId, projectName, run }) => ({
      // Prefix the id so it doesn't collide with the same run rendered
      // inside its normal project group (react-keyed entries require
      // unique ids across the flat entry list).
      id: `__running__::${projectId}::${run.run_id}`,
      label: `${projectName} · ${runLabel(run)}`,
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
    }),
  );
  return {
    id: RUNNING_NOW_GROUP_ID,
    label: `Running now (${runs.length})`,
    icon: <Activity size={14} />,
    // `variant: "section"` renders the header with the uppercase
    // section styling used by other apps (Agents, etc.) for grouped
    // lists.
    metadata: { variant: "section", type: "running-now" },
    children,
  };
}
