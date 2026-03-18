import { useEffect, useState } from "react";
import type { ProjectId, Task } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { TaskStatusIcon } from "../components/TaskStatusIcon";
import { Panel, Heading, Item } from "@cypher-asi/zui";
import { EmptyState } from "../components/EmptyState";
import styles from "./aura.module.css";

interface TaskFeedProps {
  projectId: ProjectId;
}

export function TaskFeed({ projectId }: TaskFeedProps) {
  const { subscribe } = useEventContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  useEffect(() => {
    api.listTasks(projectId).then(setTasks).catch(console.error);
    const interval = setInterval(() => {
      api.listTasks(projectId).then(setTasks).catch(console.error);
    }, 15000);
    return () => clearInterval(interval);
  }, [projectId]);

  useEffect(() => {
    const refetch = () => {
      api.listTasks(projectId).then(setTasks).catch(console.error);
    };
    const unsubs = [
      subscribe("task_started", (e) => {
        setActiveTaskId(e.task_id || null);
        setTasks((prev) =>
          prev.map((t) =>
            t.task_id === e.task_id ? { ...t, status: "in_progress" as const } : t,
          ),
        );
      }),
      subscribe("task_completed", (e) => {
        setActiveTaskId((curr) => (curr === e.task_id ? null : curr));
        setTasks((prev) =>
          prev.map((t) =>
            t.task_id === e.task_id ? { ...t, status: "done" as const } : t,
          ),
        );
      }),
      subscribe("task_failed", (e) => {
        setActiveTaskId((curr) => (curr === e.task_id ? null : curr));
        setTasks((prev) =>
          prev.map((t) =>
            t.task_id === e.task_id ? { ...t, status: "failed" as const } : t,
          ),
        );
      }),
      subscribe("task_became_ready", (e) => {
        setTasks((prev) =>
          prev.map((t) =>
            t.task_id === e.task_id ? { ...t, status: "ready" as const } : t,
          ),
        );
      }),
      subscribe("follow_up_task_created", (e) => {
        if (e.task_id) refetch();
      }),
      subscribe("loop_stopped", () => {
        setActiveTaskId(null);
        refetch();
      }),
      subscribe("loop_paused", () => {
        setActiveTaskId(null);
        refetch();
      }),
      subscribe("loop_finished", () => {
        setActiveTaskId(null);
        refetch();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, projectId]);

  const sorted = [...tasks].sort((a, b) => {
    const order: Record<string, number> = {
      in_progress: 0,
      ready: 1,
      pending: 2,
      blocked: 3,
      done: 4,
      failed: 5,
    };
    return (order[a.status] ?? 99) - (order[b.status] ?? 99);
  });

  const displayed = sorted.slice(0, 50);

  return (
    <Panel variant="solid" border="solid" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--color-border)" }}>
        <Heading level={5}>Task Feed ({tasks.length})</Heading>
      </div>
      <div className={styles.feedList}>
        {displayed.map((task) => (
            <Item
              key={task.task_id}
              selected={task.task_id === activeTaskId}
              style={task.parent_task_id ? { paddingLeft: "var(--space-6)" } : undefined}
            >
              <Item.Icon><TaskStatusIcon status={task.status} /></Item.Icon>
              <Item.Label>
                {task.parent_task_id ? `↳ ${task.title}` : task.title}
              </Item.Label>
            </Item>
        ))}
        {tasks.length === 0 && (
          <EmptyState>No tasks</EmptyState>
        )}
      </div>
    </Panel>
  );
}
