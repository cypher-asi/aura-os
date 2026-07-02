import type { JsonValue } from "./api";

export type AgentSelfImprovementMode = "off" | "propose";

export interface AgentSelfImprovementConfig {
  mode: AgentSelfImprovementMode;
  allow_memory: boolean;
  allow_skills: boolean;
  allow_background_review: boolean;
}

export type AgentImprovementKind =
  | "memory_fact"
  | "memory_procedure"
  | "skill_create"
  | "skill_update";

export type AgentImprovementStatus =
  | "pending"
  | "applied"
  | "rejected"
  | "failed";

export type AgentImprovementSource = "agent_tool" | "learning_review";

export interface AgentImprovementEvidence {
  session_id?: string | null;
  event_id?: string | null;
  event_type?: string | null;
  quote: string;
  created_at?: string | null;
}

export interface AgentImprovementProvenance {
  source: AgentImprovementSource;
  created_by: string;
  review_id?: string | null;
}

export interface AgentImprovementProposal {
  id: string;
  agent_id: string;
  kind: AgentImprovementKind;
  title: string;
  rationale: string;
  source_session_id?: string | null;
  evidence: AgentImprovementEvidence[];
  provenance: AgentImprovementProvenance;
  dedup_key?: string | null;
  payload: JsonValue;
  status: AgentImprovementStatus;
  error?: string | null;
  created_at: string;
  updated_at: string;
  applied_at?: string | null;
}

export interface ProposeAgentImprovementRequest {
  kind: AgentImprovementKind;
  title: string;
  rationale: string;
  source_session_id?: string | null;
  evidence?: AgentImprovementEvidence[];
  payload: JsonValue;
}

export interface AgentLearningReviewResult {
  review_id: string;
  scanned_sessions: number;
  scanned_events: number;
  created_proposals: number;
  skipped_existing: number;
  limit_reached: boolean;
  proposals: AgentImprovementProposal[];
}
