import { useEffect, useState } from "react";
import type { ProjectId, Task } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { StatusBadge } from "../components/StatusBadge";
import styles from "./execution.module.css";

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
        if (e.task_id) {
          api.listTasks(projectId).then(setTasks).catch(console.error);
        }
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
    <div className={styles.taskFeed}>
      <div className={styles.feedHeader}>Task Feed ({tasks.length})</div>
      <div className={styles.feedList}>
        {displayed.map((task) => (
          <div
            key={task.task_id}
            className={
              task.task_id === activeTaskId
                ? styles.feedItemActive
                : styles.feedItem
            }
          >
            <StatusBadge status={task.status} />
            <span className={styles.feedTitle}>{task.title}</span>
          </div>
        ))}
        {tasks.length === 0 && (
          <div
            style={{
              padding: "20px 14px",
              color: "var(--color-text-dim)",
              textAlign: "center",
              fontSize: 13,
            }}
          >
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}
