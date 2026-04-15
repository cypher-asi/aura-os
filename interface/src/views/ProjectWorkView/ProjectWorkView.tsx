import { useMemo } from "react";
import { Badge, Text } from "@cypher-asi/zui";
import { useEventStore } from "../../stores/event-store/index";
import { useLoopControl } from "../../hooks/use-loop-control";
import { LoopControls } from "../LoopControls";
import { ExecutionView } from "../ExecutionView";
import { TaskFeed } from "../TaskFeed";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { getLastAgent } from "../../utils/storage";
import { useMobileSpecs } from "./useMobileSpecs";
import styles from "./ProjectWorkView.module.css";

const EMPTY_PROJECT_AGENTS: ReadonlyArray<{
  agent_instance_id: string;
  name: string;
  role?: string | null;
}> = [];

function ExecutionSummary({ projectId }: { projectId: string }) {
  const connected = useEventStore((s) => s.connected);
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

  return (
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
    </div>
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

export function ProjectWorkView() {
  const ctx = useProjectActions();
  const { isMobileLayout } = useAuraCapabilities();
  const projectId = ctx?.project.project_id;

  if (!projectId) return null;

  if (!isMobileLayout) return <ExecutionView />;

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>Execution</div>
        <div className={styles.sectionCard}>
          <ExecutionSummary projectId={projectId} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>Recent activity</div>
        <div className={`${styles.sectionCard} ${styles.sectionBody} ${styles.executionBody}`}>
          <Text size="sm" variant="muted" className={styles.sectionHint}>
            Follow the current remote-agent loop without desktop-style consoles.
          </Text>
          <div className={styles.executionPanels}>
            <div className={styles.executionPanel}>
              <TaskFeed projectId={projectId} />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>Specs</div>
        <div className={`${styles.sectionCard} ${styles.sectionBody}`}>
          <Text size="sm" variant="muted" className={styles.sectionHint}>
            Review the latest planning outputs and jump into details when you need them.
          </Text>
          <MobileSpecsList projectId={projectId} />
        </div>
      </section>
    </div>
  );
}
