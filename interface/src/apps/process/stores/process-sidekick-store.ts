import { create } from "zustand";
import type { ProcessNode, ProcessRun } from "../../../types";
import {
  createSidekickSlice,
  persistActiveTab,
  type SidekickSliceState,
} from "../../../stores/shared/sidekick-slice";
import {
  PROCESS_LIVE_RUN_NODE_KEY,
  PROCESS_SIDEKICK_ACTIVE_TAB_KEY,
} from "../../../constants";

interface PersistedLiveRunNode {
  runId: string;
  nodeId: string | null;
}

function readPersistedLiveRunNode(): PersistedLiveRunNode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROCESS_LIVE_RUN_NODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLiveRunNode;
    if (typeof parsed?.runId !== "string") return null;
    if (parsed.nodeId !== null && typeof parsed.nodeId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistLiveRunNode(value: PersistedLiveRunNode | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      window.localStorage.removeItem(PROCESS_LIVE_RUN_NODE_KEY);
    } else {
      window.localStorage.setItem(
        PROCESS_LIVE_RUN_NODE_KEY,
        JSON.stringify(value),
      );
    }
  } catch {
    // Quota / disabled storage is non-fatal — live highlight is a UX
    // optimization, not a source of truth.
  }
}

export type ProcessSidekickTab = "process" | "runs" | "events" | "stats" | "log";

const PROCESS_SIDEKICK_TABS = new Set<ProcessSidekickTab>([
  "process",
  "runs",
  "events",
  "stats",
  "log",
]);

function isProcessSidekickTab(value: string): value is ProcessSidekickTab {
  return PROCESS_SIDEKICK_TABS.has(value as ProcessSidekickTab);
}
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
  /**
   * Run id the `liveRunNodeId` was observed under. Persisted alongside
   * `liveRunNodeId` so a mid-run reload can restore the focused node
   * for the in-flight run without leaking a stale highlight onto a
   * subsequent run.
   */
  liveRunId: string | null;

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
  /**
   * Record the currently-streaming node. When `runId` is provided the
   * pair is persisted to localStorage so a reload can rehydrate the
   * focused node for an in-flight run.
   */
  setLiveRunNodeId: (nodeId: string | null, runId?: string | null) => void;
}

const persistedLiveRunNode = readPersistedLiveRunNode();

export const useProcessSidekickStore = create<ProcessSidekickState>()((set, get) => ({
  ...createSidekickSlice<ProcessSidekickTab, ProcessRun>("process", set, get, {
    storageKey: PROCESS_SIDEKICK_ACTIVE_TAB_KEY,
    isValidTab: isProcessSidekickTab,
  }),
  // Override: process store does not clear preview on tab switch
  setActiveTab: (tab: ProcessSidekickTab) => {
    persistActiveTab(PROCESS_SIDEKICK_ACTIVE_TAB_KEY, tab);
    set({ activeTab: tab });
  },
  activeNodeTab: "info" as NodeSidekickTab,
  previewRun: null,
  selectedNode: null,
  showEditor: false,
  showDeleteConfirm: false,
  nodeEditRequested: false,
  nodeStatuses: {} as Record<string, NodeRunStatus>,
  liveRunNodeId: persistedLiveRunNode?.nodeId ?? null,
  liveRunId: persistedLiveRunNode?.runId ?? null,

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
  clearNodeStatuses: () => {
    persistLiveRunNode(null);
    set({ nodeStatuses: {}, liveRunNodeId: null, liveRunId: null });
  },
  setLiveRunNodeId: (nodeId, runId) => {
    const nextRunId = runId === undefined ? get().liveRunId : runId;
    if (nodeId && nextRunId) {
      persistLiveRunNode({ runId: nextRunId, nodeId });
    } else if (nextRunId && !nodeId) {
      // Run still in flight but no node currently streaming — retain
      // the runId association so a later live node re-links correctly.
      persistLiveRunNode({ runId: nextRunId, nodeId: null });
    } else {
      persistLiveRunNode(null);
    }
    set({ liveRunNodeId: nodeId, liveRunId: nextRunId ?? null });
  },
}));
