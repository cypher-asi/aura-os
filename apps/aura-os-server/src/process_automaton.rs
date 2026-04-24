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
            },
            Some(jwt),
        )
        .await
        .map(|_| ())
        .map_err(map_automaton_start_error)
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

fn map_automaton_start_error(error: HarnessClientError) -> (StatusCode, Json<ApiError>) {
    match error {
        HarnessClientError::Status { status: 409, .. } => {
            ApiError::conflict("a scheduled process automaton is already running")
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

fn process_trigger_wire(trigger: ProcessRunTrigger) -> &'static str {
    match trigger {
        ProcessRunTrigger::Scheduled => "scheduled",
        ProcessRunTrigger::Manual => "manual",
    }
}

fn is_active_run(status: Option<&str>) -> bool {
    matches!(status, Some("pending" | "running" | "Pending" | "Running"))
}
