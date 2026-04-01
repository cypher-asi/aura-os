import { create } from "zustand";
import type { Process, ProcessNode, ProcessNodeConnection, ProcessRun, ProcessEvent } from "../../../types";
import { processApi } from "../../../api/process";

interface ProcessState {
  processes: Process[];
  loading: boolean;
  nodes: Record<string, ProcessNode[]>;
  connections: Record<string, ProcessNodeConnection[]>;
  runs: Record<string, ProcessRun[]>;
  events: Record<string, ProcessEvent[]>;

  fetchProcesses: () => Promise<void>;
  fetchNodes: (processId: string) => Promise<void>;
  fetchConnections: (processId: string) => Promise<void>;
  fetchRuns: (processId: string) => Promise<void>;
  fetchEvents: (processId: string, runId: string) => Promise<void>;

  addProcess: (process: Process) => void;
  updateProcess: (process: Process) => void;
  removeProcess: (processId: string) => void;

  setNodes: (processId: string, nodes: ProcessNode[]) => void;
  setConnections: (processId: string, connections: ProcessNodeConnection[]) => void;
}

export const useProcessStore = create<ProcessState>()((set) => ({
  processes: [],
  loading: false,
  nodes: {},
  connections: {},
  runs: {},
  events: {},

  fetchProcesses: async () => {
    set({ loading: true });
    try {
      const processes = await processApi.listProcesses();
      set({ processes, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchNodes: async (processId: string) => {
    try {
      const nodes = await processApi.listNodes(processId);
      set((s) => ({ nodes: { ...s.nodes, [processId]: nodes } }));
    } catch { /* ignore */ }
  },

  fetchConnections: async (processId: string) => {
    try {
      const connections = await processApi.listConnections(processId);
      set((s) => ({ connections: { ...s.connections, [processId]: connections } }));
    } catch { /* ignore */ }
  },

  fetchRuns: async (processId: string) => {
    try {
      const runs = await processApi.listRuns(processId);
      set((s) => ({ runs: { ...s.runs, [processId]: runs } }));
    } catch { /* ignore */ }
  },

  fetchEvents: async (processId: string, runId: string) => {
    try {
      const events = await processApi.listRunEvents(processId, runId);
      set((s) => ({ events: { ...s.events, [runId]: events } }));
    } catch { /* ignore */ }
  },

  addProcess: (process) => set((s) => ({ processes: [process, ...s.processes] })),
  updateProcess: (process) => set((s) => ({
    processes: s.processes.map((p) => p.process_id === process.process_id ? process : p),
  })),
  removeProcess: (processId) => set((s) => ({
    processes: s.processes.filter((p) => p.process_id !== processId),
  })),

  setNodes: (processId, nodes) => set((s) => ({ nodes: { ...s.nodes, [processId]: nodes } })),
  setConnections: (processId, connections) =>
    set((s) => ({ connections: { ...s.connections, [processId]: connections } })),
}));
