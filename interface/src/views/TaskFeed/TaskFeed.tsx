import type { ProjectId } from "../../types";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import { Panel, Heading, Item } from "@cypher-asi/zui";
import { EmptyState } from "../../components/EmptyState";
import { useTaskFeedData } from "./useTaskFeedData";
import styles from "../aura.module.css";

interface TaskFeedProps {
  projectId: ProjectId;
}

export function TaskFeed({ projectId }: TaskFeedProps) {
  const { tasks, sorted, activeTaskId, loopActive } = useTaskFeedData(projectId);
  const displayed = sorted.slice(0, 50);

  return (
    <Panel variant="solid" border="solid" className={styles.panelColumn}>
      <div className={styles.feedHeader}>
        <Heading level={5}>Task Feed ({tasks.length})</Heading>
      </div>
      <div className={styles.feedList}>
        {displayed.map((task) => {
          const displayStatus =
            task.status === "in_progress" &&
            task.task_id !== activeTaskId &&
            (!loopActive || activeTaskId !== null)
              ? "ready"
              : task.status;
          return (
            <Item
              key={task.task_id}
              selected={loopActive && task.task_id === activeTaskId}
              style={task.parent_task_id ? { paddingLeft: "var(--space-6)" } : undefined}
            >
              <Item.Icon><TaskStatusIcon status={displayStatus} /></Item.Icon>
              <Item.Label>
                {task.parent_task_id ? `↳ ${task.title}` : task.title}
              </Item.Label>
            </Item>
          );
        })}
        {tasks.length === 0 && (
          <EmptyState>No tasks</EmptyState>
        )}
      </div>
    </Panel>
  );
}
