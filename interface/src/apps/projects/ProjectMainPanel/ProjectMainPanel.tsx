import { useEffect, useRef, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useTerminalPanelStore } from "../../../stores/terminal-panel-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { resolveWorkspaceAccess } from "../../../shared/lib/workspace-access";

export function ProjectMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const setTerminalTarget = useTerminalPanelStore((s) => s.setTerminalTarget);
  const clearTerminalTarget = useTerminalPanelStore((s) => s.clearTerminalTarget);
  const { features } = useAuraCapabilities();

  const { remoteAgentId, remoteWorkspacePath, workspacePath, status } =
    useTerminalTarget({ projectId, agentInstanceId });
  const workspaceAccess = resolveWorkspaceAccess({
    workspacePath,
    remoteWorkspacePath,
    remoteAgentId,
    linkedWorkspace: features.linkedWorkspace,
  });

  // The Projects app should start on Terminal only when the active workspace is
  // reachable. Web users can chat with hosted agents, but browser sessions
  // cannot attach to desktop-local workspaces, so their safe default is Chats.
  const didInitSidekickTab = useRef(false);
  useEffect(() => {
    if (didInitSidekickTab.current) return;
    if (status !== "ready") return;
    didInitSidekickTab.current = true;
    useSidekickStore.getState().setActiveTab(
      workspaceAccess.canUseWorkspace ? "terminal" : "sessions",
    );
  }, [status, workspaceAccess.canUseWorkspace]);

  useEffect(() => {
    if (status !== "ready") return;
    if (!workspaceAccess.canUseWorkspace) {
      clearTerminalTarget(projectId);
      return;
    }
    setTerminalTarget({
      cwd: workspaceAccess.workspacePath,
      remoteAgentId: workspaceAccess.kind === "remote" ? remoteAgentId : undefined,
      projectId,
    });
  }, [
    clearTerminalTarget,
    projectId,
    remoteAgentId,
    setTerminalTarget,
    status,
    workspaceAccess.canUseWorkspace,
    workspaceAccess.kind,
    workspaceAccess.workspacePath,
  ]);

  return <>{children}</>;
}
