import { GroupCollapsible, Panel, Badge, Text } from "@cypher-asi/zui";
import { useEventStore } from "../../stores/event-store";
import { useLoopControl } from "../../hooks/use-loop-control";
import { AgentStatusBar } from "../AgentStatusBar";
import { LoopControls } from "../LoopControls";
import { ExecutionView } from "../ExecutionView";
import { TaskFeed } from "../TaskFeed";
import { LogPanel } from "../LogPanel";
import { useProjectContext } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useSidekickStore } from "../../stores/sidekick-store";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import { useMobileSpecs } from "./useMobileSpecs";
import { useMobileTasks } from "./useMobileTasks";
import styles from "./ProjectWorkView.module.css";

function ExecutionSummary({ projectId }: { projectId: string }) {
  const connected = useEventStore((s) => s.connected);
  const { loopRunning, loopPaused, error, handleStart, handlePause, handleStop } =
    useLoopControl(projectId);

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

function MobileSpecsList({ projectId }: { projectId: string }) {
  const viewSpec = useSidekickStore((s) => s.viewSpec);
  const { specs } = useMobileSpecs(projectId);

  if (specs.length === 0) {
    return <Text variant="muted" size="sm">No specs yet</Text>;
  }

  return (
    <div className={styles.itemList}>
      {specs.map((spec) => (
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
    </div>
  );
}

function MobileTasksList({ projectId }: { projectId: string }) {
  const ctx = useProjectContext();
  const viewTask = useSidekickStore((s) => s.viewTask);
  const { tasks, tasksBySpec, liveTaskIds, loopActive } = useMobileTasks(projectId);

  if (tasks.length === 0) {
    return <Text variant="muted" size="sm">No tasks yet</Text>;
  }

  return (
    <div className={styles.itemList}>
      {tasks.map((task) => {
        const displayStatus =
          task.status === "in_progress" &&
          !liveTaskIds.has(task.task_id) &&
          (!loopActive || liveTaskIds.size > 0)
            ? "ready"
            : task.status;
        return (
          <button
            key={task.task_id}
            type="button"
            className={styles.itemButton}
            aria-label={`Open task ${task.title}`}
            onClick={() => viewTask(task)}
          >
            <span className={styles.itemButtonMeta}>
              <TaskStatusIcon status={displayStatus} />
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
        );
      })}
    </div>
  );
}

export function ProjectWorkView() {
  const ctx = useProjectContext();
  const { isMobileLayout } = useAuraCapabilities();
  const projectId = ctx?.project.project_id;

  if (!projectId) return null;

  if (!isMobileLayout) return <ExecutionView />;

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
