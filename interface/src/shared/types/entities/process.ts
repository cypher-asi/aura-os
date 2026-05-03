import type {
  ArtifactType,
  ProcessNodeType,
  ProcessRunStatus,
  ProcessRunTrigger,
  ProcessEventStatus,
} from "../enums";

// ---------------------------------------------------------------------------
// Process workflow entities
// ---------------------------------------------------------------------------

export interface ProcessFolder {
  folder_id: string;
  org_id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Process {
  process_id: string;
  org_id: string;
  user_id: string;
  project_id?: string | null;
  name: string;
  description: string;
  enabled: boolean;
  folder_id: string | null;
  schedule: string | null;
  tags: string[];
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessNode {
  node_id: string;
  process_id: string;
  node_type: ProcessNodeType;
  label: string;
  agent_id: string | null;
  prompt: string;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
}

export interface ProcessNodeConnection {
  connection_id: string;
  process_id: string;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
}

export interface ProcessRun {
  run_id: string;
  process_id: string;
  status: ProcessRunStatus;
  trigger: ProcessRunTrigger;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  total_input_tokens?: number;
  total_output_tokens?: number;
  cost_usd?: number;
  output?: string | null;
  parent_run_id?: string | null;
  input_override?: string | null;
}

export interface ProcessEventContentBlock {
  type: "text" | "tool_use" | "tool_call_snapshot" | "tool_result" | "thinking";
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  result?: string;
  is_error?: boolean;
}

export interface ProcessEvent {
  event_id: string;
  run_id: string;
  node_id: string;
  process_id: string;
  status: ProcessEventStatus;
  input_snapshot: string;
  output: string;
  started_at: string;
  completed_at: string | null;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  content_blocks?: ProcessEventContentBlock[];
}

export interface ProcessArtifact {
  artifact_id: string;
  process_id: string;
  run_id: string;
  node_id: string;
  artifact_type: ArtifactType;
  name: string;
  file_path: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
  created_at: string;
}
