export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";
export type TaskStatus = "backlog" | "to_do" | "pending" | "ready" | "in_progress" | "blocked" | "done" | "failed";
export type AgentStatus = "idle" | "working" | "blocked" | "stopped" | "error" | "archived";
export type SessionStatus = "active" | "completed" | "failed" | "rolled_over";
export type OrchestrationStatus = "planning" | "executing" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type ArtifactType = "report" | "data" | "media" | "code" | "custom";

export type ProcessNodeType = "ignition" | "action" | "condition" | "artifact" | "delay" | "merge" | "prompt" | "sub_process" | "for_each" | "group";
export type ProcessRunStatus = "pending" | "running" | "completed" | "failed";
export type ProcessRunTrigger = "scheduled" | "manual";
export type ProcessEventStatus = "pending" | "running" | "completed" | "failed" | "skipped";
