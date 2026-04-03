import { create } from "zustand";
import type { ProcessNode, ProcessRun } from "../../../types";

export type ProcessSidekickTab = "process" | "runs" | "events" | "stats" | "log";
export type NodeSidekickTab = "info" | "config" | "connections" | "output";

export type NodeRunStatus = "running" | "completed" | "failed" | "skipped";

interface ProcessSidekickState {
  activeTab: ProcessSidekickTab;
  activeNodeTab: NodeSidekickTab;
  previewRun: ProcessRun | null;
  selectedNode: ProcessNode | null;
  showEditor: boolean;
  showDeleteConfirm: boolean;
  /** Live execution status per node (nodeId → status) during a run */
  nodeStatuses: Record<string, NodeRunStatus>;

  setActiveTab: (tab: ProcessSidekickTab) => void;
  setActiveNodeTab: (tab: NodeSidekickTab) => void;
  viewRun: (run: ProcessRun) => void;
  closePreview: () => void;
  selectNode: (node: ProcessNode) => void;
  closeNodeInspector: () => void;
  requestEdit: () => void;
  requestDelete: () => void;
  closeEditor: () => void;
  closeDeleteConfirm: () => void;
  setNodeStatus: (nodeId: string, status: NodeRunStatus) => void;
  clearNodeStatuses: () => void;
}

export const useProcessSidekickStore = create<ProcessSidekickState>()((set) => ({
  activeTab: "process",
  activeNodeTab: "info",
  previewRun: null,
  selectedNode: null,
  showEditor: false,
  showDeleteConfirm: false,
  nodeStatuses: {},

  setActiveTab: (tab) => set({ activeTab: tab, previewRun: null }),
  setActiveNodeTab: (tab) => set({ activeNodeTab: tab }),
  viewRun: (run) => set({ previewRun: run, selectedNode: null }),
  closePreview: () => set({ previewRun: null }),
  selectNode: (node) => set({ selectedNode: node, previewRun: null, activeNodeTab: "info" }),
  closeNodeInspector: () => set({ selectedNode: null, activeNodeTab: "info" }),
  requestEdit: () => set({ showEditor: true }),
  requestDelete: () => set({ showDeleteConfirm: true }),
  closeEditor: () => set({ showEditor: false }),
  closeDeleteConfirm: () => set({ showDeleteConfirm: false }),
  setNodeStatus: (nodeId, status) =>
    set((s) => ({ nodeStatuses: { ...s.nodeStatuses, [nodeId]: status } })),
  clearNodeStatuses: () => set({ nodeStatuses: {} }),
}));
