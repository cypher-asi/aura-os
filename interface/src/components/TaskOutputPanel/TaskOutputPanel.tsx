import { useEffect, useRef } from "react";
import { Text, Item, ModalConfirm } from "@cypher-asi/zui";
import { Trash2, Play, Pause, Square, Loader2 } from "lucide-react";
import {
  useTaskOutputPanel,
  useTaskOutputPanelStore,
  useTasksForProject,
} from "../../stores/task-output-panel-store";
import { useEventStore } from "../../stores/event-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useAutomationStatus } from "../AutomationBar/useAutomationStatus";
import { EventType } from "../../types/aura-events";
import { ActiveTaskStream } from "./ActiveTaskStream";
import { CompletedTaskOutput } from "./CompletedTaskOutput";
import styles from "./TaskOutputPanel.module.css";

function useActiveTaskTracking() {
  const subscribe = useEventStore((s) => s.subscribe);
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const { addTask, completeTask, failTask, markAllCompleted } = useTaskOutputPanelStore.getState();

  useEffect(() => {
    if (!projectId) return;
    const pid = projectId;

    const unsubs = [
      subscribe(EventType.TaskStarted, (e) => {
        const { task_id, task_title } = e.content;
        if (task_id) addTask(task_id, e.project_id ?? pid, task_title);
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.content.task_id) completeTask(e.content.task_id);
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id) failTask(e.content.task_id);
      }),
      subscribe(EventType.LoopStopped, () => markAllCompleted()),
      subscribe(EventType.LoopFinished, () => markAllCompleted()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, projectId, addTask, completeTask, failTask, markAllCompleted]);
}

function AutomationControls({ projectId }: { projectId: string }) {
  const {
    canPlay, canPause, canStop, starting, preparing,
    handleStart, handlePause, handleStop, handleStopConfirm,
    confirmStop, setConfirmStop,
  } = useAutomationStatus(projectId);

  const showStopPause = canPause || canStop;

  return (
    <>
      {!showStopPause && (
        <button
          type="button"
          className={styles.headerBtn}
          onClick={handleStart}
          disabled={!canPlay}
          title="Run"
          aria-label="Run automation"
        >
          {starting || preparing
            ? <Loader2 size={11} className={styles.spinner} />
            : <Play size={11} />}
        </button>
      )}
      {showStopPause && (
        <>
          {canPlay && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={handleStart}
              title="Resume"
              aria-label="Resume automation"
            >
              <Play size={11} />
            </button>
          )}
          {canPause && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={handlePause}
              title="Pause"
              aria-label="Pause automation"
            >
              <Pause size={11} />
            </button>
          )}
          <button
            type="button"
            className={styles.headerBtn}
            onClick={handleStop}
            disabled={!canStop}
            title="Stop"
            aria-label="Stop automation"
          >
            <Square size={11} />
          </button>
        </>
      )}

      <ModalConfirm
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={handleStopConfirm}
        title="Stop Execution"
        message="Stop autonomous execution? The current task will complete first."
        confirmLabel="Stop"
        cancelLabel="Cancel"
        danger
      />
    </>
  );
}

export function TaskOutputPanel() {
  const { panelHeight, collapsed, toggleCollapse, handleMouseDown } = useTaskOutputPanel();
  const clearCompleted = useTaskOutputPanelStore((s) => s.clearCompleted);
  const contentRef = useRef<HTMLDivElement>(null);
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const projectTasks = useTasksForProject(projectId);
  useActiveTaskTracking();

  const hasCompleted = projectTasks.some((t) => t.status !== "active");

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={collapsed ? styles.panelCollapsed : styles.panel}
      style={{ height: collapsed ? 30 : panelHeight }}
    >
      <div className={styles.resizeHandle} onMouseDown={collapsed ? undefined : handleMouseDown} />
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Item.Chevron expanded={!collapsed} onToggle={toggleCollapse} size="sm" />
          <span className={styles.headerLabel}>
            Task Output{projectTasks.length > 0 ? ` (${projectTasks.length})` : ""}
          </span>
        </div>
        <div className={styles.headerActions}>
          {projectId && <AutomationControls projectId={projectId} />}
          {hasCompleted && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={clearCompleted}
              title="Clear completed"
              aria-label="Clear completed task output"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.content} ref={contentRef}>
        {projectTasks.length === 0 ? (
          <div className={styles.emptyState}>
            <Text size="sm" className={styles.emptyText}>No active tasks</Text>
          </div>
        ) : (
          projectTasks.map((entry) =>
            entry.status === "active" ? (
              <ActiveTaskStream
                key={entry.taskId}
                taskId={entry.taskId}
                title={entry.title}
              />
            ) : (
              <CompletedTaskOutput
                key={entry.taskId}
                taskId={entry.taskId}
                projectId={entry.projectId}
                title={entry.title}
                status={entry.status}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}
