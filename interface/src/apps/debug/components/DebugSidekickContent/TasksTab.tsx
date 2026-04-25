import { useParams } from "react-router-dom";
import type { ProjectId } from "../../../../shared/types";
import { EmptyState } from "../../../../components/EmptyState";
import { useDebugRunMetadata } from "../../useDebugRunMetadata";
import styles from "./DebugSidekickContent.module.css";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusClass(status: string | null): string {
  if (!status) return styles.taskStatus;
  if (status === "task_completed") return `${styles.taskStatus} ${styles.taskStatusSuccess}`;
  if (status === "task_failed") return `${styles.taskStatus} ${styles.taskStatusFailed}`;
  return styles.taskStatus;
}

function statusLabel(status: string | null): string {
  if (!status) return "running";
  if (status === "task_completed") return "completed";
  if (status === "task_failed") return "failed";
  return status;
}

export function TasksTab() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();
  const { metadata } = useDebugRunMetadata(projectId, runId);

  if (!metadata) return <EmptyState>No run selected</EmptyState>;
  if (metadata.tasks.length === 0) {
    return <EmptyState>No tasks recorded on this run yet.</EmptyState>;
  }

  return (
    <div className={styles.taskList}>
      {metadata.tasks.map((task) => (
        <div key={task.task_id} className={styles.taskRow}>
          <div className={styles.taskRowHeader}>
            <span className={styles.taskId}>{task.task_id}</span>
            <span className={statusClass(task.status)}>
              {statusLabel(task.status)}
            </span>
          </div>
          <div className={styles.taskMeta}>
            <span>started {formatDate(task.started_at)}</span>
            {task.ended_at ? (
              <span>· ended {formatDate(task.ended_at)}</span>
            ) : null}
          </div>
          {task.spec_id ? (
            <div className={styles.taskSpec}>spec {task.spec_id}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
