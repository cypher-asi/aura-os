import { create } from "zustand";
import type { ProcessNode, ProcessRun } from "../../../types";
import { createSidekickSlice, type SidekickSliceState } from "../../../stores/shared/sidekick-slice";

export type ProcessSidekickTab = "process" | "runs" | "events" | "stats" | "log";
export type NodeSidekickTab = "info" | "config" | "connections" | "output";

export type NodeRunStatus = "running" | "completed" | "failed" | "skipped";

interface ProcessSidekickState extends SidekickSliceState<ProcessSidekickTab, ProcessRun> {
  activeNodeTab: NodeSidekickTab;
  /** Kept for backward compatibility; mirrors previewItem from the slice. */
  previewRun: ProcessRun | null;
  selectedNode: ProcessNode | null;
  showEditor: boolean;
  showDeleteConfirm: boolean;
  /** When true, NodeConfigTab should enter edit mode */
  nodeEditRequested: boolean;
  /** Live execution status per node (nodeId -> status) during a run */
  nodeStatuses: Record<string, NodeRunStatus>;
  /** Currently executing node for the active run (from WS events) */
  liveRunNodeId: string | null;

  setActiveNodeTab: (tab: NodeSidekickTab) => void;
  viewRun: (run: ProcessRun) => void;
  closePreview: () => void;
  selectNode: (node: ProcessNode) => void;
  closeNodeInspector: () => void;
  requestEdit: () => void;
  requestDelete: () => void;
  closeEditor: () => void;
  closeDeleteConfirm: () => void;
  clearNodeEditRequested: () => void;
  setNodeStatus: (nodeId: string, status: NodeRunStatus) => void;
  clearNodeStatuses: () => void;
  setLiveRunNodeId: (nodeId: string | null) => void;
}

export const useProcessSidekickStore = create<ProcessSidekickState>()((set, get) => ({
  ...createSidekickSlice<ProcessSidekickTab, ProcessRun>("process", set, get),
  // Override: process store does not clear preview on tab switch
  setActiveTab: (tab: ProcessSidekickTab) => set({ activeTab: tab }),
  activeNodeTab: "info" as NodeSidekickTab,
  previewRun: null,
  selectedNode: null,
  showEditor: false,
  showDeleteConfirm: false,
  nodeEditRequested: false,
  nodeStatuses: {} as Record<string, NodeRunStatus>,
  liveRunNodeId: null,

  setActiveNodeTab: (tab) => set({ activeNodeTab: tab }),
  viewRun: (run) => set({ previewItem: run, previewRun: run, selectedNode: null, previewHistory: [], canGoBack: false }),
  closePreview: () => set({ previewItem: null, previewRun: null, previewHistory: [], canGoBack: false }),
  selectNode: (node) => set({ selectedNode: node, activeNodeTab: "info" }),
  closeNodeInspector: () => set({ selectedNode: null, activeNodeTab: "info" }),
  requestEdit: () => {
    if (get().selectedNode) {
      set({ nodeEditRequested: true });
    } else {
      set({ showEditor: true });
    }
  },
  requestDelete: () => set({ showDeleteConfirm: true }),
  closeEditor: () => set({ showEditor: false }),
  closeDeleteConfirm: () => set({ showDeleteConfirm: false }),
  clearNodeEditRequested: () => set({ nodeEditRequested: false }),
  setNodeStatus: (nodeId, status) =>
    set((s) => ({ nodeStatuses: { ...s.nodeStatuses, [nodeId]: status } })),
  clearNodeStatuses: () => set({ nodeStatuses: {}, liveRunNodeId: null }),
  setLiveRunNodeId: (nodeId) => set({ liveRunNodeId: nodeId }),
}));
