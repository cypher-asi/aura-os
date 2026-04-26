import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import { useMobileTasks } from "../../mobile/hooks/useMobileTasks";
import type { Task } from "../../shared/types";
import styles from "./ProjectTasksView.module.css";

type TaskSegmentId = "active" | "ready" | "blocked" | "done";

const SEGMENT_ORDER: TaskSegmentId[] = ["active", "ready", "blocked", "done"];

function getDisplayStatus(task: Task, liveTaskIds: Set<string>, loopActive: boolean) {
  return task.status === "in_progress" &&
    !liveTaskIds.has(task.task_id) &&
    (!loopActive || liveTaskIds.size > 0)
      ? "ready"
      : task.status;
}

function getTaskSegment(status: string): TaskSegmentId {
  if (status === "in_progress") return "active";
  if (status === "done") return "done";
  if (status === "blocked" || status === "failed") return "blocked";
  return "ready";
}

function segmentDescription(segment: TaskSegmentId) {
  switch (segment) {
    case "active":
      return "Work the agent is actively handling right now.";
    case "ready":
      return "Tasks that need attention next.";
    case "blocked":
      return "Items waiting on dependencies or follow-up.";
    case "done":
      return "Completed work and recently finished tasks.";
  }
}

export function ProjectTasksView() {
  const ctx = useProjectActions();
  const { isMobileLayout } = useAuraCapabilities();
  const viewTask = useSidekickStore((s) => s.viewTask);
  const projectId = ctx?.project.project_id;
  const projectAgents = useProjectsListStore((state) => (
    projectId ? state.agentsByProject[projectId] ?? [] : []
  ));
  const { tasks, liveTaskIds, loopActive } = useMobileTasks(projectId ?? "");
  const [selectedSegment, setSelectedSegment] = useState<TaskSegmentId>("ready");
  const [hasUserSelectedSegment, setHasUserSelectedSegment] = useState(false);

  const agentNameById = useMemo(
    () => new Map(projectAgents.map((agent) => [agent.agent_instance_id, agent.name])),
    [projectAgents],
  );
  const specTitleById = useMemo(
    () => new Map((ctx?.initialSpecs ?? []).map((spec) => [spec.spec_id, spec.title])),
    [ctx?.initialSpecs],
  );

  const tasksBySegment = useMemo(() => {
    const grouped: Record<TaskSegmentId, Task[]> = {
      active: [],
      ready: [],
      blocked: [],
      done: [],
    };

    for (const task of tasks) {
      const displayStatus = getDisplayStatus(task, liveTaskIds, loopActive);
      grouped[getTaskSegment(displayStatus)].push(task);
    }

    return grouped;
  }, [liveTaskIds, loopActive, tasks]);

  const segmentCounts = useMemo(
    () => Object.fromEntries(SEGMENT_ORDER.map((segment) => [segment, tasksBySegment[segment].length])) as Record<TaskSegmentId, number>,
    [tasksBySegment],
  );

  useEffect(() => {
    setSelectedSegment("ready");
    setHasUserSelectedSegment(false);
  }, [projectId]);

  useEffect(() => {
    if (hasUserSelectedSegment) return;
    const nextSegment = SEGMENT_ORDER.find((segment) => segmentCounts[segment] > 0) ?? "ready";
    setSelectedSegment(nextSegment);
  }, [hasUserSelectedSegment, segmentCounts]);

  if (!projectId) {
    return null;
  }

  if (!isMobileLayout) {
    return <Navigate to={`/tasks/${projectId}`} replace />;
  }

  const visibleTasks = tasksBySegment[selectedSegment];

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size="lg" weight="medium">What needs attention</Text>
      </header>

      <div className={styles.segmentBar} role="tablist" aria-label="Task status segments">
        {SEGMENT_ORDER.map((segment) => {
          const selected = segment === selectedSegment;
          return (
            <button
              key={segment}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`${styles.segmentButton} ${selected ? styles.segmentButtonActive : ""}`}
              onClick={() => {
                setHasUserSelectedSegment(true);
                setSelectedSegment(segment);
              }}
            >
              <span className={styles.segmentLabel}>{segment[0].toUpperCase() + segment.slice(1)}</span>
              <span className={styles.segmentCount}>{segmentCounts[segment]}</span>
            </button>
          );
        })}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text size="sm" weight="medium">{selectedSegment[0].toUpperCase() + selectedSegment.slice(1)}</Text>
          <Text size="xs" variant="muted">{segmentDescription(selectedSegment)}</Text>
        </div>

        {visibleTasks.length === 0 ? (
          <div className={styles.emptyState}>
            <Text size="sm" weight="medium">Nothing here right now</Text>
            <Text size="sm" variant="muted">{segmentDescription(selectedSegment)}</Text>
          </div>
        ) : (
          <div className={styles.taskList}>
            {visibleTasks.map((task) => {
              const displayStatus = getDisplayStatus(task, liveTaskIds, loopActive);
              const assignedAgentName = task.assigned_agent_instance_id
                ? agentNameById.get(task.assigned_agent_instance_id)
                : null;
              const specTitle = specTitleById.get(task.spec_id);

              return (
                <button
                  key={task.task_id}
                  type="button"
                  className={styles.taskCard}
                  aria-label={`Open task ${task.title}`}
                  onClick={() => viewTask(task)}
                >
                  <span className={styles.taskIcon}>
                    <TaskStatusIcon status={displayStatus} />
                  </span>
                  <span className={styles.taskContent}>
                    <span className={styles.taskTitle}>{task.title}</span>
                    {task.description ? (
                      <span className={styles.taskDescription}>{task.description}</span>
                    ) : null}
                    <span className={styles.taskMeta}>
                      {specTitle ? <span>{specTitle}</span> : null}
                      {assignedAgentName ? <span>{assignedAgentName}</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
