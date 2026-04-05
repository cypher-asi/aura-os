import { ChevronRight, ChevronDown } from "lucide-react";
import { StatusBadge } from "../../../components/StatusBadge";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { formatTokens } from "../../../utils/format";
import { formatDuration, type AnnotatedSession } from "./agent-info-utils";
import type { Task } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

export interface SessionCardProps {
  session: AnnotatedSession;
  number: number;
  expanded: boolean;
  tasks: Task[] | undefined;
  isLoadingTasks: boolean;
  summary: string | undefined;
  isSummarizing: boolean;
  onToggle: () => void;
  onClick: () => void;
}

function SessionTaskList({
  tasks,
  isLoading,
}: {
  tasks: Task[] | undefined;
  isLoading: boolean;
}) {
  return (
    <div className={styles.sessionTaskList}>
      {isLoading && (
        <span className={styles.sessionTaskLoading}>Loading tasks...</span>
      )}
      {tasks && tasks.length === 0 && !isLoading && (
        <span className={styles.sessionTaskLoading}>No tasks</span>
      )}
      {tasks?.map((t) => (
        <div key={t.task_id} className={styles.sessionTaskItem}>
          <TaskStatusIcon status={t.status} />
          <span className={styles.sessionTaskTitle}>{t.title}</span>
        </div>
      ))}
    </div>
  );
}

export function SessionCard({
  session,
  number,
  expanded,
  tasks,
  isLoadingTasks,
  summary,
  isSummarizing,
  onToggle,
  onClick,
}: SessionCardProps) {
  const totalTokens =
    session.total_input_tokens + session.total_output_tokens;

  return (
    <div className={styles.sessionCard}>
      <div className={styles.sessionCardHeader}>
        <button type="button" className={styles.sessionExpandBtn} onClick={onToggle}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <StatusBadge status={session.status} />
        <button type="button" className={styles.sessionNumber} onClick={onClick}>
          S{number}
        </button>
        <span className={styles.sessionMeta}>
          <span className={styles.sessionProject}>{session._projectName}</span>
          <span className={styles.sessionDuration}>
            {formatDuration(session.started_at, session.ended_at)}
          </span>
          {totalTokens > 0 && (
            <span className={styles.sessionCost}>{formatTokens(totalTokens)}</span>
          )}
        </span>
      </div>
      {summary && (
        <div
          className={styles.sessionSummary}
          onClick={onClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
        >
          {summary}
        </div>
      )}
      {!summary && session.status !== "active" && isSummarizing && (
        <div className={styles.sessionSummaryPlaceholder}>
          Generating summary...
        </div>
      )}
      {expanded && <SessionTaskList tasks={tasks} isLoading={isLoadingTasks} />}
    </div>
  );
}
