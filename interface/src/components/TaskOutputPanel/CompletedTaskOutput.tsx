import { useState } from "react";
import { Check, X as XIcon, AlertTriangle, CircleDashed, ChevronRight } from "lucide-react";
import { useTaskOutputPanelStore, type PanelTaskStatus } from "../../stores/task-output-panel-store";
import { useTaskOutputView } from "../../hooks/use-task-output-view";
import { MessageBubble } from "../MessageBubble";
import { LLMOutput } from "../LLMOutput";
import styles from "./TaskOutputPanel.module.css";

interface CompletedTaskOutputProps {
  taskId: string;
  projectId: string;
  title: string;
  status: PanelTaskStatus;
}

export function CompletedTaskOutput({ taskId, projectId, title, status }: CompletedTaskOutputProps) {
  const dismissTask = useTaskOutputPanelStore((s) => s.dismissTask);
  // `CompletedTaskOutput` only renders for non-active rows, so every
  // mount is a terminal view from the hook's perspective.
  const { events, fallbackText, hasStructuredContent, hasAnyContent } =
    useTaskOutputView(taskId, projectId, true);

  // Default collapsed, but remember once the user expands so re-renders
  // (e.g. driven by hydration finishing) do not yank the body closed.
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
        hasStructuredContent ? (
          <div className={styles.taskBody}>
            {events.map((evt) => (
              <MessageBubble key={evt.id} message={evt} />
            ))}
          </div>
        ) : fallbackText ? (
          <div className={styles.taskBody}>
            <LLMOutput content={fallbackText} />
          </div>
        ) : (
          <div className={styles.taskBodyEmpty}>
            {status === "failed"
              ? "Task failed without producing output."
              : status === "interrupted"
                ? "Run was interrupted before completing."
                : hasAnyContent
                  ? "No text output captured for this run."
                  : "No output captured for this run."}
          </div>
        )
      )}
    </div>
  );
}
