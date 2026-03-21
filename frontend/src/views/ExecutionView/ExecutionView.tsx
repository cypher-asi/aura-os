import { useParams } from "react-router-dom";
import { useEventStore } from "../../stores/event-store";
import { useLoopControl } from "../../hooks/use-loop-control";
import { AgentStatusBar } from "../AgentStatusBar";
import { TaskFeed } from "../TaskFeed";
import { LogPanel } from "../LogPanel";
import { LoopControls } from "../LoopControls";
import { Badge, Text } from "@cypher-asi/zui";
import styles from "../aura.module.css";

export function ExecutionView() {
  const { projectId } = useParams<{ projectId: string }>();
  const connected = useEventStore((s) => s.connected);
  const { loopRunning, loopPaused, error, handleStart, handlePause, handleStop } =
    useLoopControl(projectId);

  if (!projectId) return null;

  return (
    <div className={styles.executionView}>
      {!connected && (
        <Badge variant="error">Live updates unavailable — polling for status</Badge>
      )}

      <AgentStatusBar projectId={projectId} />

      <div className={styles.panels}>
        <TaskFeed projectId={projectId} />
        <LogPanel />
      </div>

      <LoopControls
        projectId={projectId}
        running={loopRunning}
        paused={loopPaused}
        onStart={handleStart}
        onPause={handlePause}
        onStop={handleStop}
      />

      {error && (
        <Text variant="muted" size="sm" align="center" style={{ color: "var(--color-danger)" }}>
          {error}
        </Text>
      )}
    </div>
  );
}
