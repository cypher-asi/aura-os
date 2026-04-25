import { useMemo, useState } from "react";
import { Badge, ModalConfirm, Text } from "@cypher-asi/zui";
import { useEventStore } from "../../stores/event-store/index";
import { useLoopControl } from "../../hooks/use-loop-control";
import { ExecutionView } from "../ExecutionView";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { getLastAgent } from "../../utils/storage";
import { useMobileSpecs } from "./useMobileSpecs";
import { useMobileTasks } from "./useMobileTasks";
import type { Task } from "../../shared/types";
import styles from "./ProjectWorkView.module.css";

const EMPTY_PROJECT_AGENTS: ReadonlyArray<{
  agent_instance_id: string;
  name: string;
  role?: string | null;
}> = [];

function getDisplayStatus(task: Task, liveTaskIds: Set<string>, loopActive: boolean) {
  return task.status === "in_progress" &&
    !liveTaskIds.has(task.task_id) &&
    (!loopActive || liveTaskIds.size > 0)
      ? "ready"
      : task.status;
}

function describeActivityStatus(status: string) {
  switch (status) {
    case "in_progress":
      return "Working now";
    case "done":
      return "Completed";
    case "blocked":
    case "failed":
      return "Needs follow-up";
    default:
      return "Up next";
  }
}

function ExecutionAction({
  label,
  className,
  onPress,
}: {
  label: string;
  className: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onPress}
    >
      {label}
    </button>
  );
}

function ExecutionSummary({ projectId }: { projectId: string }) {
  const connected = useEventStore((s) => s.connected);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);
  const projectAgents = useProjectsListStore((s) => s.agentsByProject[projectId] ?? EMPTY_PROJECT_AGENTS);
  const activeAgent = useMemo(() => {
    const rememberedAgentId = getLastAgent(projectId);
    if (!rememberedAgentId) {
      return projectAgents[0] ?? null;
    }
    return projectAgents.find((agent) => agent.agent_instance_id === rememberedAgentId) ?? projectAgents[0] ?? null;
  }, [projectAgents, projectId]);
  const { loopRunning, loopPaused, error, handleStart, handlePause, handleStop } =
    useLoopControl(projectId);
  const loopStatus = loopRunning ? (loopPaused ? "Paused" : "Running") : "Idle";
  const hasSecondaryAction = loopRunning || loopPaused;

  return (
    <>
      <div className={`${styles.sectionCard} ${styles.executionCard}`}>
        <div className={styles.executionSummary}>
          {!connected && (
            <Text variant="muted" size="sm" className={styles.executionNotice}>
              Live updates are reconnecting. You can still start or resume work.
            </Text>
          )}

          <div className={styles.executionSummaryTop}>
            <div className={styles.executionAgentBlock}>
              <span className={styles.executionMetaLabel}>Active agent</span>
              <span className={styles.executionAgentName}>{activeAgent?.name ?? "No agent connected yet"}</span>
              <span className={styles.executionAgentMeta}>
                {activeAgent?.role?.trim() || "Remote Aura agent"}
              </span>
            </div>
            <div className={styles.executionStateStack}>
              <Badge variant={connected ? "running" : "stopped"} className={styles.executionBadge}>
                {connected ? "Connected" : "Offline"}
              </Badge>
              <span className={styles.executionStateText}>Loop {loopStatus}</span>
            </div>
          </div>

        </div>
      </div>

      <div
        className={`${styles.sectionCard} ${styles.executionActionCard} ${
          hasSecondaryAction ? styles.executionActionCardDual : styles.executionActionCardSingle
        }`}
      >
        <div className={styles.executionActions}>
          <div className={styles.executionControlRow}>
            {!loopRunning && !loopPaused && (
              <ExecutionAction
                label="Start remote work"
                className={`${styles.executionButton} ${styles.executionButtonPrimary}`}
                onPress={() => { void handleStart(); }}
              />
            )}
            {loopPaused && (
              <ExecutionAction
                label="Resume remote work"
                className={`${styles.executionButton} ${styles.executionButtonPrimary}`}
                onPress={() => { void handleStart(); }}
              />
            )}
            {loopRunning && !loopPaused && (
              <ExecutionAction
                label="Pause loop"
                className={`${styles.executionButton} ${styles.executionButtonSecondary}`}
                onPress={() => { void handlePause(); }}
              />
            )}
            {(loopRunning || loopPaused) && (
              <ExecutionAction
                label="Stop loop"
                className={`${styles.executionButton} ${styles.executionButtonDanger}`}
                onPress={() => setConfirmStopOpen(true)}
              />
            )}
          </div>
          {error && (
            <Text variant="muted" size="sm" className={styles.executionError}>
              {error}
            </Text>
          )}
        </div>
      </div>

      <ModalConfirm
        isOpen={confirmStopOpen}
        onClose={() => setConfirmStopOpen(false)}
        onConfirm={() => {
          setConfirmStopOpen(false);
          void handleStop();
        }}
        title="Stop Execution"
        message="Stop autonomous execution? The current task will complete first."
        confirmLabel="Stop"
        cancelLabel="Cancel"
        danger
      />
    </>
  );
}

