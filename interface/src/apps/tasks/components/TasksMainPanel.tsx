import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { PageEmptyState, Text } from "@cypher-asi/zui";
import { Loader2, SquareKanban } from "lucide-react";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { useKanbanData } from "../hooks/useKanbanData";
import type { TaskStatus } from "../../../types";
import styles from "./TasksMainPanel.module.css";

const LANE_CONFIG: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "to_do", label: "To Do" },
  { status: "pending", label: "Pending" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
];

export function TasksMainPanel({ children }: { children?: React.ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const viewTask = useSidekickStore((s) => s.viewTask);
  const { lanes, loading } = useKanbanData(projectId, agentInstanceId);

  const totalTaskCount = useMemo(
    () => Object.values(lanes).reduce((sum, laneTasks) => sum + laneTasks.length, 0),
    [lanes],
  );

  if (!projectId) {
    return (
      <ResponsiveMainLane>
        <PageEmptyState
          icon={<SquareKanban size={32} />}
          title="Tasks"
          description="Select a project from navigation to view its task board."
        />
      </ResponsiveMainLane>
    );
  }

  if (children) {
    return <ResponsiveMainLane>{children}</ResponsiveMainLane>;
  }

  return (
    <ResponsiveMainLane>
      <div className={styles.root}>
        <div className={styles.boardHeader}>
          <div className={styles.titleWrap}>
            <SquareKanban size={16} />
            <Text size="sm" className={styles.title}>Kanban</Text>
          </div>
          <Text size="xs" variant="muted">
            {totalTaskCount} {totalTaskCount === 1 ? "task" : "tasks"}
          </Text>
        </div>

        <div className={styles.board}>
          {LANE_CONFIG.map((lane) => {
            const laneTasks = lanes[lane.status] ?? [];
            return (
              <section key={lane.status} className={styles.column}>
                <header className={styles.columnHeader}>
                  <Text size="xs" className={styles.columnTitle}>{lane.label}</Text>
                  <span className={styles.countBadge}>{laneTasks.length}</span>
                </header>
                <div className={styles.columnBody}>
                  {laneTasks.length === 0 ? (
                    <Text size="xs" variant="muted" className={styles.emptyLabel}>No tasks</Text>
                  ) : (
                    laneTasks.map((task) => (
                      <button
                        key={task.task_id}
                        type="button"
                        className={styles.taskCard}
                        onClick={() => viewTask(task)}
                      >
                        <span className={styles.taskCardMeta}>
                          <TaskStatusIcon status={task.status} />
                        </span>
                        <span className={styles.taskCardText}>{task.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {loading && (
          <div className={styles.loadingOverlay}>
            <Loader2 size={14} className={styles.spinner} />
            <Text size="xs" variant="muted">Refreshing tasks...</Text>
          </div>
        )}
      </div>
    </ResponsiveMainLane>
  );
}
