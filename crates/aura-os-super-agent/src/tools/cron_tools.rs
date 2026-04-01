use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use serde_json::json;

use aura_os_core::{ArtifactId, ArtifactRef, CronJob, CronJobId, ToolDomain};

use super::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::cron_store::CronStore;
use crate::executor::CronJobExecutor;
use crate::SuperAgentError;

fn tool_err(action: &str, e: impl std::fmt::Display) -> SuperAgentError {
    SuperAgentError::ToolError(format!("{action}: {e}"))
}

// ---------------------------------------------------------------------------
// 1. CreateCronJobTool
// ---------------------------------------------------------------------------

pub struct CreateCronJobTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for CreateCronJobTool {
    fn name(&self) -> &str {
        "create_cron_job"
    }
    fn description(&self) -> &str {
        "Create a new scheduled cron job that runs automatically on a cron schedule"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Human-readable name for the cron job" },
                "description": { "type": "string", "description": "Description of what the job does" },
                "schedule": { "type": "string", "description": "Cron expression, e.g. '0 0 9 * * *' for daily at 9 AM (6-field with seconds)" },
                "prompt": { "type": "string", "description": "Natural-language instruction for the CEO to execute on each run" },
                "input_artifact_refs": {
                    "type": "array",
                    "description": "Optional references to artifacts from other cron jobs to feed as context",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_cron_job_id": { "type": "string" },
                            "artifact_type": { "type": "string", "enum": ["report", "data", "media", "code", "custom"] },
                            "use_latest": { "type": "boolean" }
                        },
                        "required": ["source_cron_job_id"]
                    }
                },
                "max_retries": { "type": "integer", "description": "Maximum retry attempts (default 1)" },
                "timeout_seconds": { "type": "integer", "description": "Timeout in seconds (default 300)" }
            },
            "required": ["name", "description", "schedule", "prompt"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let name = input["name"]
            .as_str()
            .ok_or_else(|| tool_err("create_cron_job", "name is required"))?;
        let description = input["description"]
            .as_str()
            .ok_or_else(|| tool_err("create_cron_job", "description is required"))?;
        let raw_schedule = input["schedule"]
            .as_str()
            .ok_or_else(|| tool_err("create_cron_job", "schedule is required"))?;
        let schedule = crate::scheduler::normalize_cron_expr(raw_schedule);
        let prompt = input["prompt"]
            .as_str()
            .ok_or_else(|| tool_err("create_cron_job", "prompt is required"))?;

        if schedule.parse::<cron::Schedule>().is_err() {
            return Ok(ToolResult {
                content: json!({ "error": format!("Invalid cron expression: {raw_schedule}") }),
                is_error: true,
            });
        }

        let input_artifact_refs: Vec<ArtifactRef> = input
            .get("input_artifact_refs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let max_retries = input
            .get("max_retries")
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;
        let timeout_seconds = input
            .get("timeout_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(300);

        let now = Utc::now();
        let next_run = crate::scheduler::compute_next_run(&schedule);

        let job = CronJob {
            cron_job_id: CronJobId::new(),
            org_id: ctx.org_id.parse().unwrap_or_default(),
            user_id: ctx.user_id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            schedule,
            prompt: prompt.to_string(),
            enabled: true,
            input_artifact_refs,
            max_retries,
            timeout_seconds,
            last_run_at: None,
            next_run_at: next_run,
            created_at: now,
            updated_at: now,
        };

        self.store
            .save_job(&job)
            .map_err(|e| tool_err("create_cron_job", e))?;

        let next_run_str = job.next_run_at.map(|t| t.to_rfc3339());
        Ok(ToolResult {
            content: json!({
                "cron_job_id": job.cron_job_id.to_string(),
                "name": job.name,
                "schedule": job.schedule,
                "next_run_at": next_run_str,
                "status": "created"
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. ListCronJobsTool
// ---------------------------------------------------------------------------

pub struct ListCronJobsTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for ListCronJobsTool {
    fn name(&self) -> &str {
        "list_cron_jobs"
    }
    fn description(&self) -> &str {
        "List all cron jobs in the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let jobs = self
            .store
            .list_jobs()
            .map_err(|e| tool_err("list_cron_jobs", e))?;

        let items: Vec<serde_json::Value> = jobs
            .iter()
            .map(|j| {
                json!({
                    "cron_job_id": j.cron_job_id.to_string(),
                    "name": j.name,
                    "schedule": j.schedule,
                    "enabled": j.enabled,
                    "last_run_at": j.last_run_at.map(|t| t.to_rfc3339()),
                    "next_run_at": j.next_run_at.map(|t| t.to_rfc3339()),
                })
            })
            .collect();

        Ok(ToolResult {
            content: json!({ "jobs": items, "count": items.len() }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 3. UpdateCronJobTool
// ---------------------------------------------------------------------------

pub struct UpdateCronJobTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for UpdateCronJobTool {
    fn name(&self) -> &str {
        "update_cron_job"
    }
    fn description(&self) -> &str {
        "Update an existing cron job's configuration"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job to update" },
                "name": { "type": "string" },
                "description": { "type": "string" },
                "schedule": { "type": "string" },
                "prompt": { "type": "string" },
                "enabled": { "type": "boolean" },
                "input_artifact_refs": { "type": "array" },
                "max_retries": { "type": "integer" },
                "timeout_seconds": { "type": "integer" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("update_cron_job", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("update_cron_job", e))?;

        let mut job = self
            .store
            .get_job(&job_id)
            .map_err(|e| tool_err("update_cron_job", e))?
            .ok_or_else(|| tool_err("update_cron_job", "Job not found"))?;

        if let Some(v) = input.get("name").and_then(|v| v.as_str()) {
            job.name = v.to_string();
        }
        if let Some(v) = input.get("description").and_then(|v| v.as_str()) {
            job.description = v.to_string();
        }
        if let Some(v) = input.get("schedule").and_then(|v| v.as_str()) {
            let normalized = crate::scheduler::normalize_cron_expr(v);
            if normalized.parse::<cron::Schedule>().is_err() {
                return Ok(ToolResult {
                    content: json!({ "error": format!("Invalid cron expression: {v}") }),
                    is_error: true,
                });
            }
            job.schedule = normalized;
            job.next_run_at = crate::scheduler::compute_next_run(&job.schedule);
        }
        if let Some(v) = input.get("prompt").and_then(|v| v.as_str()) {
            job.prompt = v.to_string();
        }
        if let Some(v) = input.get("enabled").and_then(|v| v.as_bool()) {
            job.enabled = v;
        }
        if let Some(refs) = input
            .get("input_artifact_refs")
            .and_then(|v| serde_json::from_value::<Vec<ArtifactRef>>(v.clone()).ok())
        {
            job.input_artifact_refs = refs;
        }
        if let Some(v) = input.get("max_retries").and_then(|v| v.as_u64()) {
            job.max_retries = v as u32;
        }
        if let Some(v) = input.get("timeout_seconds").and_then(|v| v.as_u64()) {
            job.timeout_seconds = v;
        }

        job.updated_at = Utc::now();
        self.store
            .save_job(&job)
            .map_err(|e| tool_err("update_cron_job", e))?;

        Ok(ToolResult {
            content: json!({
                "cron_job_id": job.cron_job_id.to_string(),
                "name": job.name,
                "status": "updated"
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 4. DeleteCronJobTool
// ---------------------------------------------------------------------------

pub struct DeleteCronJobTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for DeleteCronJobTool {
    fn name(&self) -> &str {
        "delete_cron_job"
    }
    fn description(&self) -> &str {
        "Delete a cron job permanently"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job to delete" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("delete_cron_job", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("delete_cron_job", e))?;

        self.store
            .delete_job(&job_id)
            .map_err(|e| tool_err("delete_cron_job", e))?;

        Ok(ToolResult {
            content: json!({ "cron_job_id": id_str, "status": "deleted" }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 5. PauseCronJobTool
// ---------------------------------------------------------------------------

pub struct PauseCronJobTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for PauseCronJobTool {
    fn name(&self) -> &str {
        "pause_cron_job"
    }
    fn description(&self) -> &str {
        "Pause a cron job (set enabled=false)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job to pause" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("pause_cron_job", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("pause_cron_job", e))?;

        let mut job = self
            .store
            .get_job(&job_id)
            .map_err(|e| tool_err("pause_cron_job", e))?
            .ok_or_else(|| tool_err("pause_cron_job", "Job not found"))?;

        job.enabled = false;
        job.updated_at = Utc::now();
        self.store
            .save_job(&job)
            .map_err(|e| tool_err("pause_cron_job", e))?;

        Ok(ToolResult {
            content: json!({ "cron_job_id": id_str, "name": job.name, "status": "paused" }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 6. ResumeCronJobTool
// ---------------------------------------------------------------------------

pub struct ResumeCronJobTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for ResumeCronJobTool {
    fn name(&self) -> &str {
        "resume_cron_job"
    }
    fn description(&self) -> &str {
        "Resume a paused cron job (set enabled=true, recompute next_run_at)"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job to resume" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("resume_cron_job", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("resume_cron_job", e))?;

        let mut job = self
            .store
            .get_job(&job_id)
            .map_err(|e| tool_err("resume_cron_job", e))?
            .ok_or_else(|| tool_err("resume_cron_job", "Job not found"))?;

        job.enabled = true;
        job.next_run_at = crate::scheduler::compute_next_run(&job.schedule);
        job.updated_at = Utc::now();
        self.store
            .save_job(&job)
            .map_err(|e| tool_err("resume_cron_job", e))?;

        Ok(ToolResult {
            content: json!({
                "cron_job_id": id_str,
                "name": job.name,
                "next_run_at": job.next_run_at.map(|t| t.to_rfc3339()),
                "status": "resumed"
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 7. TriggerCronJobTool
// ---------------------------------------------------------------------------

pub struct TriggerCronJobTool {
    pub store: Arc<CronStore>,
    pub executor: Arc<CronJobExecutor>,
}

#[async_trait]
impl SuperAgentTool for TriggerCronJobTool {
    fn name(&self) -> &str {
        "trigger_cron_job"
    }
    fn description(&self) -> &str {
        "Manually trigger a cron job to run immediately"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job to trigger" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("trigger_cron_job", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("trigger_cron_job", e))?;

        let job = self
            .store
            .get_job(&job_id)
            .map_err(|e| tool_err("trigger_cron_job", e))?
            .ok_or_else(|| tool_err("trigger_cron_job", "Job not found"))?;

        let run = self
            .executor
            .execute(&job, aura_os_core::CronJobTrigger::Manual)
            .await
            .map_err(|e| tool_err("trigger_cron_job", e))?;

        Ok(ToolResult {
            content: json!({
                "cron_job_id": id_str,
                "run_id": run.run_id.to_string(),
                "status": format!("{:?}", run.status),
                "started_at": run.started_at.to_rfc3339(),
                "completed_at": run.completed_at.map(|t| t.to_rfc3339()),
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 8. ListCronRunsTool
// ---------------------------------------------------------------------------

pub struct ListCronRunsTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for ListCronRunsTool {
    fn name(&self) -> &str {
        "list_cron_runs"
    }
    fn description(&self) -> &str {
        "List execution runs for a cron job"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("list_cron_runs", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("list_cron_runs", e))?;

        let runs = self
            .store
            .list_runs_for_job(&job_id)
            .map_err(|e| tool_err("list_cron_runs", e))?;

        let items: Vec<serde_json::Value> = runs
            .iter()
            .map(|r| {
                json!({
                    "run_id": r.run_id.to_string(),
                    "status": format!("{:?}", r.status),
                    "trigger": format!("{:?}", r.trigger),
                    "started_at": r.started_at.to_rfc3339(),
                    "completed_at": r.completed_at.map(|t| t.to_rfc3339()),
                    "error": r.error,
                })
            })
            .collect();

        Ok(ToolResult {
            content: json!({ "runs": items, "count": items.len() }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 9. GetArtifactTool
// ---------------------------------------------------------------------------

pub struct GetArtifactTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for GetArtifactTool {
    fn name(&self) -> &str {
        "get_artifact"
    }
    fn description(&self) -> &str {
        "Get a specific artifact by its ID"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "artifact_id": { "type": "string", "description": "ID of the artifact" }
            },
            "required": ["artifact_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["artifact_id"]
            .as_str()
            .ok_or_else(|| tool_err("get_artifact", "artifact_id is required"))?;
        let artifact_id: ArtifactId = id_str
            .parse()
            .map_err(|e| tool_err("get_artifact", e))?;

        let artifact = self
            .store
            .get_artifact(&artifact_id)
            .map_err(|e| tool_err("get_artifact", e))?;

        match artifact {
            Some(a) => Ok(ToolResult {
                content: json!({
                    "artifact_id": a.artifact_id.to_string(),
                    "cron_job_id": a.cron_job_id.to_string(),
                    "run_id": a.run_id.to_string(),
                    "artifact_type": format!("{:?}", a.artifact_type),
                    "name": a.name,
                    "content": a.content,
                    "created_at": a.created_at.to_rfc3339(),
                }),
                is_error: false,
            }),
            None => Ok(ToolResult {
                content: json!({ "error": "Artifact not found" }),
                is_error: true,
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// 10. ListArtifactsTool
// ---------------------------------------------------------------------------

pub struct ListArtifactsTool {
    pub store: Arc<CronStore>,
}

#[async_trait]
impl SuperAgentTool for ListArtifactsTool {
    fn name(&self) -> &str {
        "list_artifacts"
    }
    fn description(&self) -> &str {
        "List all artifacts produced by a cron job"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Cron
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "cron_job_id": { "type": "string", "description": "ID of the cron job" }
            },
            "required": ["cron_job_id"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let id_str = input["cron_job_id"]
            .as_str()
            .ok_or_else(|| tool_err("list_artifacts", "cron_job_id is required"))?;
        let job_id: CronJobId = id_str
            .parse()
            .map_err(|e| tool_err("list_artifacts", e))?;

        let artifacts = self
            .store
            .list_artifacts_for_job(&job_id)
            .map_err(|e| tool_err("list_artifacts", e))?;

        let items: Vec<serde_json::Value> = artifacts
            .iter()
            .map(|a| {
                json!({
                    "artifact_id": a.artifact_id.to_string(),
                    "run_id": a.run_id.to_string(),
                    "artifact_type": format!("{:?}", a.artifact_type),
                    "name": a.name,
                    "created_at": a.created_at.to_rfc3339(),
                })
            })
            .collect();

        Ok(ToolResult {
            content: json!({ "artifacts": items, "count": items.len() }),
            is_error: false,
        })
    }
}
