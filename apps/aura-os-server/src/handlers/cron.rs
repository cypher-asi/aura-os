use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::info;

use aura_os_core::{
    Artifact, ArtifactId, ArtifactRef, CronJob, CronJobId, CronJobRun, CronJobRunId,
    CronJobTrigger,
};
use chrono::Utc;

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct CreateCronJobRequest {
    pub name: String,
    pub description: Option<String>,
    pub schedule: String,
    pub prompt: String,
    #[serde(default)]
    pub input_artifact_refs: Vec<ArtifactRef>,
    pub max_retries: Option<u32>,
    pub timeout_seconds: Option<u64>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateCronJobRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub schedule: Option<String>,
    pub prompt: Option<String>,
    pub enabled: Option<bool>,
    pub input_artifact_refs: Option<Vec<ArtifactRef>>,
    pub max_retries: Option<u32>,
    pub timeout_seconds: Option<u64>,
}

#[derive(Serialize)]
pub(crate) struct DeleteResponse {
    pub deleted: bool,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub(crate) async fn create_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateCronJobRequest>,
) -> ApiResult<Json<CronJob>> {
    let next_run_at = aura_os_super_agent::scheduler::compute_next_run(&req.schedule)
        .ok_or_else(|| ApiError::bad_request("invalid cron expression"))?;

    let org_id = "default".to_string();
    let user_id = session
        .network_user_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| session.user_id.clone());

    let now = Utc::now();
    let job = CronJob {
        cron_job_id: CronJobId::new(),
        org_id: org_id.parse().unwrap_or_default(),
        user_id,
        name: req.name,
        description: req.description.unwrap_or_default(),
        schedule: req.schedule,
        prompt: req.prompt,
        enabled: true,
        input_artifact_refs: req.input_artifact_refs,
        max_retries: req.max_retries.unwrap_or(1),
        timeout_seconds: req.timeout_seconds.unwrap_or(300),
        last_run_at: None,
        next_run_at: Some(next_run_at),
        created_at: now,
        updated_at: now,
    };

    state
        .super_agent_service
        .cron_store
        .save_job(&job)
        .map_err(ApiError::internal)?;

    info!(cron_job_id = %job.cron_job_id, name = %job.name, "Cron job created");
    Ok(Json(job))
}

pub(crate) async fn list_cron_jobs(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<CronJob>>> {
    let jobs = state
        .super_agent_service
        .cron_store
        .list_jobs()
        .map_err(ApiError::internal)?;
    Ok(Json(jobs))
}

pub(crate) async fn get_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<CronJob>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let job = state
        .super_agent_service
        .cron_store
        .get_job(&cron_job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("cron job not found"))?;

    Ok(Json(job))
}

pub(crate) async fn update_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateCronJobRequest>,
) -> ApiResult<Json<CronJob>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let mut job = state
        .super_agent_service
        .cron_store
        .get_job(&cron_job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("cron job not found"))?;

    if let Some(name) = req.name {
        job.name = name;
    }
    if let Some(description) = req.description {
        job.description = description;
    }
    if let Some(schedule) = req.schedule {
        let next = aura_os_super_agent::scheduler::compute_next_run(&schedule)
            .ok_or_else(|| ApiError::bad_request("invalid cron expression"))?;
        job.schedule = schedule;
        job.next_run_at = Some(next);
    }
    if let Some(prompt) = req.prompt {
        job.prompt = prompt;
    }
    if let Some(enabled) = req.enabled {
        job.enabled = enabled;
    }
    if let Some(refs) = req.input_artifact_refs {
        job.input_artifact_refs = refs;
    }
    if let Some(max_retries) = req.max_retries {
        job.max_retries = max_retries;
    }
    if let Some(timeout_seconds) = req.timeout_seconds {
        job.timeout_seconds = timeout_seconds;
    }

    job.updated_at = Utc::now();

    state
        .super_agent_service
        .cron_store
        .save_job(&job)
        .map_err(ApiError::internal)?;

    Ok(Json(job))
}

pub(crate) async fn delete_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    state
        .super_agent_service
        .cron_store
        .delete_job(&cron_job_id)
        .map_err(ApiError::internal)?;

    Ok(Json(DeleteResponse { deleted: true }))
}

pub(crate) async fn pause_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<CronJob>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let mut job = state
        .super_agent_service
        .cron_store
        .get_job(&cron_job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("cron job not found"))?;

    job.enabled = false;
    job.updated_at = Utc::now();

    state
        .super_agent_service
        .cron_store
        .save_job(&job)
        .map_err(ApiError::internal)?;

    Ok(Json(job))
}

pub(crate) async fn resume_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<CronJob>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let mut job = state
        .super_agent_service
        .cron_store
        .get_job(&cron_job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("cron job not found"))?;

    job.enabled = true;
    job.next_run_at = aura_os_super_agent::scheduler::compute_next_run(&job.schedule);
    job.updated_at = Utc::now();

    state
        .super_agent_service
        .cron_store
        .save_job(&job)
        .map_err(ApiError::internal)?;

    Ok(Json(job))
}

pub(crate) async fn trigger_cron_job(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<CronJobRun>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let job = state
        .super_agent_service
        .cron_store
        .get_job(&cron_job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("cron job not found"))?;

    let run = state
        .super_agent_service
        .cron_executor
        .execute(&job, CronJobTrigger::Manual)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(run))
}

pub(crate) async fn list_cron_runs(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<CronJobRun>>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let runs = state
        .super_agent_service
        .cron_store
        .list_runs_for_job(&cron_job_id)
        .map_err(ApiError::internal)?;

    Ok(Json(runs))
}

pub(crate) async fn get_cron_run(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id)): Path<(String, String)>,
) -> ApiResult<Json<CronJobRun>> {
    let _cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;
    let run_id: CronJobRunId = run_id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid run ID"))?;

    let run = state
        .super_agent_service
        .cron_store
        .get_run(&_cron_job_id, &run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("cron job run not found"))?;

    Ok(Json(run))
}

pub(crate) async fn list_cron_artifacts(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<Artifact>>> {
    let cron_job_id: CronJobId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid cron job ID"))?;

    let artifacts = state
        .super_agent_service
        .cron_store
        .list_artifacts_for_job(&cron_job_id)
        .map_err(ApiError::internal)?;

    Ok(Json(artifacts))
}

pub(crate) async fn get_artifact(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Artifact>> {
    let artifact_id: ArtifactId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid artifact ID"))?;

    let artifact = state
        .super_agent_service
        .cron_store
        .get_artifact(&artifact_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("artifact not found"))?;

    Ok(Json(artifact))
}
