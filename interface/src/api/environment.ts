import type { EnvironmentInfo } from "../shared/types";
import { apiFetch } from "./core";

export interface WorkspaceDefaults {
  /**
   * Base directory where aura-os stores per-project workspaces by default.
   * A specific project's default folder is `{workspace_root}/{project_id}`.
   */
  workspace_root: string;
}

export const environmentApi = {
  getEnvironmentInfo: () => apiFetch<EnvironmentInfo>("/api/system/info"),
  getWorkspaceDefaults: () =>
    apiFetch<WorkspaceDefaults>("/api/system/workspace_defaults"),
};
