import { create } from "zustand";
import type { ProcessRun } from "../../../types";

export type ProcessSidekickTab = "process" | "runs" | "events" | "stats" | "log";

interface ProcessSidekickState {
  activeTab: ProcessSidekickTab;
  previewRun: ProcessRun | null;

  setActiveTab: (tab: ProcessSidekickTab) => void;
  viewRun: (run: ProcessRun) => void;
  closePreview: () => void;
}

export const useProcessSidekickStore = create<ProcessSidekickState>()((set) => ({
  activeTab: "process",
  previewRun: null,

  setActiveTab: (tab) => set({ activeTab: tab, previewRun: null }),
  viewRun: (run) => set({ previewRun: run }),
  closePreview: () => set({ previewRun: null }),
}));
