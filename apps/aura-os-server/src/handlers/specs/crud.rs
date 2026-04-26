//! CRUD endpoints for `Spec`. The HTTP-facing handlers below delegate
//! to `aura-storage` for persistence and best-effort mirror new/updated
//! specs onto the resolved local workspace.

use std::path::Path as StdPath;

use axum::extract::{Path, Query, State};
use axum::Json;
use tracing::warn;

use aura_os_core::{ProjectId, Spec, SpecId};

use super::super::spec_disk::remove_spec_from_disk;
use super::{
    mirror_spec_best_effort, resolve_spec_workspace, CreateSpecBody, SpecQueryParams,
    UpdateSpecBody,
};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

pub(crate) async fn list_specs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Spec>>> {
    let storage = state.require_storage_client()?;
    let storage_specs = storage
        .list_specs(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing specs: {e}")))?;
    let mut specs: Vec<Spec> = storage_specs
        .into_iter()
        .filter_map(|s| Spec::try_from(s).ok())
        .collect();
    specs.sort_by_key(|s| s.order_index);
    Ok(Json(specs))
}

pub(crate) async fn create_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<SpecQueryParams>,
    Json(req): Json<CreateSpecBody>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
    let markdown_for_disk = req.markdown_contents.clone();
    let created = storage
        .create_spec(
            &project_id.to_string(),
            &jwt,
            &aura_os_storage::CreateSpecRequest {
                title: req.title,
                org_id: None,
                order_index: req.order_index,
                markdown_contents: req.markdown_contents,
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating spec: {e}")))?;
    let spec = Spec::try_from(created).map_err(ApiError::internal)?;

    if let Some(workspace_root) =
        resolve_spec_workspace(&state, &project_id, params.agent_instance_id).await
    {
        let markdown = markdown_for_disk.unwrap_or_default();
        mirror_spec_best_effort(&workspace_root, None, &spec.title, &markdown).await;
    }

    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "spec_saved",
        "project_id": project_id.to_string(),
        "spec": spec,
        "spec_id": spec.spec_id.to_string(),
    }));
    Ok(Json(spec))
}

pub(crate) async fn get_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;
    let storage_spec =
        storage
            .get_spec(&spec_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("spec not found")
                }
                _ => ApiError::internal(format!("fetching spec: {e}")),
            })?;
    let spec = Spec::try_from(storage_spec).map_err(ApiError::internal)?;
    Ok(Json(spec))
}

pub(crate) async fn update_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
    Query(params): Query<SpecQueryParams>,
    Json(req): Json<UpdateSpecBody>,
) -> ApiResult<Json<Spec>> {
    let storage = state.require_storage_client()?;

    let old_title = storage
        .get_spec(&spec_id.to_string(), &jwt)
        .await
        .ok()
        .and_then(|s| Spec::try_from(s).ok())
        .map(|s| s.title);

    let markdown_for_disk = req.markdown_contents.clone();
    storage
        .update_spec(
            &spec_id.to_string(),
            &jwt,
            &aura_os_storage::types::UpdateSpecRequest {
                title: req.title,
                order_index: req.order_index,
                markdown_contents: req.markdown_contents,
            },
        )
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("spec not found")
            }
            aura_os_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(format!("updating spec: {e}")),
        })?;

    let storage_spec =
        storage
            .get_spec(&spec_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("spec not found")
                }
                _ => ApiError::internal(format!("fetching updated spec: {e}")),
            })?;
    let spec = Spec::try_from(storage_spec).map_err(ApiError::internal)?;

    if let Some(workspace_root) =
        resolve_spec_workspace(&state, &project_id, params.agent_instance_id).await
    {
        // Prefer the markdown from the update payload (the caller's intent);
        // fall back to the authoritative stored value so the file contents are
        // still rewritten on a pure rename.
        let markdown = markdown_for_disk.unwrap_or_else(|| spec.markdown_contents.clone());
        mirror_spec_best_effort(
            &workspace_root,
            old_title.as_deref(),
            &spec.title,
            &markdown,
        )
        .await;
    }

    Ok(Json(spec))
}

