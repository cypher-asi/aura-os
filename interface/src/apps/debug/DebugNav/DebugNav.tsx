import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { FolderSection } from "../../../components/FolderSection";
import type {
  DebugProjectSummary,
  DebugRunMetadata,
  DebugRunStatus,
} from "../../../api/debug";
import type { ProjectId } from "../../../types";
import { useDebugProjects } from "../useDebugProjects";
import { useDebugRuns } from "../useDebugRuns";
import styles from "./DebugNav.module.css";

function statusClassName(status: DebugRunStatus): string {
  switch (status) {
    case "running":
      return styles.statusDotRunning;
    case "completed":
      return styles.statusDotCompleted;
    case "failed":
      return styles.statusDotFailed;
    case "interrupted":
      return styles.statusDotInterrupted;
    default:
      return "";
  }
}

function formatRunLabel(run: DebugRunMetadata): string {
  const started = run.started_at ? new Date(run.started_at) : null;
  if (!started || Number.isNaN(started.getTime())) return run.run_id;
  return started.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ProjectSectionProps {
  project: DebugProjectSummary;
  expanded: boolean;
  onToggle: () => void;
  selectedRunId: string | undefined;
  onSelectRun: (projectId: ProjectId, runId: string) => void;
}

/**
 * Lazy child of `DebugNav` that only fetches runs when its folder is
 * expanded. Keeping this boundary tight means a workspace with dozens
 * of projects does not trigger N parallel `listRuns` requests on every
 * nav render.
 */
function DebugProjectSection({
  project,
  expanded,
  onToggle,
  selectedRunId,
  onSelectRun,
}: ProjectSectionProps) {
  const { runs } = useDebugRuns(expanded ? project.project_id : undefined);
  const countSuffix = `${project.run_count}`;
  return (
    <FolderSection
      label={project.project_id}
      expanded={expanded}
      onToggle={onToggle}
      suffix={<span className={styles.rowMeta}>{countSuffix}</span>}
    >
      {runs.map((run) => {
        const isActive = selectedRunId === run.run_id;
        const counters = run.counters;
        const meta = counters.llm_calls
          ? `${counters.llm_calls} llm`
          : counters.events_total
            ? `${counters.events_total} ev`
            : "";
        return (
          <button
            key={run.run_id}
            type="button"
            className={`${styles.row} ${isActive ? styles.rowActive : ""}`}
            onClick={() => onSelectRun(project.project_id, run.run_id)}
            aria-current={isActive ? "page" : undefined}
          >
            <span
              className={`${styles.statusDot} ${statusClassName(run.status)}`}
              aria-hidden="true"
            />
            <span className={styles.rowLabel}>{formatRunLabel(run)}</span>
            {meta ? <span className={styles.rowMeta}>{meta}</span> : null}
          </button>
        );
      })}
    </FolderSection>
  );
}

/**
 * Left menu for the Debug app. Renders one collapsible section per
 * project that has debug runs, with runs as children ordered newest
 * first. Selection is URL-driven via
 * `/debug/:projectId/runs/:runId`, matching the pattern used by the
 * Integrations and Tasks apps so the main panel can re-render cleanly
 * on navigation without a separate selection store.
 */
export function DebugNav() {
  const navigate = useNavigate();
  const { projectId, runId } = useParams<{
    projectId?: string;
    runId?: string;
  }>();
  const { projects, isLoading } = useDebugProjects();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const projectMap = useMemo(() => {
    const map = new Map<string, DebugProjectSummary>();
    for (const project of projects) map.set(project.project_id, project);
    return map;
  }, [projects]);

  const selectedProjectIsKnown =
    projectId !== undefined && projectMap.has(projectId);

  const effectiveExpanded = useMemo(() => {
    if (!selectedProjectIsKnown || !projectId) return expanded;
    if (expanded[projectId]) return expanded;
    return { ...expanded, [projectId]: true };
  }, [expanded, selectedProjectIsKnown, projectId]);

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));
  };

  const onSelectRun = (pid: ProjectId, rid: string) => {
    navigate(`/debug/${pid}/runs/${rid}`);
  };

  return (
    <div className={styles.root}>
      <div ref={scrollRef} className={styles.list}>
        {isLoading && projects.length === 0 ? (
          <div className={styles.emptyState}>Loading runs…</div>
        ) : projects.length === 0 ? (
          <div className={styles.emptyState}>
            No debug runs yet. Start a dev loop and bundles will appear here.
          </div>
        ) : (
          projects.map((project) => (
            <DebugProjectSection
              key={project.project_id}
              project={project}
              expanded={effectiveExpanded[project.project_id] ?? false}
              onToggle={() => toggle(project.project_id)}
              selectedRunId={
                projectId === project.project_id ? runId : undefined
              }
              onSelectRun={onSelectRun}
            />
          ))
        )}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
