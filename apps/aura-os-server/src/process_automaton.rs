use aura_os_core::{ProcessRunId, ProcessRunTrigger};
use aura_os_harness::{HarnessAutomatonStartParams, HarnessClient, HarnessClientError};
use aura_os_storage::{
    CreateProcessRunRequest, StorageClient, StorageProcess, StorageProcessRun,
    UpdateProcessRunRequest,
};
use chrono::Utc;

use axum::http::StatusCode;
use axum::Json;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::AppState;

const SCHEDULED_PROCESS_AUTOMATON_KIND: &str = "scheduled_process";

pub(crate) async fn trigger_process_run(
    state: &AppState,
    client: &StorageClient,
    process_id: &str,
    trigger: ProcessRunTrigger,
    jwt: &str,
) -> ApiResult<StorageProcessRun> {
    let process = client
        .get_process(process_id, jwt)
        .await
        .map_err(map_storage_error)?;

    reject_active_run(client, process_id, jwt).await?;

    let trigger_wire = process_trigger_wire(trigger);
    let run_id = ProcessRunId::new().to_string();
    let run = client
        .create_process_run(
            process_id,
            jwt,
            &CreateProcessRunRequest {
                id: Some(run_id.clone()),
                process_id: process_id.to_string(),
                trigger: Some(trigger_wire.to_string()),
                parent_run_id: None,
                input_override: None,
            },
        )
        .await
        .map_err(map_storage_error)?;

    if let Err(error) =
        start_scheduled_process_automaton(state, &process, &run_id, trigger_wire, jwt).await
    {
        mark_run_failed(client, process_id, &run_id, jwt, &error).await;
        return Err(error);
    }

    Ok(run)
}

pub(crate) async fn cancel_process_run(
    client: &StorageClient,
    process_id: &str,
    run_id: &str,
    jwt: &str,
) -> ApiResult<()> {
    let run = client
        .get_process_run(process_id, run_id, jwt)
        .await
        .map_err(map_storage_error)?;

    if !is_active_run(run.status.as_deref()) {
        return Err(ApiError::conflict("process run is not active"));
    }

    client
        .update_process_run(
            process_id,
            run_id,
            jwt,
            &UpdateProcessRunRequest {
                status: Some("cancelled".to_string()),
                error: None,
                completed_at: Some(Some(Utc::now().to_rfc3339())),
                total_input_tokens: None,
                total_output_tokens: None,
                cost_usd: None,
                output: None,
            },
        )
        .await
        .map_err(map_storage_error)?;

    Ok(())
}

async fn reject_active_run(client: &StorageClient, process_id: &str, jwt: &str) -> ApiResult<()> {
    let runs = client
        .list_process_runs(process_id, jwt)
        .await
        .map_err(map_storage_error)?;
    if runs.iter().any(|run| is_active_run(run.status.as_deref())) {
        return Err(ApiError::conflict("a process run is already active"));
    }
    Ok(())
}

async fn start_scheduled_process_automaton(
    state: &AppState,
    process: &StorageProcess,
    run_id: &str,
    trigger: &str,
    jwt: &str,
) -> ApiResult<()> {
    let project_id = process.project_id.as_deref().ok_or_else(|| {
        ApiError::bad_request("process must be attached to a project before it can run")
    })?;
    // Phase 5: thread `aura_org_id` / `aura_session_id` through to
    // the harness so the outbound proxy `/v1/messages` call carries
    // the same `X-Aura-*` identity headers chat / dev-loop
    // automata already send. Without this, scheduled-process runs
    // bucket as anonymous IP-only traffic on aura-router and trip
    // the WAF rule that interactive chat from the same account
    // never reproduces. The org is the project's owning org; the
    // session id derives deterministically from `run_id` so retries
    // for the same logical run share the same router bucket.
    let aura_org_id = process
        .org_id
        .as_deref()
        .map(str::to_string)
        .or_else(|| resolve_project_org_id(state, project_id));
    let aura_session_id = Some(stable_process_run_session_id(&process.id, run_id));
    let auth_token = Some(jwt.to_string());
    let client = HarnessClient::new(state.automaton_client.base_url());

    client
        .start_automaton(
            &HarnessAutomatonStartParams {
                kind: SCHEDULED_PROCESS_AUTOMATON_KIND.to_string(),
                project_id: project_id.to_string(),
                auth_token,
                process_id: Some(process.id.clone()),
                input: Some(serde_json::json!({
                    "process_id": process.id,
                    "run_id": run_id,
                    "trigger": trigger,
                })),
                aura_org_id,
                aura_session_id,
            },
            Some(jwt),
        )
        .await
        .map(|_| ())
        .map_err(|err| map_automaton_start_error(state.harness_ws_slots, err))
}

