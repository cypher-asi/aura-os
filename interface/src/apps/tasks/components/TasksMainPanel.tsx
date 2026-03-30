import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { ButtonPlus, PageEmptyState, Text } from "@cypher-asi/zui";
import { GitBranch, Loader2, SquareKanban } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { RunTaskButton } from "../../../components/RunTaskButton";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { useKanbanData } from "../hooks/useKanbanData";
import { AddTaskForm } from "./AddTaskForm";
import type { Task, TaskStatus } from "../../../types";
import styles from "./TasksMainPanel.module.css";

const LANE_CONFIG: { status: TaskStatus; label: string; canAdd?: boolean }[] = [
  { status: "backlog", label: "Backlog", canAdd: true },
  { status: "to_do", label: "To Do", canAdd: true },
  { status: "pending", label: "Pending" },
  { status: "ready", label: "Ready" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
];

const ACTIONABLE_STATUSES = new Set<string>(["ready", "failed"]);

function KanbanCard({
  task,
  agentName,
  agentIcon,
  onClick,
}: {
  task: Task;
  agentName?: string;
  agentIcon?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.taskCard} onClick={onClick}>
      {agentName && (
        <span className={styles.assigneeBadge}>
          <Avatar avatarUrl={agentIcon} name={agentName} type="agent" size={14} />
          <span className={styles.assigneeName}>{agentName}</span>
        </span>
      )}
      <span className={styles.taskCardMeta}>
        <TaskStatusIcon status={task.status} />
      </span>
      <div className={styles.taskCardContent}>
        <span className={styles.taskCardText}>{task.title}</span>
        {task.description && (
          <span className={styles.taskCardDesc}>{task.description}</span>
        )}
        <span className={styles.taskCardFooter}>
          {task.dependency_ids.length > 0 && (
            <span className={styles.depBadge} title={`${task.dependency_ids.length} dependenc${task.dependency_ids.length === 1 ? "y" : "ies"}`}>
              <GitBranch size={10} />
              {task.dependency_ids.length}
            </span>
          )}
          {ACTIONABLE_STATUSES.has(task.status) && (
            <span className={styles.runBtn} onClick={(e) => e.stopPropagation()}>
              <RunTaskButton task={task} />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

export function TasksMainPanel({ children: _children }: { children?: React.ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const viewTask = useSidekickStore((s) => s.viewTask);
  const refreshProjectAgents = useProjectsListStore((s) => s.refreshProjectAgents);
  const projectAgents = useProjectsListStore((s) => (
    projectId ? s.agentsByProject[projectId] : undefined
  ));
  const { lanes, loading } = useKanbanData(projectId, agentInstanceId);
  const agentById = useMemo(
    () => new Map((projectAgents ?? []).map((agent) => [agent.agent_instance_id, agent])),
    [projectAgents],
  );

  const [addingToLane, setAddingToLane] = useState<TaskStatus | null>(null);

  const handleAddDone = useCallback(() => setAddingToLane(null), []);

  useEffect(() => {
    if (!projectId) return;
    if (!projectAgents) {
      void refreshProjectAgents(projectId);
    }
  }, [projectId, projectAgents, refreshProjectAgents]);

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

  return (
    <ResponsiveMainLane>
      <div className={styles.root}>
        <div className={styles.boardViewport}>
          <div className={styles.board}>
            {LANE_CONFIG.map((lane) => {
              const laneTasks = lanes[lane.status] ?? [];
              return (
                <section key={lane.status} className={styles.column}>
                  <header className={styles.columnHeader}>
                    <Text size="xs" className={styles.columnTitle}>{lane.label}</Text>
                    <span className={styles.headerRight}>
                      <span className={styles.countBadge}>{laneTasks.length}</span>
                      {lane.canAdd && (
                        <ButtonPlus
                          onClick={() => setAddingToLane(lane.status)}
                          size="sm"
                          title={`Add task to ${lane.label}`}
                        />
                      )}
                    </span>
                  </header>
                  <div className={styles.columnBody}>
                    {addingToLane === lane.status && (
                      <AddTaskForm
                        projectId={projectId}
                        status={lane.status as "backlog" | "to_do"}
                        agentInstanceId={agentInstanceId}
                        onDone={handleAddDone}
                      />
                    )}
                    {laneTasks.length === 0 && addingToLane !== lane.status ? (
                      <Text size="xs" variant="muted" className={styles.emptyLabel}>No tasks</Text>
                    ) : (
                      laneTasks.map((task) => {
                        const assignedAgent = task.assigned_agent_instance_id
                          ? agentById.get(task.assigned_agent_instance_id)
                          : undefined;
                        return (
                          <KanbanCard
                            key={task.task_id}
                            task={task}
                            agentName={assignedAgent?.name}
                            agentIcon={assignedAgent?.icon ?? undefined}
                            onClick={() => viewTask(task)}
                          />
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
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
