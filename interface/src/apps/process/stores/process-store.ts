import { create } from "zustand";
import type { Process, ProcessFolder, ProcessNode, ProcessNodeConnection, ProcessRun, ProcessEvent } from "../../../types";
import { processApi } from "../../../api/process";

export const LAST_PROCESS_ID_KEY = "aura:lastProcessId";

interface ProcessState {
  processes: Process[];
  folders: ProcessFolder[];
  loading: boolean;
  nodes: Record<string, ProcessNode[]>;
  connections: Record<string, ProcessNodeConnection[]>;
  runs: Record<string, ProcessRun[]>;
  events: Record<string, ProcessEvent[]>;

  fetchProcesses: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  fetchNodes: (processId: string) => Promise<void>;
  fetchConnections: (processId: string) => Promise<void>;
  fetchRuns: (processId: string) => Promise<void>;
  fetchEvents: (processId: string, runId: string) => Promise<void>;

  addProcess: (process: Process) => void;
  updateProcess: (process: Process) => void;
  removeProcess: (processId: string) => void;

  addFolder: (folder: ProcessFolder) => void;
  updateFolder: (folder: ProcessFolder) => void;
  removeFolder: (folderId: string) => void;

  setNodes: (processId: string, nodes: ProcessNode[]) => void;
  setConnections: (processId: string, connections: ProcessNodeConnection[]) => void;
}

export const useProcessStore = create<ProcessState>()((set) => ({
  processes: [],
  folders: [],
  loading: true,
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

  fetchFolders: async () => {
    try {
      const folders = await processApi.listFolders();
      set({ folders });
    } catch { /* ignore */ }
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

  addFolder: (folder) => set((s) => ({ folders: [folder, ...s.folders] })),
  updateFolder: (folder) => set((s) => ({
    folders: s.folders.map((f) => f.folder_id === folder.folder_id ? folder : f),
  })),
  removeFolder: (folderId) => set((s) => ({
    folders: s.folders.filter((f) => f.folder_id !== folderId),
    processes: s.processes.map((p) => p.folder_id === folderId ? { ...p, folder_id: null } : p),
  })),

  setNodes: (processId, nodes) => set((s) => ({ nodes: { ...s.nodes, [processId]: nodes } })),
  setConnections: (processId, connections) =>
    set((s) => ({ connections: { ...s.connections, [processId]: connections } })),
}));
