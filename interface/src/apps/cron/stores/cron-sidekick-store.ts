import { create } from "zustand";
import type { CronJobRun, CronArtifact } from "../../../types";

export type CronSidekickTab = "cron" | "runs" | "artifacts" | "stats" | "log";

export type CronPreviewItem =
  | { kind: "run"; run: CronJobRun }
  | { kind: "artifact"; artifact: CronArtifact };

interface CronSidekickState {
  activeTab: CronSidekickTab;
  previewItem: CronPreviewItem | null;
  setActiveTab: (tab: CronSidekickTab) => void;
  viewRun: (run: CronJobRun) => void;
  viewArtifact: (artifact: CronArtifact) => void;
  closePreview: () => void;
}

export const useCronSidekickStore = create<CronSidekickState>()((set) => ({
  activeTab: "cron",
  previewItem: null,

  setActiveTab: (tab) => set({ activeTab: tab, previewItem: null }),
  viewRun: (run) => set({ previewItem: { kind: "run", run } }),
  viewArtifact: (artifact) => set({ previewItem: { kind: "artifact", artifact } }),
  closePreview: () => set({ previewItem: null }),
}));
