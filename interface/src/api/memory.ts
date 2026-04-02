import type { MemoryFact, MemoryEvent, MemoryProcedure, MemorySnapshot, MemoryStats } from "../types";
import { apiFetch } from "./core";

export const memoryApi = {
  // Facts
  listFacts: (agentId: string) =>
    apiFetch<MemoryFact[]>(`/api/harness/agents/${agentId}/memory/facts`),
  getFact: (agentId: string, factId: string) =>
    apiFetch<MemoryFact>(`/api/harness/agents/${agentId}/memory/facts/${factId}`),
  getFactByKey: (agentId: string, key: string) =>
    apiFetch<MemoryFact>(`/api/harness/agents/${agentId}/memory/facts/by-key/${key}`),
  createFact: (agentId: string, data: { key: string; value: any; confidence?: number; importance?: number }) =>
    apiFetch<MemoryFact>(`/api/harness/agents/${agentId}/memory/facts`, { method: "POST", body: JSON.stringify(data) }),
  updateFact: (agentId: string, factId: string, data: { value?: any; confidence?: number; importance?: number }) =>
    apiFetch<MemoryFact>(`/api/harness/agents/${agentId}/memory/facts/${factId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteFact: (agentId: string, factId: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/memory/facts/${factId}`, { method: "DELETE" }),

  // Events
  listEvents: (agentId: string, params?: { limit?: number; since?: string; event_type?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.since) query.set("since", params.since);
    if (params?.event_type) query.set("event_type", params.event_type);
    const qs = query.toString();
    return apiFetch<MemoryEvent[]>(`/api/harness/agents/${agentId}/memory/events${qs ? `?${qs}` : ""}`);
  },
  createEvent: (agentId: string, data: { event_type: string; summary: string; metadata?: any; importance?: number }) =>
    apiFetch<MemoryEvent>(`/api/harness/agents/${agentId}/memory/events`, { method: "POST", body: JSON.stringify(data) }),
  deleteEvent: (agentId: string, eventId: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/memory/events/${eventId}`, { method: "DELETE" }),

  // Procedures
  listProcedures: (agentId: string) =>
    apiFetch<MemoryProcedure[]>(`/api/harness/agents/${agentId}/memory/procedures`),
  deleteProcedure: (agentId: string, procId: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/memory/procedures/${procId}`, { method: "DELETE" }),

  // Aggregate
  getSnapshot: (agentId: string) =>
    apiFetch<MemorySnapshot>(`/api/harness/agents/${agentId}/memory`),
  getStats: (agentId: string) =>
    apiFetch<MemoryStats>(`/api/harness/agents/${agentId}/memory/stats`),
  wipeMemory: (agentId: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/memory`, { method: "DELETE" }),
  triggerConsolidation: (agentId: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/memory/consolidate`, { method: "POST" }),
};
