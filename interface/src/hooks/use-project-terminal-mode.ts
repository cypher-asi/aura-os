import type { ProjectId } from "../types";
import { useTerminalTarget, type TerminalTargetStatus } from "./use-terminal-target";

export type TerminalModeStatus = TerminalTargetStatus;

export interface ProjectTerminalMode {
  remoteAgentId: string | undefined;
  status: TerminalModeStatus;
}

/**
 * Backward-compatible wrapper around unified terminal target resolution.
 */
export function useProjectTerminalMode(projectId: ProjectId | undefined): ProjectTerminalMode {
  return useTerminalTarget({ projectId });
}
