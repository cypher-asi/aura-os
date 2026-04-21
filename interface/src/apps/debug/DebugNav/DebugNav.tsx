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

/** Synthetic spec key used when a run has no associated `spec_ids`. */
const NO_SPEC_KEY = "__no_spec__";

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

/**
 * Primary spec bucket for a run. We group by the *first* entry in
 * `spec_ids` so each run lands in exactly one bucket even when a run
 * touches multiple specs. Runs with no spec go into the synthetic
 * `NO_SPEC_KEY` bucket so they remain visible in the tree.
 */
function primarySpecKey(run: DebugRunMetadata): string {
  const first = run.spec_ids?.[0];
  return first && first.length > 0 ? first : NO_SPEC_KEY;
}

function shortSpecLabel(specKey: string): string {
  if (specKey === NO_SPEC_KEY) return "(no spec)";
  return specKey.length > 8 ? `${specKey.slice(0, 8)}…` : specKey;
}

interface SpecGroup {
  specKey: string;
  runs: DebugRunMetadata[];
}

/** Group a project's runs by their primary spec id, preserving the
 *  server's newest-first order within each bucket. */
function groupRunsBySpec(runs: DebugRunMetadata[]): SpecGroup[] {
  const groups = new Map<string, DebugRunMetadata[]>();
  for (const run of runs) {
    const key = primarySpecKey(run);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(run);
    } else {
      groups.set(key, [run]);
    }
  }
  return Array.from(groups.entries()).map(([specKey, bucketRuns]) => ({
    specKey,
    runs: bucketRuns,
  }));
}

interface SpecSectionProps {
  projectId: ProjectId;
  group: SpecGroup;
  expanded: boolean;
  onToggle: () => void;
  selectedRunId: string | undefined;
  onSelectRun: (projectId: ProjectId, runId: string) => void;
  onSelectSpec: (projectId: ProjectId, specKey: string) => void;
}

function DebugSpecSection({
  projectId,
  group,
  expanded,
  onToggle,
  selectedRunId,
  onSelectRun,
  onSelectSpec,
}: SpecSectionProps) {
  const label = shortSpecLabel(group.specKey);
  const suffix = (
    <button
      type="button"
      className={styles.specFilterButton}
      onClick={(event) => {
        event.stopPropagation();
        onSelectSpec(projectId, group.specKey);
      }}
      aria-label={`Show runs for spec ${label}`}
      title="Open spec in the list view"
    >
      <span className={styles.rowMeta}>{group.runs.length}</span>
    </button>
  );
  return (
    <FolderSection
      label={label}
      expanded={expanded}
      onToggle={onToggle}
      depth={1}
      suffix={suffix}
    >
      {group.runs.map((run) => {
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
            className={`${styles.row} ${styles.rowNested} ${isActive ? styles.rowActive : ""}`}
            onClick={() => onSelectRun(projectId, run.run_id)}
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

interface ProjectSectionProps {
  project: DebugProjectSummary;
  expanded: boolean;
  onToggle: () => void;
  selectedRunId: string | undefined;
  onSelectRun: (projectId: ProjectId, runId: string) => void;
  onSelectSpec: (projectId: ProjectId, specKey: string) => void;
  specExpanded: Record<string, boolean>;
  onToggleSpec: (projectId: ProjectId, specKey: string) => void;
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
  onSelectSpec,
  specExpanded,
  onToggleSpec,
}: ProjectSectionProps) {
  const { runs } = useDebugRuns(expanded ? project.project_id : undefined);
  const groups = useMemo(() => groupRunsBySpec(runs), [runs]);
  const countSuffix = `${project.run_count}`;
  return (
    <FolderSection
      label={project.project_id}
      expanded={expanded}
      onToggle={onToggle}
      suffix={<span className={styles.rowMeta}>{countSuffix}</span>}
    >
      {groups.map((group) => {
        const key = `${project.project_id}::${group.specKey}`;
        return (
          <DebugSpecSection
            key={key}
            projectId={project.project_id}
            group={group}
            expanded={specExpanded[key] ?? false}
            onToggle={() => onToggleSpec(project.project_id, group.specKey)}
            selectedRunId={selectedRunId}
            onSelectRun={onSelectRun}
            onSelectSpec={onSelectSpec}
          />
        );
      })}
    </FolderSection>
  );
}

/**
 * Left menu for the Debug app. Renders one collapsible section per
 * project that has debug runs; each project expands into one folder
 * per distinct spec id, and each spec folder lists the runs ordered
 * newest first. Selection is URL-driven via
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
  const [specExpanded, setSpecExpanded] = useState<Record<string, boolean>>({});

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

  const toggleSpec = (pid: ProjectId, specKey: string) => {
    const key = `${pid}::${specKey}`;
    setSpecExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  const onSelectRun = (pid: ProjectId, rid: string) => {
    navigate(`/debug/${pid}/runs/${rid}`);
  };

  const onSelectSpec = (pid: ProjectId, specKey: string) => {
    if (specKey === NO_SPEC_KEY) {
      navigate(`/debug/${pid}`);
      return;
    }
    navigate(`/debug/${pid}?spec=${encodeURIComponent(specKey)}`);
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
              onSelectSpec={onSelectSpec}
              specExpanded={specExpanded}
              onToggleSpec={toggleSpec}
            />
          ))
        )}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
