use std::sync::Arc;

use aura_os_core::{OrgId, ProjectId};
use aura_os_storage::{StorageClient, StorageProcess, StorageProcessFolder};

use crate::error::{map_network_error, map_storage_error, ApiError, ApiResult};
use crate::handlers::permissions::require_process_edit_permission;
use crate::state::AppState;

/// Resolve the user's org IDs from aura-network.
pub(super) async fn resolve_org_ids(state: &AppState, jwt: &str) -> ApiResult<Vec<String>> {
    let client = state.network_client.as_ref().ok_or_else(|| {
        ApiError::service_unavailable("aura-network is required for remote process proxy")
    })?;
    let orgs = client.list_orgs(jwt).await.map_err(map_network_error)?;
    let ids: Vec<String> = orgs.iter().map(|org| org.id.clone()).collect();
    if ids.is_empty() {
        return Err(ApiError::bad_request(
            "no org memberships are available for remote process proxy",
        ));
    }
    Ok(ids)
}

pub(super) fn require_process_storage_client(state: &AppState) -> ApiResult<&Arc<StorageClient>> {
    state.storage_client.as_ref().ok_or_else(|| {
        ApiError::service_unavailable("aura-storage is required for process functionality")
    })
}

pub(super) fn select_remote_process_org_id(
    project_org_id: Option<String>,
    fallback_org_ids: &[String],
) -> ApiResult<String> {
    if let Some(org_id) = project_org_id.filter(|org_id| org_id != &OrgId::nil().to_string()) {
        return Ok(org_id);
    }
    match fallback_org_ids {
        [org_id] => Ok(org_id.clone()),
        [] => Err(ApiError::bad_request(
            "no org memberships are available for remote process proxy",
        )),
        _ => Err(ApiError::bad_request(
            "could not resolve a single org for remote process proxy; attach the process to a project with a valid org",
        )),
    }
}

/// Resolve org_id from a project's org membership. Falls back only when there
/// is exactly one user org available.
pub(super) fn resolve_org_for_project(
    state: &AppState,
    project_id: &str,
    fallback_org_ids: &[String],
) -> ApiResult<String> {
    let project_org_id = project_id
        .parse::<ProjectId>()
        .ok()
        .and_then(|project_id| state.project_service.get_project(&project_id).ok())
        .map(|project| project.org_id.to_string());
    select_remote_process_org_id(project_org_id, fallback_org_ids)
}

pub(super) async fn list_remote_processes_for_orgs(
    client: &StorageClient,
    org_ids: &[String],
    jwt: &str,
) -> ApiResult<Vec<StorageProcess>> {
    let mut all = Vec::new();
    for org_id in org_ids {
        let list = client
            .list_processes(org_id, jwt)
            .await
            .map_err(map_storage_error)?;
        all.extend(list);
    }
    Ok(all)
}

pub(super) async fn list_remote_process_folders_for_orgs(
    client: &StorageClient,
    org_ids: &[String],
    jwt: &str,
) -> ApiResult<Vec<StorageProcessFolder>> {
    let mut all = Vec::new();
    for org_id in org_ids {
        let list = client
            .list_process_folders(org_id, jwt)
            .await
            .map_err(map_storage_error)?;
        all.extend(list);
    }
    Ok(all)
}

pub(super) fn resolve_remote_folder_org_id(
    request_org_id: Option<&str>,
    org_ids: &[String],
) -> ApiResult<String> {
    if let Some(org_id) = request_org_id {
        if org_ids.iter().any(|candidate| candidate == org_id) {
            return Ok(org_id.to_string());
        }
        return Err(ApiError::forbidden(
            "requested org is not available for remote process folder creation",
        ));
    }

    select_remote_process_org_id(None, org_ids)
}

/// Fetch a remote process and check that the user has edit permission (creator or admin).
pub(super) async fn check_remote_process_edit_permission(
    state: &AppState,
    client: &StorageClient,
    process_id: &str,
    jwt: &str,
    session: &aura_os_core::ZeroAuthSession,
) -> ApiResult<()> {
    let process = client
        .get_process(process_id, jwt)
        .await
        .map_err(map_storage_error)?;
    let org_id = process
        .org_id
        .as_deref()
        .ok_or_else(|| ApiError::forbidden("process has no org"))?;
    let created_by = process.created_by.as_deref().unwrap_or_default();
    require_process_edit_permission(state, org_id, created_by, jwt, session).await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use aura_os_storage::StorageClient;

    use super::{
        require_process_storage_client, resolve_remote_folder_org_id, select_remote_process_org_id,
    };

    #[test]
    fn select_remote_process_org_id_prefers_project_org() {
        let org_id = select_remote_process_org_id(
            Some("11111111-1111-1111-1111-111111111111".to_string()),
            &["22222222-2222-2222-2222-222222222222".to_string()],
        )
        .expect("select org");

        assert_eq!(org_id, "11111111-1111-1111-1111-111111111111");
    }

    #[test]
    fn select_remote_process_org_id_uses_single_fallback_org() {
        let org_id = select_remote_process_org_id(
            None,
            &["22222222-2222-2222-2222-222222222222".to_string()],
        )
        .expect("select org");

        assert_eq!(org_id, "22222222-2222-2222-2222-222222222222");
    }

    #[test]
    fn select_remote_process_org_id_rejects_ambiguous_fallback_orgs() {
        let error = select_remote_process_org_id(
            None,
            &[
                "22222222-2222-2222-2222-222222222222".to_string(),
                "33333333-3333-3333-3333-333333333333".to_string(),
            ],
        )
        .expect_err("ambiguous orgs should fail");

        assert!(error.1 .0.error.contains("could not resolve a single org"));
    }

    #[test]
    fn resolve_remote_folder_org_id_accepts_explicit_membership() {
        let org_id = resolve_remote_folder_org_id(
            Some("22222222-2222-2222-2222-222222222222"),
            &[
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
        )
        .expect("resolve org");

        assert_eq!(org_id, "22222222-2222-2222-2222-222222222222");
    }

    #[test]
    fn resolve_remote_folder_org_id_rejects_non_member_org() {
        let error = resolve_remote_folder_org_id(
            Some("33333333-3333-3333-3333-333333333333"),
            &[
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
        )
        .expect_err("non-member org should fail");

        assert!(error.1 .0.error.contains("requested org is not available"));
    }

    #[tokio::test]
    async fn require_process_storage_client_accepts_public_jwt_clients() {
        let store_dir = tempfile::tempdir().expect("tempdir");
        let store_path = store_dir.path().join("store");
        let mut state = crate::build_app_state(&store_path).expect("build app state");

        state.storage_client = Some(Arc::new(StorageClient::with_base_url(
            "http://localhost:8080",
        )));
        assert!(require_process_storage_client(&state).is_ok());

        state.storage_client = Some(Arc::new(StorageClient::with_base_url_and_token(
            "http://localhost:8080",
            "internal-token",
        )));
        assert!(require_process_storage_client(&state).is_ok());
    }
}
