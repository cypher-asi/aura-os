import { useParams } from "react-router-dom";
import { useEventStore } from "../../stores/event-store/index";
import { useLoopControl } from "../../hooks/use-loop-control";
import { AgentStatusBar } from "../AgentStatusBar";
import { TaskFeed } from "../TaskFeed";
import { LogPanel } from "../LogPanel";
import { LoopControls } from "../LoopControls";
import { Badge, Text } from "@cypher-asi/zui";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import {
  canStartWorkspaceAutomation,
  resolveWorkspaceAccess,
} from "../../shared/lib/workspace-access";
import styles from "./ExecutionView.module.css";

export function ExecutionView() {
  const { projectId } = useParams<{ projectId: string }>();
  const connected = useEventStore((s) => s.connected);
  const { features } = useAuraCapabilities();
  const terminalTarget = useTerminalTarget({ projectId });
  const workspaceAccess = resolveWorkspaceAccess({
    workspacePath: terminalTarget.workspacePath,
    remoteWorkspacePath: terminalTarget.remoteWorkspacePath,
    remoteAgentId: terminalTarget.remoteAgentId,
    linkedWorkspace: features.linkedWorkspace,
  });
  const startAgentInstanceId =
    workspaceAccess.kind === "remote"
      ? terminalTarget.remoteAgentInstanceId
      : undefined;
  const workspaceGateActive =
    terminalTarget.status === "loading" ||
    !canStartWorkspaceAutomation(workspaceAccess, startAgentInstanceId);
  const { loopRunning, loopPaused, error, handleStart, handlePause, handleStop } =
    useLoopControl(projectId, startAgentInstanceId);
  const workspaceGateTitle =
    terminalTarget.status === "loading"
      ? "Workspace is still loading"
      : terminalTarget.remoteAgentId
        ? "Remote workspace is not available yet"
        : "Build tools for local workspaces are available in Aura Desktop";

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
        startDisabled={workspaceGateActive}
        startDisabledTitle={workspaceGateTitle}
      />

      {error && (
        <Text variant="muted" size="sm" align="center" className={styles.dangerText}>
          {error}
        </Text>
      )}
    </div>
  );
}
