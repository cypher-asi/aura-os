export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";
export type TaskStatus = "backlog" | "to_do" | "pending" | "ready" | "in_progress" | "blocked" | "done" | "failed";
export type AgentStatus = "idle" | "working" | "blocked" | "stopped" | "error";
export type SessionStatus = "active" | "completed" | "failed" | "rolled_over";
export type OrchestrationStatus = "planning" | "executing" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type ToolDomain = "project" | "spec" | "task" | "agent" | "execution" | "org" | "billing" | "social" | "monitoring" | "system" | "generation";

export type CronJobRunStatus = "pending" | "running" | "completed" | "failed";
export type CronJobTrigger = "scheduled" | "manual";
export type ArtifactType = "report" | "data" | "media" | "code" | "custom";
