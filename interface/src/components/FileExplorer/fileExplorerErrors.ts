export function getFileExplorerErrorTitle(
  isRemote: boolean,
  isHosted = false,
  status: number | null = null,
): string {
  if ((isRemote || isHosted) && status === 401) return "Sign in to view files";
  if ((isRemote || isHosted) && status === 403) return "Workspace access denied";
  if ((isRemote || isHosted) && status === 404) return "Workspace not found";
  return isRemote || isHosted
    ? "Files are temporarily unavailable"
    : "Could not load files";
}

export function getFileExplorerErrorDescription(
  error: string,
  isRemote: boolean,
  isHosted = false,
  status: number | null = null,
): string {
  if (status === 401 && (isRemote || isHosted)) {
    return "Your session needs to be refreshed before you can browse these files.";
  }
  if (status === 403 && (isRemote || isHosted)) {
    return "You no longer have permission to browse this agent workspace.";
  }
  if (status === 404 && (isRemote || isHosted)) {
    return "The agent workspace or file path is no longer available. Reopen the agent and try again.";
  }
  if (isHosted) {
    return "Agent workspace files are temporarily unavailable. Try again in a moment.";
  }
  if (isRemote) {
    return "Remote files are temporarily unavailable. Try again in a moment.";
  }

  if (!error.trim()) {
    return "Files are temporarily unavailable. Try again in a moment.";
  }

  return error;
}
