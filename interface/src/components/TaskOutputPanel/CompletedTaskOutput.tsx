import { useState } from "react";
import { Check, X as XIcon, AlertTriangle, CircleDashed, ChevronRight } from "lucide-react";
import {
  useTaskOutputPanelStore,
  type PanelTaskFailureContext,
  type PanelTaskStatus,
} from "../../stores/task-output-panel-store";
import { useTaskOutputView } from "../../hooks/use-task-output-view";
import { extractErrorMessage } from "../../utils/extract-error-message";
import { MessageBubble } from "../MessageBubble";
import { LLMOutput } from "../LLMOutput";
import styles from "./TaskOutputPanel.module.css";

interface CompletedTaskOutputProps {
  taskId: string;
  projectId: string;
  title: string;
  status: PanelTaskStatus;
  failureReason?: string | null;
  /**
   * Structured provider context forwarded by the server on the
   * `task_failed` event. Rendered as a compact mono label under the
   * reason so operators can grab `req=req_01 · claude-sonnet-4 ·
   * api_error` in one glance. Absent for failures that don't carry an
   * upstream provider context (completion-gate rejections, synthetic
   * "finished without terminal" events, …).
   */
  failureContext?: PanelTaskFailureContext;
}

/**
 * Build the short "`req=… · model=… · type=…`" label rendered
 * underneath the failure reason. Returns `null` when no field is
 * populated so the row collapses back to its pre-Commit-E layout for
 * failures without provider context.
 */
function formatFailureContext(ctx: PanelTaskFailureContext | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.providerRequestId) parts.push(`req=${ctx.providerRequestId}`);
  if (ctx.model) parts.push(ctx.model);
  if (ctx.sseErrorType) parts.push(ctx.sseErrorType);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function CompletedTaskOutput({
  taskId,
  projectId,
  title,
  status,
  failureReason,
  failureContext,
}: CompletedTaskOutputProps) {
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
        <>
          {status === "failed" && failureReason && (
            <div className={styles.failReasonBanner}>
              {extractErrorMessage(failureReason)}
              {(() => {
                const label = formatFailureContext(failureContext);
                return label ? (
                  <div
                    className={styles.failReasonContext}
                    data-testid="task-failure-context"
                  >
                    {label}
                  </div>
                ) : null;
              })()}
            </div>
          )}
          {hasStructuredContent ? (
            <div className={styles.taskBody}>
              {events.map((evt) => (
                <MessageBubble key={evt.id} message={evt} />
              ))}
            </div>
          ) : fallbackText ? (
            <div className={styles.taskBody}>
              <LLMOutput content={fallbackText} />
            </div>
          ) : status === "failed" && failureReason ? (
            // The failure reason itself is the body; no need to also
            // show the generic "Task failed without producing output."
            null
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
          )}
        </>
      )}
    </div>
  );
}
