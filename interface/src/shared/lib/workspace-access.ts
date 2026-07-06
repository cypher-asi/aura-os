export type WorkspaceAccessKind = "local" | "remote";

export interface WorkspaceAccessInput {
  workspacePath?: string | null;
  remoteWorkspacePath?: string | null;
  remoteAgentId?: string | null;
  linkedWorkspace: boolean;
}

export interface WorkspaceAccess {
  canBrowseLocal: boolean;
  canBrowseRemote: boolean;
  canUseWorkspace: boolean;
  kind: WorkspaceAccessKind | null;
  workspacePath: string | undefined;
}

function cleanPath(path?: string | null): string | undefined {
  const trimmed = path?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveWorkspaceAccess({
  workspacePath,
  remoteWorkspacePath,
  remoteAgentId,
  linkedWorkspace,
}: WorkspaceAccessInput): WorkspaceAccess {
  const localPath = cleanPath(workspacePath);
  const remotePath = cleanPath(remoteWorkspacePath) ?? localPath;
  const hasRemoteAgent = Boolean(remoteAgentId?.trim());
  const canBrowseRemote = hasRemoteAgent && Boolean(remotePath);
  const canBrowseLocal = !hasRemoteAgent && linkedWorkspace && Boolean(localPath);

  if (canBrowseRemote) {
    return {
      canBrowseLocal: false,
      canBrowseRemote: true,
      canUseWorkspace: true,
      kind: "remote",
      workspacePath: remotePath,
    };
  }

  if (canBrowseLocal) {
    return {
      canBrowseLocal: true,
      canBrowseRemote: false,
      canUseWorkspace: true,
      kind: "local",
      workspacePath: localPath,
    };
  }

  return {
    canBrowseLocal: false,
    canBrowseRemote: false,
    canUseWorkspace: false,
    kind: null,
    workspacePath: undefined,
  };
}

export function canStartWorkspaceAutomation(
  access: Pick<WorkspaceAccess, "canUseWorkspace" | "kind">,
  remoteAgentInstanceId?: string | null,
): boolean {
  if (!access.canUseWorkspace) return false;
  if (access.kind !== "remote") return true;
  return Boolean(remoteAgentInstanceId?.trim());
}