/// Best-effort lookup of the project's owning org id from the local
/// project cache. Falls back to `None` (so the resulting
/// `aura_org_id` is left unset) when the project isn't shadowed
/// locally — the harness will still accept the request, it just
/// won't carry the per-org bucket on the proxy call.
fn resolve_project_org_id(state: &AppState, project_id: &str) -> Option<String> {
    project_id
        .parse::<aura_os_core::ProjectId>()
        .ok()
        .and_then(|pid| state.project_service.get_project(&pid).ok())
        .map(|project| project.org_id.to_string())
}

/// Deterministic per-(process, run) UUID used as `aura_session_id`
/// for the outbound proxy header. Mirrors the rationale on
/// `dev_loop::start::stable_dev_loop_session_id`: derive from the
/// logical-run identity so retries / restarts of the same run
/// share a router bucket, while concurrent runs of different
/// processes get distinct bucketing.
fn stable_process_run_session_id(process_id: &str, run_id: &str) -> String {
    let payload = format!("aura-os/process-run:{process_id}:{run_id}");
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, payload.as_bytes()).to_string()
}

async fn mark_run_failed(
    client: &StorageClient,
    process_id: &str,
    run_id: &str,
    jwt: &str,
    error: &(StatusCode, Json<ApiError>),
) {
    let message = error.1 .0.error.clone();
    let _ = client
        .update_process_run(
            process_id,
            run_id,
            jwt,
            &UpdateProcessRunRequest {
                status: Some("failed".to_string()),
                error: Some(Some(message)),
                completed_at: Some(Some(Utc::now().to_rfc3339())),
                total_input_tokens: None,
                total_output_tokens: None,
                cost_usd: None,
                output: None,
            },
        )
        .await;
}

fn map_automaton_start_error(
    ws_slots_cap: usize,
    error: HarnessClientError,
) -> (StatusCode, Json<ApiError>) {
    match error {
        HarnessClientError::Status { status: 409, .. } => {
            ApiError::conflict("a scheduled process automaton is already running")
        }
        // Phase 5: map upstream WS-slot exhaustion to the structured
        // `harness_capacity_exhausted` envelope so the scheduled-
        // process surface returns the same 503 shape chat /
        // dev-loop already do. The harness emits 503 with either
        // `code: "capacity_exhausted"` or an opaque body
        // (mirroring `swarm_harness::is_capacity_exhausted_response`
        // for the SwarmHarness path).
        HarnessClientError::Status { status: 503, body } if is_capacity_body(&body) => {
            ApiError::harness_capacity_exhausted(ws_slots_cap)
        }
        HarnessClientError::Status { status, body } => {
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            (
                status,
                Json(ApiError {
                    error: body,
                    code: "harness_error".to_string(),
                    details: None,
                    data: None,
                }),
            )
        }
        other => ApiError::bad_gateway(other.to_string()),
    }
}

/// Heuristic for "this 503 body looks like the harness's WS-slot
/// capacity rejection". Mirrors
/// `swarm_harness::is_capacity_exhausted_response`'s permissive
/// interpretation: an empty / opaque 503 body counts as capacity
/// (the harness never surfaces a different structured 503 today)
/// while a structured body must carry the canonical
/// `capacity_exhausted` code.
fn is_capacity_body(body: &str) -> bool {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return true;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return true;
    };
    let code = parsed.get("code").and_then(|v| v.as_str()).or_else(|| {
        parsed
            .get("error")
            .and_then(|err| err.get("code"))
            .and_then(|v| v.as_str())
    });
    match code {
        Some(c) if c.eq_ignore_ascii_case("capacity_exhausted") => true,
        Some(_) => false,
        None => true,
    }
}

fn process_trigger_wire(trigger: ProcessRunTrigger) -> &'static str {
    match trigger {
        ProcessRunTrigger::Scheduled => "scheduled",
        ProcessRunTrigger::Manual => "manual",
    }
}

fn is_active_run(status: Option<&str>) -> bool {
    matches!(status, Some("pending" | "running" | "Pending" | "Running"))
}
