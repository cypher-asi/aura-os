import type {
  JsonValue,
  MemoryFact,
  MemoryEvent,
  MemoryProcedure,
  MemorySnapshot,
  MemoryStats,
  AgentContinuityConfig,
  MemoryContinuity,
  MemoryRetrievalTrace,
} from "../types";
import { apiFetch } from "./core";

const memoryPath = (agentId: string, suffix = "") =>
  `/api/harness/agents/${encodeURIComponent(agentId)}/memory${suffix}`;

export const memoryApi = {
  // Facts
  listFacts: (agentId: string) =>
    apiFetch<MemoryFact[]>(memoryPath(agentId, "/facts")),
  getFact: (agentId: string, factId: string) =>
    apiFetch<MemoryFact>(memoryPath(agentId, `/facts/${factId}`)),
  getFactByKey: (agentId: string, key: string) =>
    apiFetch<MemoryFact>(memoryPath(agentId, `/facts/by-key/${key}`)),
  createFact: (agentId: string, data: { key: string; value: JsonValue; confidence?: number; importance?: number; continuity?: MemoryContinuity }) =>
    apiFetch<MemoryFact>(memoryPath(agentId, "/facts"), { method: "POST", body: JSON.stringify(data) }),
  updateFact: (agentId: string, factId: string, data: { key?: string; value?: JsonValue; confidence?: number; importance?: number; source?: MemoryFact["source"]; continuity?: MemoryContinuity }) =>
    apiFetch<MemoryFact>(memoryPath(agentId, `/facts/${factId}`), { method: "PUT", body: JSON.stringify(data) }),
  deleteFact: (agentId: string, factId: string) =>
    apiFetch<void>(memoryPath(agentId, `/facts/${factId}`), { method: "DELETE" }),

  // Events
  listEvents: (agentId: string, params?: { limit?: number; since?: string; event_type?: string }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.since) query.set("since", params.since);
    if (params?.event_type) query.set("event_type", params.event_type);
    const qs = query.toString();
    return apiFetch<MemoryEvent[]>(memoryPath(agentId, `/events${qs ? `?${qs}` : ""}`));
  },
  createEvent: (agentId: string, data: { event_type: string; summary: string; metadata?: JsonValue; importance?: number }) =>
    apiFetch<MemoryEvent>(memoryPath(agentId, "/events"), { method: "POST", body: JSON.stringify(data) }),
  deleteEvent: (agentId: string, eventId: string) =>
    apiFetch<void>(memoryPath(agentId, `/events/${eventId}`), { method: "DELETE" }),

  // Procedures
  listProcedures: (agentId: string, params?: { skill?: string; min_relevance?: number }) => {
    const query = new URLSearchParams();
    if (params?.skill) query.set("skill", params.skill);
    if (params?.min_relevance != null) query.set("min_relevance", String(params.min_relevance));
    const qs = query.toString();
    return apiFetch<MemoryProcedure[]>(memoryPath(agentId, `/procedures${qs ? `?${qs}` : ""}`));
  },
  createProcedure: (agentId: string, data: {
    name: string; trigger: string; steps: string[];
    context_constraints?: JsonValue; skill_name?: string; skill_relevance?: number;
    continuity?: MemoryContinuity;
  }) =>
    apiFetch<MemoryProcedure>(memoryPath(agentId, "/procedures"), {
      method: "POST", body: JSON.stringify(data),
    }),
  updateProcedure: (agentId: string, procId: string, data: {
    name?: string; trigger?: string; steps?: string[];
    context_constraints?: JsonValue; skill_name?: string | null;
    skill_relevance?: number | null; success_rate?: number;
    continuity?: MemoryContinuity;
  }) =>
    apiFetch<MemoryProcedure>(memoryPath(agentId, `/procedures/${procId}`), {
      method: "PUT", body: JSON.stringify(data),
    }),
  deleteProcedure: (agentId: string, procId: string) =>
    apiFetch<void>(memoryPath(agentId, `/procedures/${procId}`), { method: "DELETE" }),

  // Aggregate
  getSnapshot: (agentId: string) =>
    apiFetch<MemorySnapshot>(memoryPath(agentId)),
  getStats: (agentId: string) =>
    apiFetch<MemoryStats>(memoryPath(agentId, "/stats")),
  wipeMemory: (agentId: string) =>
    apiFetch<void>(memoryPath(agentId), { method: "DELETE" }),
  triggerConsolidation: (agentId: string) =>
    apiFetch<void>(memoryPath(agentId, "/consolidate"), { method: "POST" }),
  getContinuityConfig: (agentId: string) =>
    apiFetch<AgentContinuityConfig>(memoryPath(agentId, "/continuity")),
  updateContinuityConfig: (agentId: string, config: AgentContinuityConfig) =>
    apiFetch<AgentContinuityConfig>(memoryPath(agentId, "/continuity"), {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  getLatestRetrievalTrace: (agentId: string) =>
    apiFetch<MemoryRetrievalTrace | null>(memoryPath(agentId, "/retrieval/latest")),
};
