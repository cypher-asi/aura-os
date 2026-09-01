export function getFileExplorerErrorTitle(
  isRemote: boolean,
  isHosted = false,
): string {
  return isRemote || isHosted
    ? "Files are temporarily unavailable"
    : "Could not load files";
}

export function getFileExplorerErrorDescription(
  error: string,
  isRemote: boolean,
  isHosted = false,
): string {
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
