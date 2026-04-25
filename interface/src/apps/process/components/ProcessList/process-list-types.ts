import type { Project } from "../../../../shared/types";
import type { InlineRenameTarget } from "../../../../components/InlineRenameInput";
import { useProcessStore } from "../../stores/process-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";

export type ProcessRecord = ReturnType<typeof useProcessStore.getState>["processes"][number];
export type ProjectRecord = ReturnType<typeof useProjectsListStore.getState>["projects"][number];

export type CtxMenuState = {
  x: number;
  y: number;
  projectId?: string;
  processId?: string;
};

export type RenameTargetExt = InlineRenameTarget & {
  kind: "process" | "project";
};

export type DeleteProjectTarget = Project | null;
