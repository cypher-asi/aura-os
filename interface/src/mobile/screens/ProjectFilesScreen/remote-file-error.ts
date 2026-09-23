import { ApiClientError } from "../../../shared/api/core";

export function getRemoteFileErrorDescription(error?: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.status) {
      case 400:
        return "This workspace path is invalid. Go back to files and open it again.";
      case 401:
        return "Your session expired. Sign in again to open this file.";
      case 403:
        return "Access to this workspace file was denied.";
      case 404:
        return "This file or remote agent is no longer available. Refresh the workspace and try again.";
      case 413:
        return "This file is too large for mobile preview. Open it in the connected workspace instead.";
      case 502:
      case 503:
      case 504:
        return "The agent's workspace is offline. Your conversation is still available; try this file when the agent reconnects.";
    }
  }
  return "This workspace file is temporarily unavailable. Try again in a moment.";
}
