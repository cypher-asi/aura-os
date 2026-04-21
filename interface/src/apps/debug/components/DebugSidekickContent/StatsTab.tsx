import { useParams } from "react-router-dom";
import type { ProjectId } from "../../../../types";
import { EmptyState } from "../../../../components/EmptyState";
import { useDebugRunMetadata } from "../../useDebugRunMetadata";
import previewStyles from "../../../../components/Preview/Preview.module.css";
import styles from "./DebugSidekickContent.module.css";

export function StatsTab() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();
  const { metadata } = useDebugRunMetadata(projectId, runId);

  if (!metadata) return <EmptyState>No stats available</EmptyState>;
  const c = metadata.counters;
  const totalTasks = c.task_completed + c.task_failed;
  const successRate = totalTasks > 0
    ? Math.round((c.task_completed / totalTasks) * 100)
    : null;
  const avgTokensPerCall = c.llm_calls > 0
    ? Math.round((c.input_tokens + c.output_tokens) / c.llm_calls)
    : null;

  return (
    <div className={previewStyles.previewBody}>
      <div className={previewStyles.taskMeta}>
        <StatRow label="Total events" value={c.events_total} />
        <StatRow label="LLM calls" value={c.llm_calls} />
        <StatRow label="Tool calls" value={c.tool_calls} />
        <StatRow label="Iterations" value={c.iterations} />
        <StatRow label="Blockers" value={c.blockers} />
        <StatRow label="Retries" value={c.retries} />
        <StatRow
          label="Tokens in / out"
          value={`${c.input_tokens.toLocaleString()} / ${c.output_tokens.toLocaleString()}`}
        />
        <StatRow
          label="Avg tokens / call"
          value={avgTokensPerCall ?? "—"}
        />
        <StatRow
          label="Tasks"
          value={`${c.task_completed} of ${totalTasks}`}
        />
        <StatRow
          label="Success rate"
          value={successRate !== null ? `${successRate}%` : "—"}
        />
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className={previewStyles.taskField}>
      <span className={previewStyles.fieldLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}
