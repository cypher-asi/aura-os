use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::{ProcessArtifact, ProcessEvent, ProcessRun, ProcessRunTrigger};

use super::common::require_process_storage_client;
use super::conversions::{conv_artifact, conv_event, conv_run};
use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

pub(crate) async fn trigger_process(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<ProcessRun>> {
    let client = require_process_storage_client(&state)?;
    let run = crate::process_automaton::trigger_process_run(
        &state,
        client,
        &id,
        ProcessRunTrigger::Manual,
        &jwt,
    )
    .await?;

    Ok(Json(conv_run(run)))
}

pub(crate) async fn list_runs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessRun>>> {
    let client = require_process_storage_client(&state)?;
    let runs = client
        .list_process_runs(&id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(runs.into_iter().map(conv_run).collect()))
}

pub(crate) async fn get_run(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<ProcessRun>> {
    let client = require_process_storage_client(&state)?;
    let run = client
        .get_process_run(&id, &run_id_str, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(conv_run(run)))
}

pub(crate) async fn cancel_run(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    let client = require_process_storage_client(&state)?;
    crate::process_automaton::cancel_process_run(client, &id, &run_id_str, &jwt).await?;

    Ok(Json(serde_json::json!({ "status": "cancelled" })))
}

pub(crate) async fn list_run_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessEvent>>> {
    let client = require_process_storage_client(&state)?;
    let events = client
        .list_process_run_events(&id, &run_id_str, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(events.into_iter().map(conv_event).collect()))
}

pub(crate) async fn list_run_artifacts(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessArtifact>>> {
    let client = require_process_storage_client(&state)?;
    let artifacts = client
        .list_process_run_artifacts(&id, &run_id_str, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(artifacts.into_iter().map(conv_artifact).collect()))
}

pub(crate) async fn get_artifact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(artifact_id_str): Path<String>,
) -> ApiResult<Json<ProcessArtifact>> {
    let client = require_process_storage_client(&state)?;
    let artifact = client
        .get_process_artifact(&artifact_id_str, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(conv_artifact(artifact)))
}