pub(crate) async fn delete_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;

    let old_title = storage
        .get_spec(&spec_id.to_string(), &jwt)
        .await
        .ok()
        .and_then(|s| Spec::try_from(s).ok())
        .map(|s| s.title);

    // Block deletion when the spec still has associated tasks so the user gets a
    // clear, actionable error instead of silently orphaning tasks (or relying on
    // undefined upstream cascade behavior).
    let spec_id_str = spec_id.to_string();
    let tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;
    let associated_task_count = tasks
        .iter()
        .filter(|t| t.spec_id.as_deref() == Some(spec_id_str.as_str()))
        .count();
    if associated_task_count > 0 {
        let noun = if associated_task_count == 1 {
            "task"
        } else {
            "tasks"
        };
        return Err(ApiError::conflict(format!(
            "Cannot delete spec: it has {associated_task_count} associated {noun}. \
             Delete or reassign the {noun} first."
        )));
    }

    storage
        .delete_spec(&spec_id_str, &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("spec not found")
            }
            _ => map_storage_error(e),
        })?;

    if let (Some(title), Some(workspace_root)) = (
        old_title,
        resolve_spec_workspace(&state, &project_id, params.agent_instance_id).await,
    ) {
        if let Err(err) = remove_spec_from_disk(StdPath::new(&workspace_root), &title).await {
            warn!(%err, workspace = %workspace_root, "failed to remove spec from disk");
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Flat-path aliases for harness clients
// ---------------------------------------------------------------------------
//
// `aura-storage` exposes `/api/specs/:id` directly and the harness's
// `HttpDomainApi` calls those flat URLs when `AURA_OS_SERVER_URL` is set.
// `get_spec` ignores `_project_id` entirely, so the flat alias just
// re-dispatches with `ProjectId::nil()`. `update_spec` / `delete_spec`
// still rely on `project_id` for on-disk mirroring (and, for delete, the
// "block if tasks exist" guard) — we recover it from the stored spec
// record before delegating, so the harness path keeps the same checks
// even though the URL no longer carries it.

pub(crate) async fn get_spec_flat(
    state: State<AppState>,
    jwt: AuthJwt,
    Path(spec_id): Path<SpecId>,
) -> ApiResult<Json<Spec>> {
    get_spec(state, jwt, Path((ProjectId::nil(), spec_id))).await
}

async fn lookup_spec_project_id(
    state: &AppState,
    jwt: &str,
    spec_id: &SpecId,
) -> ApiResult<ProjectId> {
    let storage = state.require_storage_client()?;
    let spec = storage
        .get_spec(&spec_id.to_string(), jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("spec not found")
            }
            _ => ApiError::internal(format!("fetching spec for project lookup: {e}")),
        })?;
    let pid_str = spec
        .project_id
        .ok_or_else(|| ApiError::internal("spec has no project_id"))?;
    pid_str
        .parse::<ProjectId>()
        .map_err(|e| ApiError::internal(format!("invalid project_id on spec: {e}")))
}

pub(crate) async fn update_spec_flat(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(spec_id): Path<SpecId>,
    Query(params): Query<SpecQueryParams>,
    body: Json<UpdateSpecBody>,
) -> ApiResult<Json<Spec>> {
    let project_id = lookup_spec_project_id(&state, &jwt, &spec_id).await?;
    update_spec(
        State(state),
        AuthJwt(jwt),
        Path((project_id, spec_id)),
        Query(params),
        body,
    )
    .await
}

pub(crate) async fn delete_spec_flat(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(spec_id): Path<SpecId>,
    Query(params): Query<SpecQueryParams>,
) -> ApiResult<axum::http::StatusCode> {
    let project_id = lookup_spec_project_id(&state, &jwt, &spec_id).await?;
    delete_spec(
        State(state),
        AuthJwt(jwt),
        Path((project_id, spec_id)),
        Query(params),
    )
    .await
}
