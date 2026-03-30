import { useEffect, useRef } from "react";
import { Text } from "@cypher-asi/zui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTaskOutputPanel, useTaskOutputPanelStore } from "../../stores/task-output-panel-store";
import { useEventStore } from "../../stores/event-store";
import { EventType } from "../../types/aura-events";
import { ActiveTaskStream } from "./ActiveTaskStream";
import styles from "./TaskOutputPanel.module.css";

function useActiveTaskTracking() {
  const subscribe = useEventStore((s) => s.subscribe);
  const { addTask, removeTask, clearTasks } = useTaskOutputPanelStore.getState();

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.TaskStarted, (e) => {
        const { task_id, task_title } = e.content;
        if (task_id) addTask(task_id, task_title);
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.content.task_id) removeTask(e.content.task_id);
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id) removeTask(e.content.task_id);
      }),
      subscribe(EventType.LoopStopped, () => clearTasks()),
      subscribe(EventType.LoopFinished, () => clearTasks()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, addTask, removeTask, clearTasks]);
}

export function TaskOutputPanel() {
  const { panelHeight, collapsed, activeTaskIds, activeTaskTitles, toggleCollapse, handleMouseDown } = useTaskOutputPanel();
  const contentRef = useRef<HTMLDivElement>(null);
  useActiveTaskTracking();

  const taskIds = Array.from(activeTaskIds);

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
        <span className={styles.headerLabel}>
          Task Output{taskIds.length > 0 ? ` (${taskIds.length})` : ""}
        </span>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={toggleCollapse}
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand task output" : "Collapse task output"}
          >
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>
      <div className={styles.content} ref={contentRef}>
        {taskIds.length === 0 ? (
          <div className={styles.emptyState}>
            <Text size="sm" className={styles.emptyText}>No active tasks</Text>
          </div>
        ) : (
          taskIds.map((taskId) => (
            <ActiveTaskStream
              key={taskId}
              taskId={taskId}
              title={activeTaskTitles.get(taskId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
