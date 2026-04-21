import { useEffect, useState } from "react";
import { Check, X as XIcon, AlertTriangle, CircleDashed, ChevronRight } from "lucide-react";
import { useTaskOutput, useEventStore, getCachedTaskOutputText } from "../../stores/event-store/index";
import { api } from "../../api/client";
import { useTaskOutputPanelStore, type PanelTaskStatus } from "../../stores/task-output-panel-store";
import { hydrateTaskOutputOnce } from "../../stores/task-output-hydration-cache";
import { useStreamEvents } from "../../hooks/stream/hooks";
import { MessageBubble } from "../MessageBubble";
import { LLMOutput } from "../LLMOutput";
import styles from "./TaskOutputPanel.module.css";

interface CompletedTaskOutputProps {
  taskId: string;
  projectId: string;
  title: string;
  status: PanelTaskStatus;
}

/**
 * Hydrates task output for a completed row. Deduplicates across all
 * rows and all re-mounts via the shared hydration cache, and respects
 * the server's `unavailable` flag as a terminal "no output" signal so
 * we never retry on empty. If the local cache has text, we seed it
 * immediately for an instant render while the server call resolves.
 */
function useHydrateCompletedOutput(projectId: string, taskId: string) {
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);

  useEffect(() => {
    let cancelled = false;

    const existing = useEventStore.getState().taskOutputs[taskId];
    if (!existing?.text) {
      const cached = getCachedTaskOutputText(taskId, projectId);
      if (cached) {
        seedTaskOutput(taskId, cached, undefined, undefined, projectId);
      }
    }

    void hydrateTaskOutputOnce(projectId, taskId, async () => {
      const current = useEventStore.getState().taskOutputs[taskId];
      if (current?.text) return "loaded";
      try {
        const res = await api.getTaskOutput(projectId, taskId);
        if (cancelled) return "empty";
        if (res.output || res.build_steps?.length || res.test_steps?.length) {
          seedTaskOutput(taskId, res.output, undefined, undefined, projectId);
          return "loaded";
        }
        // Server explicitly says there is no output for this task (e.g.
        // session_id never got persisted). Cache this as "empty" so the
        // row does not re-hit the endpoint on every mount.
        return "empty";
      } catch {
        return "empty";
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, seedTaskOutput]);
}

export function CompletedTaskOutput({ taskId, projectId, title, status }: CompletedTaskOutputProps) {
  const taskOutput = useTaskOutput(taskId);
  const dismissTask = useTaskOutputPanelStore((s) => s.dismissTask);
  const streamEvents = useStreamEvents(`task:${taskId}`);

  useHydrateCompletedOutput(projectId, taskId);

  const [collapsed, setCollapsed] = useState(true);

  const statusIcon =
    status === "failed" ? <AlertTriangle size={10} />
    : status === "interrupted" ? <CircleDashed size={10} />
    : <Check size={10} />;

  const dotClass =
    status === "failed" ? styles.taskDotFailed
    : status === "interrupted" ? styles.taskDotInterrupted
    : styles.taskDotCompleted;

  const statusLabel =
    status === "failed" ? "Failed"
    : status === "interrupted" ? "Interrupted"
    : "Done";

  const hasStreamEvents = streamEvents.length > 0;

  return (
    <div className={styles.taskSection}>
      <button
        type="button"
        className={styles.taskHeader}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={collapsed ? styles.taskChevron : styles.taskChevronExpanded}>
          <ChevronRight size={10} />
        </span>
        <span className={dotClass}>{statusIcon}</span>
        <span className={styles.taskTitle}>{title || taskId}</span>
        <span className={styles.taskStatusBadge} data-status={status}>{statusLabel}</span>
        <span
          role="button"
          tabIndex={0}
          className={styles.dismissBtn}
          onClick={(e) => {
            e.stopPropagation();
            dismissTask(taskId);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              dismissTask(taskId);
            }
          }}
          title="Dismiss"
          aria-label="Dismiss task output"
        >
          <XIcon size={10} />
        </span>
      </button>
      {!collapsed && (
        hasStreamEvents ? (
          <div className={styles.taskBody}>
            {streamEvents.map((evt) => (
              <MessageBubble key={evt.id} message={evt} />
            ))}
          </div>
        ) : taskOutput.text ? (
          <div className={styles.taskBody}>
            <LLMOutput content={taskOutput.text} />
          </div>
        ) : (
          <div className={styles.taskBodyEmpty}>
            {status === "failed"
              ? "Task failed without producing output."
              : status === "interrupted"
                ? "Run was interrupted before completing."
                : "No output captured for this run."}
          </div>
        )
      )}
    </div>
  );
}