function MobileSpecsList({ projectId }: { projectId: string }) {
  const viewSpec = useSidekickStore((s) => s.viewSpec);
  const { specs } = useMobileSpecs(projectId);
  const visibleSpecs = specs.slice(0, 2);

  if (specs.length === 0) {
    return <Text variant="muted" size="sm">No specs yet</Text>;
  }

  return (
    <div className={styles.itemList}>
      {visibleSpecs.map((spec) => (
        <button
          key={spec.spec_id}
          type="button"
          className={styles.itemButton}
          aria-label={`Open spec ${spec.title || "Spec"}`}
          onClick={() => viewSpec(spec)}
        >
          <span className={styles.itemTitle}>{spec.title || "Spec"}</span>
        </button>
      ))}
      {specs.length > visibleSpecs.length ? (
        <Text size="sm" variant="muted" className={styles.sectionHint}>
          Showing the latest {visibleSpecs.length} specs.
        </Text>
      ) : null}
    </div>
  );
}

function MobileRecentActivity({ projectId }: { projectId: string }) {
  const ctx = useProjectActions();
  const viewTask = useSidekickStore((s) => s.viewTask);
  const { tasks, liveTaskIds, loopActive } = useMobileTasks(projectId);
  const specTitleById = useMemo(
    () => new Map((ctx?.initialSpecs ?? []).map((spec) => [spec.spec_id, spec.title])),
    [ctx?.initialSpecs],
  );

  const visibleTasks = useMemo(() => {
    return [...tasks]
      .sort((left, right) => {
        const leftStatus = getDisplayStatus(left, liveTaskIds, loopActive);
        const rightStatus = getDisplayStatus(right, liveTaskIds, loopActive);
        const statusRank = (status: string) => {
          if (status === "in_progress") return 0;
          if (status === "ready") return 1;
          if (status === "blocked" || status === "failed") return 2;
          return 3;
        };
        const rankDiff = statusRank(leftStatus) - statusRank(rightStatus);
        if (rankDiff !== 0) return rankDiff;
        return Number(new Date(right.updated_at)) - Number(new Date(left.updated_at));
      })
      .slice(0, 2);
  }, [liveTaskIds, loopActive, tasks]);

  if (visibleTasks.length === 0) {
    return (
      <div className={styles.activityEmpty}>
        <Text size="sm" weight="medium">No recent work yet</Text>
        <Text size="sm" variant="muted">
          Start the loop to see live task progress and planning activity here.
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.activityList}>
      {visibleTasks.map((task) => {
        const displayStatus = getDisplayStatus(task, liveTaskIds, loopActive);
        const specTitle = specTitleById.get(task.spec_id);

        return (
          <button
            key={task.task_id}
            type="button"
            className={styles.activityCard}
            aria-label={task.title}
            onClick={() => viewTask(task)}
          >
            <span className={styles.activityIcon}>
              <TaskStatusIcon status={displayStatus} />
            </span>
            <span className={styles.activityContent}>
              <span className={styles.activityTitle}>{task.title}</span>
              <span className={styles.activityMeta}>
                {describeActivityStatus(displayStatus)}
                {specTitle ? ` • ${specTitle}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ProjectWorkView() {
  const ctx = useProjectActions();
  const { isMobileLayout } = useAuraCapabilities();
  const projectId = ctx?.project.project_id;

  if (!projectId) return null;

  if (!isMobileLayout) return <ExecutionView />;

  return (
    <div className={styles.root}>
      <section className={styles.section} aria-label="Execution">
        <div className={styles.sectionLabel}>Execution</div>
        <ExecutionSummary projectId={projectId} />
      </section>

      <section className={styles.section} aria-label="Recent activity">
        <div className={`${styles.sectionCard} ${styles.sectionBody} ${styles.executionBody}`}>
          <div className={styles.sectionCardHeader}>
            <div className={styles.sectionLabel}>Recent activity</div>
          </div>
          <MobileRecentActivity projectId={projectId} />
        </div>
      </section>

      <section className={styles.section} aria-label="Specs">
        <div className={`${styles.sectionCard} ${styles.sectionBody}`}>
          <div className={styles.sectionCardHeader}>
            <div className={styles.sectionLabel}>Specs</div>
            <Text size="sm" variant="muted" className={styles.sectionHint}>
              Review the latest planning outputs and jump into details when you need them.
            </Text>
          </div>
          <MobileSpecsList projectId={projectId} />
        </div>
      </section>
    </div>
  );
}
