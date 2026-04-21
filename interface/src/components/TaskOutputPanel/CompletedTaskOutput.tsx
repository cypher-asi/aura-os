import { useEffect, useRef, useState } from "react";
import { Check, X as XIcon, AlertTriangle, CircleDashed, ChevronRight } from "lucide-react";
import { useTaskOutput, useEventStore, getCachedTaskOutputText } from "../../stores/event-store/index";
import { api } from "../../api/client";
import { useTaskOutputPanelStore, type PanelTaskStatus } from "../../stores/task-output-panel-store";
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

const RETRY_DELAY_MS = 2000;

function useHydrateCompletedOutput(projectId: string, taskId: string) {
  const seedTaskOutput = useEventStore((s) => s.seedTaskOutput);
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (hydratedRef.current === taskId) return;
    hydratedRef.current = taskId;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const runHydration = async (attempt: number) => {
      const existing = useEventStore.getState().taskOutputs[taskId];
      if (existing?.text || cancelled) return;

      if (attempt === 0) {
        const cached = getCachedTaskOutputText(taskId, projectId);
        if (cached) {
          seedTaskOutput(taskId, cached, undefined, undefined, projectId);
        }
      }

      const latest = useEventStore.getState().taskOutputs[taskId];
      if (latest?.text || cancelled) return;

      try {
        const res = await api.getTaskOutput(projectId, taskId);
        if (cancelled) return;
        if (res.output || res.build_steps?.length || res.test_steps?.length) {
          seedTaskOutput(taskId, res.output, undefined, undefined, projectId);
          return;
        }
      } catch {
        // Ignore and retry once below.
      }

      if (attempt === 0 && !cancelled) {
        retryTimer = setTimeout(() => {
          void runHydration(1);
        }, RETRY_DELAY_MS);
      }
    };

    void runHydration(0);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
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
