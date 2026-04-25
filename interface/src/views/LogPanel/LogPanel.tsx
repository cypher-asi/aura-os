import { useState } from "react";
import { Panel, Heading, Text } from "@cypher-asi/zui";
import { useLogStream, EVENT_LABELS } from "../../hooks/use-log-stream";
import type { LogEntry } from "../../hooks/use-log-stream";
import type { AuraEvent } from "../../shared/types/aura-events";
import styles from "./LogPanel.module.css";

const TYPE_CATEGORY: Record<string, string> = {
  Loop: "loop",
  Task: "task",
  Output: "output",
  Files: "files",
  Session: "session",
  Log: "log",
  Spec: "spec",
};

function categoryClass(label: string): string {
  const cat = TYPE_CATEGORY[label] ?? "log";
  return styles[`logBadge_${cat}`] ?? styles.logBadge;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function DetailView({ event }: { event: AuraEvent }) {
  const pairs: [string, string][] = [];
  const c = event.content as Record<string, unknown>;

  if (c.task_id) pairs.push(["Task ID", String(c.task_id)]);
  if (c.task_title) pairs.push(["Title", String(c.task_title)]);
  if (c.reason) pairs.push(["Reason", String(c.reason)]);
  if (c.attempt != null) pairs.push(["Attempt", String(c.attempt)]);
  if (c.execution_notes) pairs.push(["Notes", String(c.execution_notes)]);
  if (event.project_id) pairs.push(["Project", event.project_id]);
  if (event.agent_id) pairs.push(["Agent", event.agent_id]);
  if (c.old_session_id) pairs.push(["Old Session", String(c.old_session_id)]);
  if (c.new_session_id) pairs.push(["New Session", String(c.new_session_id)]);
  if (c.completed_count != null) pairs.push(["Completed", String(c.completed_count)]);
  if (c.outcome) pairs.push(["Outcome", String(c.outcome)]);
  if (c.stage) pairs.push(["Stage", String(c.stage)]);
  if (c.spec_count != null) pairs.push(["Spec Count", String(c.spec_count)]);
  if (c.files_written != null) pairs.push(["Files Written", String(c.files_written)]);
  if (c.files_deleted != null) pairs.push(["Files Deleted", String(c.files_deleted)]);
  if (c.delta) pairs.push(["Delta", String(c.delta)]);
  if (c.message) pairs.push(["Message", String(c.message)]);
  if (c.spec && typeof c.spec === "object" && "title" in (c.spec as Record<string, unknown>)) {
    pairs.push(["Spec", String((c.spec as Record<string, unknown>).title)]);
  }
  if (Array.isArray(c.files) && c.files.length > 0) {
    pairs.push(["Files", (c.files as { op: string; path: string }[]).map((f) => `${f.op}: ${f.path}`).join("\n")]);
  }

  if (c.duration_ms != null) pairs.push(["Duration", fmtMs(c.duration_ms as number)]);
  if (c.llm_duration_ms != null) pairs.push(["LLM Duration", fmtMs(c.llm_duration_ms as number)]);
  if (c.build_verify_duration_ms != null) pairs.push(["Build Verify Duration", fmtMs(c.build_verify_duration_ms as number)]);
  if (c.summary_duration_ms != null) pairs.push(["Summary Duration", fmtMs(c.summary_duration_ms as number)]);
  if (c.total_duration_ms != null) pairs.push(["Total Duration", fmtMs(c.total_duration_ms as number)]);
  if (c.input_tokens != null) pairs.push(["Input Tokens", (c.input_tokens as number).toLocaleString()]);
  if (c.output_tokens != null) pairs.push(["Output Tokens", (c.output_tokens as number).toLocaleString()]);
  if (c.prompt_tokens_estimate != null) pairs.push(["Prompt Tokens (est)", (c.prompt_tokens_estimate as number).toLocaleString()]);
  if (c.total_input_tokens != null) pairs.push(["Total Input Tokens", (c.total_input_tokens as number).toLocaleString()]);
  if (c.total_output_tokens != null) pairs.push(["Total Output Tokens", (c.total_output_tokens as number).toLocaleString()]);
  if (c.codebase_snapshot_bytes != null) pairs.push(["Snapshot Size", `${((c.codebase_snapshot_bytes as number) / 1024).toFixed(0)} KB`]);
  if (c.codebase_file_count != null) pairs.push(["File Count", String(c.codebase_file_count)]);
  if (c.files_changed_count != null) pairs.push(["Files Changed", String(c.files_changed_count)]);
  if (c.parse_retries != null && (c.parse_retries as number) > 0) pairs.push(["Parse Retries", String(c.parse_retries)]);
  if (c.build_fix_attempts != null && (c.build_fix_attempts as number) > 0) pairs.push(["Build Fix Attempts", String(c.build_fix_attempts)]);
  if (c.model) pairs.push(["Model", String(c.model)]);
  if (c.phase) pairs.push(["Phase", String(c.phase)]);
  if (c.error_hash) pairs.push(["Error Hash", String(c.error_hash)]);
  if (c.context_usage_pct != null) pairs.push(["Context Usage", `${(c.context_usage_pct as number).toFixed(0)}%`]);
  if (c.tasks_completed != null) pairs.push(["Tasks Completed", String(c.tasks_completed)]);
  if (c.tasks_failed != null) pairs.push(["Tasks Failed", String(c.tasks_failed)]);
  if (c.tasks_retried != null) pairs.push(["Tasks Retried", String(c.tasks_retried)]);
  if (c.sessions_used != null) pairs.push(["Sessions Used", String(c.sessions_used)]);
  if (c.total_parse_retries != null && (c.total_parse_retries as number) > 0) pairs.push(["Total Parse Retries", String(c.total_parse_retries)]);
  if (c.total_build_fix_attempts != null && (c.total_build_fix_attempts as number) > 0) pairs.push(["Total Build Fix Attempts", String(c.total_build_fix_attempts)]);
  if (c.duplicate_error_bailouts != null && (c.duplicate_error_bailouts as number) > 0) pairs.push(["Duplicate Error Bailouts", String(c.duplicate_error_bailouts)]);
  if (Array.isArray(c.phase_timings) && c.phase_timings.length > 0) {
    pairs.push(["Phase Timings", (c.phase_timings as { phase: string; duration_ms: number }[]).map((p) => `${p.phase}: ${fmtMs(p.duration_ms)}`).join(", ")]);
  }

  if (pairs.length === 0) {
    return (
      <div className={styles.logDetail}>
        <Text variant="muted" size="xs">No additional detail</Text>
      </div>
    );
  }

  return (
    <div className={styles.logDetail}>
      {pairs.map(([key, value]) => (
        <div key={key} className={styles.logDetailRow}>
          <span className={styles.logDetailKey}>{key}</span>
          <span className={styles.logDetailValue}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function LogRow({
  entry,
  isSelected,
  onToggle,
}: {
  entry: LogEntry;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const label = EVENT_LABELS[entry.type] ?? "Event";
  return (
    <>
      <div
        className={`${styles.logRow} ${isSelected ? styles.logRowSelected : ""}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
      >
        <span className={styles.logTimestamp}>{entry.timestamp}</span>
        <span className={`${styles.logBadge} ${categoryClass(label)}`}>{label}</span>
        <span className={styles.logSummary}>{entry.summary}</span>
      </div>
      {isSelected && <DetailView event={entry.detail} />}
    </>
  );
}

export function LogPanel() {
  const { entries, contentRef, handleScroll } = useLogStream();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  return (
    <Panel variant="solid" border="solid" className={styles.panelColumn}>
      <div className={styles.logPanelHeader}>
        <Heading level={5}>Log Output</Heading>
      </div>
      <div
        ref={contentRef}
        className={styles.logContent}
        onScroll={handleScroll}
      >
        {entries.length === 0 ? (
          <Text variant="muted" size="sm">Waiting for events...</Text>
        ) : (
          entries.map((entry, i) => (
            <LogRow
              key={i}
              entry={entry}
              isSelected={selectedIdx === i}
              onToggle={() => setSelectedIdx(selectedIdx === i ? null : i)}
            />
          ))
        )}
      </div>
    </Panel>
  );
}
