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
  MemoryAccessOptions,
} from "../types";
import { apiFetch } from "./core";

const memoryPath = (agentId: string, suffix = "") =>
  `/api/harness/agents/${encodeURIComponent(agentId)}/memory${suffix}`;

function withMemoryAccess(path: string, access?: MemoryAccessOptions, extra?: URLSearchParams) {
  const query = extra ?? new URLSearchParams();
  if (access?.projectId) query.set("project_id", access.projectId);
  if (access?.includeLegacy) query.set("include_legacy", "true");
  if (access?.scope) query.set("scope", access.scope);
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export const memoryApi = {
  // Facts
  listFacts: (agentId: string, access?: MemoryAccessOptions) =>
    apiFetch<MemoryFact[]>(withMemoryAccess(memoryPath(agentId, "/facts"), access)),
  getFact: (agentId: string, factId: string, access?: MemoryAccessOptions) =>
    apiFetch<MemoryFact>(withMemoryAccess(memoryPath(agentId, `/facts/${factId}`), access)),
  getFactByKey: (agentId: string, key: string, access?: MemoryAccessOptions) =>
    apiFetch<MemoryFact>(withMemoryAccess(memoryPath(agentId, `/facts/by-key/${encodeURIComponent(key)}`), access)),
  createFact: (agentId: string, data: { key: string; value: JsonValue; confidence?: number; importance?: number; continuity?: MemoryContinuity }, access?: MemoryAccessOptions) =>
    apiFetch<MemoryFact>(withMemoryAccess(memoryPath(agentId, "/facts"), access), { method: "POST", body: JSON.stringify(data) }),
  updateFact: (agentId: string, factId: string, data: { key?: string; value?: JsonValue; confidence?: number; importance?: number; source?: MemoryFact["source"]; continuity?: MemoryContinuity }, access?: MemoryAccessOptions) =>
    apiFetch<MemoryFact>(withMemoryAccess(memoryPath(agentId, `/facts/${factId}`), access), { method: "PUT", body: JSON.stringify(data) }),
  deleteFact: (agentId: string, factId: string, access?: MemoryAccessOptions) =>
    apiFetch<void>(withMemoryAccess(memoryPath(agentId, `/facts/${factId}`), access), { method: "DELETE" }),

  // Events
  listEvents: (agentId: string, params?: { limit?: number; since?: string; event_type?: string }, access?: MemoryAccessOptions) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.since) query.set("since", params.since);
    if (params?.event_type) query.set("event_type", params.event_type);
    return apiFetch<MemoryEvent[]>(withMemoryAccess(memoryPath(agentId, "/events"), access, query));
  },
  createEvent: (agentId: string, data: { event_type: string; summary: string; metadata?: JsonValue; importance?: number }, access?: MemoryAccessOptions) =>
    apiFetch<MemoryEvent>(withMemoryAccess(memoryPath(agentId, "/events"), access), { method: "POST", body: JSON.stringify(data) }),
  deleteEvent: (agentId: string, eventId: string, access?: MemoryAccessOptions) =>
    apiFetch<void>(withMemoryAccess(memoryPath(agentId, `/events/${eventId}`), access), { method: "DELETE" }),

  // Procedures
  listProcedures: (agentId: string, params?: { skill?: string; min_relevance?: number }, access?: MemoryAccessOptions) => {
    const query = new URLSearchParams();
    if (params?.skill) query.set("skill", params.skill);
    if (params?.min_relevance != null) query.set("min_relevance", String(params.min_relevance));
    return apiFetch<MemoryProcedure[]>(withMemoryAccess(memoryPath(agentId, "/procedures"), access, query));
  },
  createProcedure: (agentId: string, data: {
    name: string; trigger: string; steps: string[];
    context_constraints?: JsonValue; skill_name?: string; skill_relevance?: number;
    continuity?: MemoryContinuity;
  }, access?: MemoryAccessOptions) =>
    apiFetch<MemoryProcedure>(withMemoryAccess(memoryPath(agentId, "/procedures"), access), {
      method: "POST", body: JSON.stringify(data),
    }),
  updateProcedure: (agentId: string, procId: string, data: {
    name?: string; trigger?: string; steps?: string[];
    context_constraints?: JsonValue; skill_name?: string | null;
    skill_relevance?: number | null; success_rate?: number;
    continuity?: MemoryContinuity;
  }, access?: MemoryAccessOptions) =>
    apiFetch<MemoryProcedure>(withMemoryAccess(memoryPath(agentId, `/procedures/${procId}`), access), {
      method: "PUT", body: JSON.stringify(data),
    }),
  deleteProcedure: (agentId: string, procId: string, access?: MemoryAccessOptions) =>
    apiFetch<void>(withMemoryAccess(memoryPath(agentId, `/procedures/${procId}`), access), { method: "DELETE" }),

  // Aggregate
  getSnapshot: (agentId: string, access?: MemoryAccessOptions) =>
    apiFetch<MemorySnapshot>(withMemoryAccess(memoryPath(agentId), access)),
  getStats: (agentId: string, access?: MemoryAccessOptions) =>
    apiFetch<MemoryStats>(withMemoryAccess(memoryPath(agentId, "/stats"), access)),
  wipeMemory: (agentId: string, access?: MemoryAccessOptions) =>
    apiFetch<void>(withMemoryAccess(memoryPath(agentId), access), { method: "DELETE" }),
  triggerConsolidation: (agentId: string, access?: MemoryAccessOptions) =>
    apiFetch<void>(withMemoryAccess(memoryPath(agentId, "/consolidate"), access), { method: "POST" }),
  getContinuityConfig: (agentId: string) =>
    apiFetch<AgentContinuityConfig>(memoryPath(agentId, "/continuity")),
  updateContinuityConfig: (agentId: string, config: AgentContinuityConfig) =>
    apiFetch<AgentContinuityConfig>(memoryPath(agentId, "/continuity"), {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  getLatestRetrievalTrace: (agentId: string, access?: MemoryAccessOptions) =>
    apiFetch<MemoryRetrievalTrace | null>(withMemoryAccess(memoryPath(agentId, "/retrieval/latest"), access)),
};
