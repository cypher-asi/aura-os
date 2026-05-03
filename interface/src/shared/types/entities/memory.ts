import type { JsonValue } from "./api";

// ---------------------------------------------------------------------------
// Memory entities (harness API)
// ---------------------------------------------------------------------------

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
}

export interface MemorySnapshot {
  facts: MemoryFact[];
  events: MemoryEvent[];
  procedures: MemoryProcedure[];
}

export interface MemoryStats {
  facts: number;
  events: number;
  procedures: number;
}
