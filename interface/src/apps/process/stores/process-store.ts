import { create } from "zustand";
import type { Process, ProcessNode, ProcessNodeConnection, ProcessRun, ProcessEvent, ProcessFolder } from "../../../shared/types";
import { processApi } from "../../../shared/api/process";
import { isAuraCaptureSessionActive } from "../../../lib/screenshot-bridge";

export const LAST_PROCESS_ID_KEY = "aura:lastProcessId";
export const PROCESS_VIEWPORTS_KEY = "aura:processViewports";

export interface ProcessViewport {
  x: number;
  y: number;
  zoom: number;
}

function isProcessViewport(value: unknown): value is ProcessViewport {
  if (!value || typeof value !== "object") return false;

  const viewport = value as Record<string, unknown>;
  return typeof viewport.x === "number"
    && typeof viewport.y === "number"
    && typeof viewport.zoom === "number";
}

function loadStoredViewports(): Record<string, ProcessViewport> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(PROCESS_VIEWPORTS_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, ProcessViewport] => isProcessViewport(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function persistViewports(viewports: Record<string, ProcessViewport>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROCESS_VIEWPORTS_KEY, JSON.stringify(viewports));
  } catch {
    // Ignore storage failures so the in-memory store still works.
  }
}

function warnProcessStore(context: string, error: unknown) {
  console.warn(`[process-store] ${context}`, error);
}

interface ProcessState {
  processes: Process[];
  loading: boolean;
  nodes: Record<string, ProcessNode[]>;
  connections: Record<string, ProcessNodeConnection[]>;
  runs: Record<string, ProcessRun[]>;
  events: Record<string, ProcessEvent[]>;
  folders: ProcessFolder[];
  /** Tracks the last-viewed run per process so it can be restored on return. */
  lastViewedRunId: Record<string, string>;
  viewports: Record<string, ProcessViewport>;

  fetchProcesses: () => Promise<void>;
  fetchNodes: (processId: string) => Promise<void>;
  fetchConnections: (processId: string) => Promise<void>;
  fetchRuns: (processId: string) => Promise<void>;
  fetchEvents: (processId: string, runId: string) => Promise<void>;
  setEvents: (runId: string, events: ProcessEvent[]) => void;
  setLastViewedRunId: (processId: string, runId: string) => void;
  setViewport: (processId: string, viewport: ProcessViewport) => void;

  addProcess: (process: Process) => void;
  updateProcess: (process: Process) => void;
  removeProcess: (processId: string) => void;

  addFolder: (folder: ProcessFolder) => void;

  setNodes: (processId: string, nodes: ProcessNode[]) => void;
  setConnections: (processId: string, connections: ProcessNodeConnection[]) => void;
}

export const useProcessStore = create<ProcessState>()((set, get) => ({
  processes: [],
  loading: true,
  nodes: {},
  connections: {},
  runs: {},
  events: {},
  folders: [],
  lastViewedRunId: {},
  viewports: loadStoredViewports(),

  fetchProcesses: async () => {
    if (isAuraCaptureSessionActive()) {
      set({ loading: false });
      return;
    }
    set({ loading: true });
    try {
      const processes = await processApi.listProcesses();
      set({ processes, loading: false });
    } catch (e) {
      warnProcessStore("fetchProcesses failed", e);
      set({ loading: false });
    }
  },

  fetchNodes: async (processId: string) => {
    if (isAuraCaptureSessionActive() && get().nodes[processId]) {
      return;
    }
    try {
      const nodes = await processApi.listNodes(processId);
      set((s) => ({ nodes: { ...s.nodes, [processId]: nodes } }));
    } catch (e) {
      warnProcessStore(`fetchNodes failed (processId=${processId})`, e);
    }
  },

  fetchConnections: async (processId: string) => {
    if (isAuraCaptureSessionActive() && get().connections[processId]) {
      return;
    }
    try {
      const connections = await processApi.listConnections(processId);
      set((s) => ({ connections: { ...s.connections, [processId]: connections } }));
    } catch (e) {
      warnProcessStore(`fetchConnections failed (processId=${processId})`, e);
    }
  },

  fetchRuns: async (processId: string) => {
    if (isAuraCaptureSessionActive() && get().runs[processId]) {
      return;
    }
    try {
      const runs = await processApi.listRuns(processId);
      set((s) => ({ runs: { ...s.runs, [processId]: runs } }));
    } catch (e) {
      warnProcessStore(`fetchRuns failed (processId=${processId})`, e);
    }
  },

  fetchEvents: async (processId: string, runId: string) => {
    if (isAuraCaptureSessionActive() && get().events[runId]) {
      return;
    }
    try {
      const events = await processApi.listRunEvents(processId, runId);
      set((s) => ({ events: { ...s.events, [runId]: events } }));
    } catch (e) {
      warnProcessStore(`fetchEvents failed (processId=${processId}, runId=${runId})`, e);
    }
  },
  setEvents: (runId, events) =>
    set((s) => ({ events: { ...s.events, [runId]: events } })),
  setLastViewedRunId: (processId, runId) =>
    set((s) => ({ lastViewedRunId: { ...s.lastViewedRunId, [processId]: runId } })),
  setViewport: (processId, viewport) =>
    set((s) => {
      if (!isProcessViewport(viewport)) {
        warnProcessStore(`setViewport ignored invalid viewport (processId=${processId})`, viewport);
        return s;
      }
      const viewports = { ...s.viewports, [processId]: viewport };
      persistViewports(viewports);
      return { viewports };
    }),

  addFolder: (folder) => set((s) => ({ folders: [folder, ...s.folders] })),
  addProcess: (process) => set((s) => ({ processes: [process, ...s.processes] })),
  updateProcess: (process) => set((s) => ({
    processes: s.processes.map((p) => p.process_id === process.process_id ? process : p),
  })),
  removeProcess: (processId) => set((s) => {
    const viewports = { ...s.viewports };
    delete viewports[processId];
    persistViewports(viewports);
    return {
      processes: s.processes.filter((p) => p.process_id !== processId),
      viewports,
    };
  }),

  setNodes: (processId, nodes) => set((s) => ({ nodes: { ...s.nodes, [processId]: nodes } })),
  setConnections: (processId, connections) =>
    set((s) => ({ connections: { ...s.connections, [processId]: connections } })),
}));
