import { apiFetch } from "./core";
import type {
  Process,
  ProcessNode,
  ProcessNodeConnection,
  ProcessRun,
  ProcessEvent,
} from "../types";
import type { ProcessNodeType } from "../types/enums";

export interface CreateProcessRequest {
  name: string;
  description?: string;
  schedule?: string;
  tags?: string[];
}

export interface UpdateProcessRequest {
  name?: string;
  description?: string;
  schedule?: string;
  tags?: string[];
  enabled?: boolean;
}

export interface CreateNodeRequest {
  node_type: ProcessNodeType;
  label: string;
  agent_id?: string;
  prompt?: string;
  config?: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
}

export interface UpdateNodeRequest {
  label?: string;
  agent_id?: string;
  prompt?: string;
  config?: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
}

export interface CreateConnectionRequest {
  source_node_id: string;
  source_handle?: string;
  target_node_id: string;
  target_handle?: string;
}

export const processApi = {
  // Processes
  listProcesses: () => apiFetch<Process[]>("/api/processes"),
  getProcess: (id: string) => apiFetch<Process>(`/api/processes/${id}`),
  createProcess: (data: CreateProcessRequest) =>
    apiFetch<Process>("/api/processes", { method: "POST", body: JSON.stringify(data) }),
  updateProcess: (id: string, data: UpdateProcessRequest) =>
    apiFetch<Process>(`/api/processes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProcess: (id: string) =>
    apiFetch<void>(`/api/processes/${id}`, { method: "DELETE" }),
  triggerProcess: (id: string) =>
    apiFetch<ProcessRun>(`/api/processes/${id}/trigger`, { method: "POST" }),

  // Nodes
  listNodes: (processId: string) =>
    apiFetch<ProcessNode[]>(`/api/processes/${processId}/nodes`),
  createNode: (processId: string, data: CreateNodeRequest) =>
    apiFetch<ProcessNode>(`/api/processes/${processId}/nodes`, { method: "POST", body: JSON.stringify(data) }),
  updateNode: (processId: string, nodeId: string, data: UpdateNodeRequest) =>
    apiFetch<ProcessNode>(`/api/processes/${processId}/nodes/${nodeId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteNode: (processId: string, nodeId: string) =>
    apiFetch<void>(`/api/processes/${processId}/nodes/${nodeId}`, { method: "DELETE" }),

  // Connections
  listConnections: (processId: string) =>
    apiFetch<ProcessNodeConnection[]>(`/api/processes/${processId}/connections`),
  createConnection: (processId: string, data: CreateConnectionRequest) =>
    apiFetch<ProcessNodeConnection>(`/api/processes/${processId}/connections`, { method: "POST", body: JSON.stringify(data) }),
  deleteConnection: (processId: string, connectionId: string) =>
    apiFetch<void>(`/api/processes/${processId}/connections/${connectionId}`, { method: "DELETE" }),

  // Runs & Events
  listRuns: (processId: string) =>
    apiFetch<ProcessRun[]>(`/api/processes/${processId}/runs`),
  getRun: (processId: string, runId: string) =>
    apiFetch<ProcessRun>(`/api/processes/${processId}/runs/${runId}`),
  listRunEvents: (processId: string, runId: string) =>
    apiFetch<ProcessEvent[]>(`/api/processes/${processId}/runs/${runId}/events`),
};
