import { useEffect, useMemo, useState } from "react";
import { Badge, GroupCollapsible, Panel, Text } from "@cypher-asi/zui";
import { api } from "../api/client";
import { AgentStatusBar } from "./AgentStatusBar";
import { LoopControls } from "./LoopControls";
import { ExecutionView } from "./ExecutionView";
import { TaskFeed } from "./TaskFeed";
import { LogPanel } from "./LogPanel";
import { useProjectContext } from "../stores/project-action-store";
import { useEventStore } from "../stores/event-store";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useSidekick } from "../stores/sidekick-store";
import { TaskStatusIcon } from "../components/TaskStatusIcon";
import type { Spec, Task } from "../types";
import styles from "./ProjectWorkView.module.css";

function ExecutionSummary({ projectId }: { projectId: string }) {
  const connected = useEventStore((s) => s.connected);
  const subscribe = useEventStore((s) => s.subscribe);
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopPaused, setLoopPaused] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubs = [
      subscribe("loop_started", () => {
        setLoopRunning(true);
        setLoopPaused(false);
      }),
      subscribe("loop_paused", () => {
        setLoopPaused(true);
      }),
      subscribe("loop_stopped", () => {
        setLoopRunning(false);
        setLoopPaused(false);
      }),
      subscribe("loop_finished", () => {
        setLoopRunning(false);
        setLoopPaused(false);
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribe]);

  const handleStart = async () => {
    setError("");
    try {
      await api.startLoop(projectId);
      setLoopRunning(true);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start loop");
    }
  };

  const handlePause = async () => {
    try {
      await api.pauseLoop(projectId);
      setLoopPaused(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause loop");
    }
  };

  const handleStop = async () => {
    try {
      await api.stopLoop(projectId);
      setLoopRunning(false);
      setLoopPaused(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop loop");
    }
  };

  return (
    <Panel variant="solid" border="solid" className={styles.executionSummary}>
      {!connected && (
        <Badge variant="error" className={styles.executionBadge}>
          Live updates unavailable
        </Badge>
      )}

      <AgentStatusBar projectId={projectId} />

      <div className={styles.executionControls}>
        <LoopControls
          projectId={projectId}
          running={loopRunning}
          paused={loopPaused}
          onStart={handleStart}
          onPause={handlePause}
          onStop={handleStop}
        />
      </div>

      {error && (
        <Text variant="muted" size="sm" className={styles.executionError}>
          {error}
        </Text>
      )}
    </Panel>
  );
}

function sortByOrder<T extends { order_index: number }>(items: T[]) {
  return [...items].sort((left, right) => left.order_index - right.order_index);
}

function MobileSpecsList({ projectId }: { projectId: string }) {
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const [specs, setSpecs] = useState<Spec[]>(() => sortByOrder(ctx?.initialSpecs ?? []));

  useEffect(() => {
    let cancelled = false;
    void api.listSpecs(projectId).then((nextSpecs) => {
      if (!cancelled) {
        setSpecs(sortByOrder(nextSpecs));
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (specs.length === 0) {
    return (
      <Text variant="muted" size="sm">
        No specs yet
      </Text>
    );
  }

  return (
    <div className={styles.itemList}>
      {specs.map((spec) => (
        <button
          key={spec.spec_id}
          type="button"
          className={styles.itemButton}
          onClick={() => sidekick.viewSpec(spec)}
        >
          <span className={styles.itemTitle}>{spec.title || "Spec"}</span>
        </button>
      ))}
    </div>
  );
}

function MobileTasksList({ projectId }: { projectId: string }) {
  const ctx = useProjectContext();
  const sidekick = useSidekick();
  const [tasks, setTasks] = useState<Task[]>(() => sortByOrder(ctx?.initialTasks ?? []));
  const tasksBySpec = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      const bucket = grouped.get(task.spec_id) ?? [];
      bucket.push(task);
      grouped.set(task.spec_id, bucket);
    }
    return grouped;
  }, [tasks]);

  useEffect(() => {
    let cancelled = false;
    void api.listTasks(projectId).then((nextTasks) => {
      if (!cancelled) {
        setTasks(sortByOrder(nextTasks));
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (tasks.length === 0) {
    return (
      <Text variant="muted" size="sm">
        No tasks yet
      </Text>
    );
  }

  return (
    <div className={styles.itemList}>
      {tasks.map((task) => (
        <button
          key={task.task_id}
          type="button"
          className={styles.itemButton}
          onClick={() => sidekick.viewTask(task)}
        >
          <span className={styles.itemButtonMeta}>
            <TaskStatusIcon status={task.status} />
          </span>
          <span className={styles.itemButtonContent}>
            <span className={styles.itemTitle}>{task.title}</span>
            {tasksBySpec.get(task.spec_id)?.length ? (
              <span className={styles.itemSubtitle}>
                {ctx?.initialSpecs.find((spec) => spec.spec_id === task.spec_id)?.title ?? "Task"}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ProjectWorkView() {
  const ctx = useProjectContext();
  const { isMobileLayout } = useAuraCapabilities();
  const projectId = ctx?.project.project_id;

  if (!projectId) {
    return null;
  }

  if (!isMobileLayout) {
    return <ExecutionView />;
  }

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>Execution</div>
        <ExecutionSummary projectId={projectId} />
      </section>

      <GroupCollapsible label="Execution details" defaultOpen={false} className={styles.section}>
        <div className={`${styles.sectionBody} ${styles.executionBody}`}>
          <div className={styles.executionPanels}>
            <div className={styles.executionPanel}>
              <TaskFeed projectId={projectId} />
            </div>
            <div className={styles.executionPanel}>
              <LogPanel />
            </div>
          </div>
        </div>
      </GroupCollapsible>

      <GroupCollapsible label="Specs" defaultOpen className={styles.section}>
        <div className={styles.sectionBody}>
          <MobileSpecsList projectId={projectId} />
        </div>
      </GroupCollapsible>

      <GroupCollapsible label="Tasks" defaultOpen className={styles.section}>
        <div className={styles.sectionBody}>
          <MobileTasksList projectId={projectId} />
        </div>
      </GroupCollapsible>
    </div>
  );
}
