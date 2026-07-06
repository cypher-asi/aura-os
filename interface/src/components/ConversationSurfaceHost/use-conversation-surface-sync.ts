import { useEffect } from "react";

import type { ConversationTarget } from "../../apps/agents/hooks/use-conversation-target";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useAgentStore } from "../../apps/agents/stores";
import { resolveWorkspaceAccess } from "../../shared/lib/workspace-access";
import { setLastStandaloneAgentId } from "../../utils/storage";

type ConversationSurfaceSyncInput = {
  isConversationRoute: boolean;
  target: ConversationTarget;
  /** Path `:agentId` when on the standalone agents shell. */
  agentId?: string;
};

/**
 * External-system synchronization for the persistent conversation surface.
 *
 * This is the ONLY place the surface uses effects, and strictly for the
 * canonical "sync React-derived state to an outside store / localStorage"
 * job (terminal panel store, agent selection, last-visited persistence) —
 * never to mirror state that drives rendering. The chat itself renders
 * synchronously from the target-keyed stores, so these syncs can lag a frame
 * without ever causing a remount or a loading flash.
 *
 * Centralizing them here (driven by the location-parsed target) replaces the
 * per-app `AgentMainPanel` / `SharedMainPanel` effects, which ran above the
 * route and so never saw the route params they depended on.
 */
export function useConversationSurfaceSync({
  isConversationRoute,
  target,
  agentId,
}: ConversationSurfaceSyncInput): void {
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const setTerminalTarget = useTerminalPanelStore((s) => s.setTerminalTarget);
  const clearTerminalTarget = useTerminalPanelStore((s) => s.clearTerminalTarget);
  const { features } = useAuraCapabilities();

  const ready = target.kind === "ready" ? target : null;
  const terminal = useTerminalTarget({
    projectId: ready?.projectId,
    agentInstanceId: ready?.agentInstanceId,
  });

  // Standalone agents shell: mirror the active agent into the store (drives
  // the sidebar highlight + info panel) and remember it for nav restore.
  useEffect(() => {
    if (!isConversationRoute || !agentId) return;
    setSelectedAgent(agentId);
    setLastStandaloneAgentId(agentId);
  }, [isConversationRoute, agentId, setSelectedAgent]);

  // Point the terminal sidekick at the active conversation's workspace.
  useEffect(() => {
    if (!isConversationRoute || !ready) return;
    if (terminal.status !== "ready") return;
    const workspaceAccess = resolveWorkspaceAccess({
      workspacePath: terminal.workspacePath,
      remoteWorkspacePath: terminal.remoteWorkspacePath,
      remoteAgentId: terminal.remoteAgentId,
      linkedWorkspace: features.linkedWorkspace,
    });
    if (!workspaceAccess.canUseWorkspace) {
      clearTerminalTarget(ready.projectId);
      return;
    }
    setTerminalTarget({
      cwd: workspaceAccess.workspacePath,
      remoteAgentId: workspaceAccess.kind === "remote" ? terminal.remoteAgentId : undefined,
      projectId: ready.projectId,
    });
  }, [
    clearTerminalTarget,
    features.linkedWorkspace,
    isConversationRoute,
    ready,
    terminal.remoteWorkspacePath,
    terminal.status,
    terminal.workspacePath,
    terminal.remoteAgentId,
    setTerminalTarget,
  ]);
}
