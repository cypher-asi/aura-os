import { create } from "zustand";
import type { CronJobRun, CronArtifact } from "../../../types";

export type CronSidekickTab = "cron" | "runs" | "artifacts" | "stats" | "log";

export type CronPreviewItem =
  | { kind: "run"; run: CronJobRun }
  | { kind: "artifact"; artifact: CronArtifact };

interface CronSidekickState {
  activeTab: CronSidekickTab;
  previewItem: CronPreviewItem | null;
  showEditor: boolean;
  showDeleteConfirm: boolean;

  setActiveTab: (tab: CronSidekickTab) => void;
  viewRun: (run: CronJobRun) => void;
  viewArtifact: (artifact: CronArtifact) => void;
  closePreview: () => void;
  requestEdit: () => void;
  requestDelete: () => void;
  closeEditor: () => void;
  closeDeleteConfirm: () => void;
}

export const useCronSidekickStore = create<CronSidekickState>()((set) => ({
  activeTab: "cron",
  previewItem: null,
  showEditor: false,
  showDeleteConfirm: false,

  setActiveTab: (tab) => set({ activeTab: tab, previewItem: null }),
  viewRun: (run) => set({ previewItem: { kind: "run", run } }),
  viewArtifact: (artifact) => set({ previewItem: { kind: "artifact", artifact } }),
  closePreview: () => set({ previewItem: null }),
  requestEdit: () => set({ showEditor: true }),
  requestDelete: () => set({ showDeleteConfirm: true }),
  closeEditor: () => set({ showEditor: false }),
  closeDeleteConfirm: () => set({ showDeleteConfirm: false }),
}));
