import { Text } from "@cypher-asi/zui";
import { EVENT_LABELS, type LogEntry } from "../../hooks/use-log-stream";
import type { EngineEvent } from "../../types/events";
import { fmtMs } from "../../utils/format";
import styles from "../Preview/Preview.module.css";

function logDetailPairs(event: EngineEvent): [string, string][] {
  const pairs: [string, string][] = [];

  if (event.task_id) pairs.push(["Task ID", event.task_id]);
  if (event.task_title) pairs.push(["Title", event.task_title]);
  if (event.reason) pairs.push(["Reason", event.reason]);
  if (event.attempt != null) pairs.push(["Attempt", String(event.attempt)]);
  if (event.execution_notes) pairs.push(["Notes", event.execution_notes]);
  if (event.project_id) pairs.push(["Project", event.project_id]);
  if (event.agent_instance_id) pairs.push(["Agent", event.agent_instance_id]);
  if (event.old_session_id) pairs.push(["Old Session", event.old_session_id]);
  if (event.new_session_id) pairs.push(["New Session", event.new_session_id]);
  if (event.completed_count != null) pairs.push(["Completed", String(event.completed_count)]);
  if (event.outcome) pairs.push(["Outcome", event.outcome]);
  if (event.stage) pairs.push(["Stage", event.stage]);
  if (event.spec_count != null) pairs.push(["Spec Count", String(event.spec_count)]);
  if (event.files_written != null) pairs.push(["Files Written", String(event.files_written)]);
  if (event.files_deleted != null) pairs.push(["Files Deleted", String(event.files_deleted)]);
  if (event.delta) pairs.push(["Delta", event.delta]);
  if (event.message) pairs.push(["Message", event.message]);
  if (event.spec) pairs.push(["Spec", event.spec.title]);
  if (event.files && event.files.length > 0) {
    pairs.push(["Files", event.files.map((f) => `${f.op}: ${f.path}`).join("\n")]);
  }

  if (event.duration_ms != null) pairs.push(["Duration", fmtMs(event.duration_ms)]);
  if (event.llm_duration_ms != null) pairs.push(["LLM Duration", fmtMs(event.llm_duration_ms)]);
  if (event.build_verify_duration_ms != null) pairs.push(["Build Verify Duration", fmtMs(event.build_verify_duration_ms)]);
  if (event.summary_duration_ms != null) pairs.push(["Summary Duration", fmtMs(event.summary_duration_ms)]);
  if (event.total_duration_ms != null) pairs.push(["Total Duration", fmtMs(event.total_duration_ms)]);
  if (event.input_tokens != null) pairs.push(["Input Tokens", event.input_tokens.toLocaleString()]);
  if (event.output_tokens != null) pairs.push(["Output Tokens", event.output_tokens.toLocaleString()]);
  if (event.prompt_tokens_estimate != null) pairs.push(["Prompt Tokens (est)", event.prompt_tokens_estimate.toLocaleString()]);
  if (event.total_input_tokens != null) pairs.push(["Total Input Tokens", event.total_input_tokens.toLocaleString()]);
  if (event.total_output_tokens != null) pairs.push(["Total Output Tokens", event.total_output_tokens.toLocaleString()]);
  if (event.codebase_snapshot_bytes != null) pairs.push(["Snapshot Size", `${(event.codebase_snapshot_bytes / 1024).toFixed(0)} KB`]);
  if (event.codebase_file_count != null) pairs.push(["File Count", String(event.codebase_file_count)]);
  if (event.files_changed_count != null) pairs.push(["Files Changed", String(event.files_changed_count)]);
  if (event.parse_retries != null && event.parse_retries > 0) pairs.push(["Parse Retries", String(event.parse_retries)]);
  if (event.build_fix_attempts != null && event.build_fix_attempts > 0) pairs.push(["Build Fix Attempts", String(event.build_fix_attempts)]);
  if (event.model) pairs.push(["Model", event.model]);
  if (event.phase) pairs.push(["Phase", event.phase]);
  if (event.error_hash) pairs.push(["Error Hash", event.error_hash]);
  if (event.context_usage_pct != null) pairs.push(["Context Usage", `${event.context_usage_pct.toFixed(0)}%`]);
  if (event.tasks_completed != null) pairs.push(["Tasks Completed", String(event.tasks_completed)]);
  if (event.tasks_failed != null) pairs.push(["Tasks Failed", String(event.tasks_failed)]);
  if (event.tasks_retried != null) pairs.push(["Tasks Retried", String(event.tasks_retried)]);
  if (event.sessions_used != null) pairs.push(["Sessions Used", String(event.sessions_used)]);
  if (event.total_parse_retries != null && event.total_parse_retries > 0) pairs.push(["Total Parse Retries", String(event.total_parse_retries)]);
  if (event.total_build_fix_attempts != null && event.total_build_fix_attempts > 0) pairs.push(["Total Build Fix Attempts", String(event.total_build_fix_attempts)]);
  if (event.duplicate_error_bailouts != null && event.duplicate_error_bailouts > 0) pairs.push(["Duplicate Error Bailouts", String(event.duplicate_error_bailouts)]);
  if (event.phase_timings && event.phase_timings.length > 0) {
    pairs.push(["Phase Timings", event.phase_timings.map((p) => `${p.phase}: ${fmtMs(p.duration_ms)}`).join(", ")]);
  }

  return pairs;
}

export function LogPreview({ entry }: { entry: LogEntry }) {
  const label = EVENT_LABELS[entry.type] ?? "Event";
  const pairs = logDetailPairs(entry.detail);

  return (
    <>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Summary</span>
          <Text size="sm">{entry.summary}</Text>
        </div>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Type</span>
          <Text size="sm">{label}</Text>
        </div>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Timestamp</span>
          <Text size="sm">{entry.timestamp}</Text>
        </div>
        {pairs.map(([key, value]) => (
          <div key={key} className={styles.taskField}>
            <span className={styles.fieldLabel}>{key}</span>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{value}</Text>
          </div>
        ))}
        {pairs.length === 0 && (
          <div className={styles.taskField}>
            <Text variant="muted" size="sm">No additional detail</Text>
          </div>
        )}
      </div>
    </>
  );
}
