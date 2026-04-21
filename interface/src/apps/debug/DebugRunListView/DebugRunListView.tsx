import { useMemo } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { DebugRunMetadata, DebugRunStatus } from "../../../api/debug";
import type { ProjectId } from "../../../types";
import { useDebugRuns } from "../useDebugRuns";
import styles from "./DebugRunListView.module.css";

function badgeClass(status: DebugRunStatus): string {
  switch (status) {
    case "running":
      return `${styles.badge} ${styles.badgeRunning}`;
    case "completed":
      return `${styles.badge} ${styles.badgeCompleted}`;
    case "failed":
      return `${styles.badge} ${styles.badgeFailed}`;
    case "interrupted":
      return `${styles.badge} ${styles.badgeInterrupted}`;
    default:
      return styles.badge;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(run: DebugRunMetadata): string {
  const startedAt = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const endedAt = run.ended_at
    ? new Date(run.ended_at).getTime()
    : Date.now();
  if (Number.isNaN(startedAt)) return "—";
  const ms = Math.max(0, endedAt - startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function shortSpec(specId: string): string {
  return specId.length > 12 ? `${specId.slice(0, 12)}…` : specId;
}

export function DebugRunListView() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: ProjectId }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const specFilter = searchParams.get("spec") ?? undefined;
  const { runs, isLoading, error } = useDebugRuns(projectId, specFilter);

  // Defensive client-side filter: the server already filters when
  // `specFilter` is set, but if a stale cache was populated without
  // a filter we still guarantee only matching runs render.
  const visibleRuns = useMemo(() => {
    if (!specFilter) return runs;
    return runs.filter((run) => run.spec_ids?.includes(specFilter));
  }, [runs, specFilter]);

  const clearSpecFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("spec");
    setSearchParams(next, { replace: true });
  };

  if (!projectId) {
    return <div className={styles.empty}>No project selected.</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{projectId}</h2>
          <div className={styles.subtitle}>
            {visibleRuns.length} run{visibleRuns.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      {specFilter ? (
        <div className={styles.filterBar}>
          <span className={styles.filterChip}>
            <span className={styles.filterChipLabel}>
              Filtered by spec: {shortSpec(specFilter)}
            </span>
            <button
              type="button"
              className={styles.filterChipClear}
              onClick={clearSpecFilter}
              aria-label="Clear spec filter"
            >
              × clear
            </button>
          </span>
        </div>
      ) : null}
      {isLoading && visibleRuns.length === 0 ? (
        <div className={styles.empty}>Loading runs…</div>
      ) : error ? (
        <div className={styles.empty}>
          Failed to load runs: {String((error as Error).message ?? error)}
        </div>
      ) : visibleRuns.length === 0 ? (
        <div className={styles.empty}>
          {specFilter
            ? "No runs match this spec."
            : "No runs recorded for this project."}
        </div>
      ) : (
        <div className={styles.grid}>
          {visibleRuns.map((run) => (
            <button
              key={run.run_id}
              type="button"
              className={styles.card}
              onClick={() =>
                navigate(`/debug/${projectId}/runs/${run.run_id}`)
              }
            >
              <span className={badgeClass(run.status)}>{run.status}</span>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>
                  {formatDate(run.started_at)}
                </div>
                <div className={styles.cardMeta}>
                  <span>{formatDuration(run)}</span>
                  <span>{run.counters.llm_calls} llm calls</span>
                  <span>{run.counters.iterations} iter</span>
                  <span>{run.counters.blockers} blockers</span>
                  <span>{run.counters.retries} retries</span>
                </div>
              </div>
              <span className={styles.cardMeta}>
                <span>{run.run_id.slice(0, 8)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
