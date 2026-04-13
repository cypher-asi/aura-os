import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Badge, Text } from "@cypher-asi/zui";
import { Clock3, Cpu } from "lucide-react";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProcessStore } from "../../apps/process/stores/process-store";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import styles from "./ProjectProcessView.module.css";

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not scheduled yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRunStatus(status: string) {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  return status.replace(/_/g, " ");
}

export function ProjectProcessView() {
  const ctx = useProjectActions();
  const { isMobileLayout } = useAuraCapabilities();
  const projectId = ctx?.project.project_id;
  const processes = useProcessStore((s) => s.processes);
  const runs = useProcessStore((s) => s.runs);
  const loading = useProcessStore((s) => s.loading);
  const fetchProcesses = useProcessStore((s) => s.fetchProcesses);
  const fetchRuns = useProcessStore((s) => s.fetchRuns);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);

  const projectProcesses = useMemo(
    () => (projectId ? processes.filter((process) => process.project_id === projectId) : []),
    [processes, projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    void fetchProcesses().catch(() => {});
  }, [fetchProcesses, projectId]);

  useEffect(() => {
    if (projectProcesses.length === 0) {
      setSelectedProcessId(null);
      return;
    }
    if (!selectedProcessId || !projectProcesses.some((process) => process.process_id === selectedProcessId)) {
      setSelectedProcessId(projectProcesses[0]?.process_id ?? null);
    }
  }, [projectProcesses, selectedProcessId]);

  useEffect(() => {
    if (!selectedProcessId) return;
    void fetchRuns(selectedProcessId).catch(() => {});
  }, [fetchRuns, selectedProcessId]);

  if (!projectId) {
    return null;
  }

  if (!isMobileLayout) {
    return <Navigate to="/process" replace />;
  }

  const enabledCount = projectProcesses.filter((process) => process.enabled).length;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.sectionLabel}>Processes</div>
        <Text size="lg" weight="medium">Project automations</Text>
        <Text size="sm" variant="muted">
          Monitor what is scheduled, what is paused, and what ran most recently.
        </Text>
        <div className={styles.headerMeta}>
          <Badge variant="stopped">{projectProcesses.length} total</Badge>
          <Badge variant={enabledCount > 0 ? "running" : "stopped"}>{enabledCount} enabled</Badge>
        </div>
      </header>

      {loading && projectProcesses.length === 0 ? (
        <div className={styles.emptyState}>
          <Text size="sm" weight="medium">Loading process monitors…</Text>
        </div>
      ) : projectProcesses.length === 0 ? (
        <div className={styles.emptyState}>
          <Text size="sm" weight="medium">No processes attached to this project</Text>
          <Text size="sm" variant="muted">Use the desktop app when you need to author or wire new processes.</Text>
        </div>
      ) : (
        <>
          <section className={styles.processList}>
            {projectProcesses.map((process) => {
              const processRuns = runs[process.process_id] ?? [];
              const latestRun = processRuns[0] ?? null;
              const selected = process.process_id === selectedProcessId;
              return (
                <button
                  key={process.process_id}
                  type="button"
                  className={`${styles.processCard} ${selected ? styles.processCardActive : ""}`}
                  aria-pressed={selected}
                  onClick={() => setSelectedProcessId(process.process_id)}
                >
                  <span className={styles.processCardTop}>
                    <span className={styles.processCardTitle}>{process.name}</span>
                    <Badge variant={process.enabled ? "running" : "stopped"}>
                      {process.enabled ? "Enabled" : "Paused"}
                    </Badge>
                  </span>
                  <span className={styles.processCardMeta}>
                    <span>
                      <Clock3 size={12} />
                      {formatTimestamp(process.next_run_at)}
                    </span>
                    {latestRun ? (
                      <span>
                        <TaskStatusIcon status={latestRun.status} />
                        {formatRunStatus(latestRun.status)}
                      </span>
                    ) : (
                      <span>
                        <Cpu size={12} />
                        No runs yet
                      </span>
                    )}
                  </span>

                  {selected ? (
                    <span className={styles.processCardDetail}>
                      <span className={styles.processCardDescription}>
                        {process.description?.trim() || "This process has no description yet."}
                      </span>

                      <span className={styles.detailMeta}>
                        <span className={styles.detailMetaRow}>
                          <span className={styles.detailMetaLabel}>Schedule</span>
                          <span className={styles.detailMetaValue}>{process.schedule ?? "Manual trigger only"}</span>
                        </span>
                      </span>

                      <span className={styles.runSection}>
                        <Text size="xs" variant="muted" weight="medium">Recent runs</Text>
                        {processRuns.length === 0 ? (
                          <Text size="sm" variant="muted">No run history yet for this process.</Text>
                        ) : (
                          <span className={styles.runList}>
                            {processRuns.slice(0, 5).map((run) => (
                              <span key={run.run_id} className={styles.runRow}>
                                <span className={styles.runStatus}>
                                  <TaskStatusIcon status={run.status} />
                                  <span>{formatRunStatus(run.status)}</span>
                                </span>
                                <span className={styles.runMeta}>{formatTimestamp(run.started_at)}</span>
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
