import type { JsonValue } from "./api";

// ---------------------------------------------------------------------------
// Memory entities (harness API)
// ---------------------------------------------------------------------------

export type MemoryScope = "agent" | "project" | "user";
export type MemoryStatus = "active" | "pending" | "rejected" | "superseded";
export type MemorySensitivity = "normal" | "sensitive";
export type MemoryWritePolicy = "automatic" | "approval" | "explicit_only";
export type MemoryRetrievalMode = "salience" | "query_aware";

export interface MemoryProvenance {
  session_id?: string;
  excerpt?: string;
  extractor_model?: string;
  project_id?: string;
  user_id?: string;
  contributor_agent_id?: string;
}

export interface MemoryContinuity {
  scope: MemoryScope;
  status: MemoryStatus;
  sensitivity: MemorySensitivity;
  pinned: boolean;
  provenance: MemoryProvenance;
  superseded_by?: string;
}

export interface AgentContinuityConfig {
  use_memory: boolean;
  generate_memory: boolean;
  write_policy: MemoryWritePolicy;
  retrieval_mode: MemoryRetrievalMode;
  allow_user_scope: boolean;
  allow_project_scope: boolean;
}

export interface MemorySelection {
  memory_id: string;
  kind: "fact" | "event" | "procedure";
  score: number;
  relevance: number;
  reason: "current_request" | "durable_salience" | string;
  scope: MemoryScope;
}

export interface MemoryAccessOptions {
  projectId?: string;
  includeLegacy?: boolean;
  scope?: MemoryScope;
}

export interface MemoryRetrievalTrace {
  candidate_count: number;
  selected_count: number;
  estimated_tokens: number;
  duration_ms: number;
  query_aware: boolean;
  selections: MemorySelection[];
}

export interface MemoryFact {
  fact_id: string;
  agent_id: string;
  key: string;
  value: JsonValue;
  confidence: number;
  source: "extracted" | "user_provided" | "consolidated";
  importance: number;
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
  continuity: MemoryContinuity;
}

export interface MemoryEvent {
  event_id: string;
  agent_id: string;
  event_type: string;
  summary: string;
  metadata: JsonValue;
  importance: number;
  access_count: number;
  last_accessed: string;
  timestamp: string;
  continuity: MemoryContinuity;
}

export interface MemoryProcedure {
  procedure_id: string;
  agent_id: string;
  name: string;
  trigger: string;
  steps: string[];
  context_constraints: JsonValue;
  success_rate: number;
  execution_count: number;
  last_used: string;
  created_at: string;
  updated_at: string;
  skill_name?: string;
  skill_relevance?: number;
  continuity: MemoryContinuity;
}

export interface MemorySnapshot {
  facts: MemoryFact[];
  events: MemoryEvent[];
  procedures: MemoryProcedure[];
  trace?: MemoryRetrievalTrace;
}

export interface MemoryStats {
  facts: number;
  events: number;
  procedures: number;
}
