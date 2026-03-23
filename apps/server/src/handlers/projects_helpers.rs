use std::path::{Component, Path as FsPath, PathBuf};

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::{debug, warn};

use aura_os_core::{OrgId, Project, ProjectId, ProjectStatus};
use aura_os_network::NetworkProject;
use aura_os_projects::CreateProjectInput;

use crate::dto::{CreateProjectRequest, ImportedProjectFile};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub(crate) struct ListProjectsQuery {
    pub org_id: Option<OrgId>,
}

struct ParsedNetworkMeta {
    project_id: ProjectId,
    org_id: OrgId,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

fn parse_network_ids_and_dates(net: &NetworkProject) -> ApiResult<ParsedNetworkMeta> {
    let project_id = net.id.parse::<ProjectId>().map_err(|e| {
        ApiError::internal(format!("unparseable network project id '{}': {e}", net.id))
    })?;
    let org_id = net.org_id.parse::<OrgId>().map_err(|e| {
        ApiError::internal(format!("unparseable network org id '{}': {e}", net.org_id))
    })?;
    Ok(ParsedNetworkMeta {
        project_id,
        org_id,
        created_at: net
            .created_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
        updated_at: net
            .updated_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
    })
}

fn prefer_network(
    network: &Option<String>,
    local: Option<&Project>,
    local_field: impl Fn(&Project) -> &Option<String>,
) -> Option<String> {
    network
        .clone()
        .or_else(|| local.and_then(|p| local_field(p).clone()))
}

pub(crate) fn project_from_network(
    net: &NetworkProject,
    local: Option<&Project>,
) -> ApiResult<Project> {
    let meta = parse_network_ids_and_dates(net)?;
    let folder = net.folder.clone().unwrap_or_default();
    debug!(
        project_id = %net.id,
        name = %net.name,
        network_folder = ?net.folder,
        resolved_folder = %folder,
        "project_from_network"
    );

    Ok(Project {
        project_id: meta.project_id,
        org_id: meta.org_id,
        name: net.name.clone(),
        description: net
            .description
            .clone()
            .or_else(|| local.map(|project| project.description.clone()))
            .unwrap_or_default(),
        linked_folder_path: local
            .map(|project| project.linked_folder_path.clone())
            .unwrap_or(folder),
        workspace_source: local.and_then(|project| project.workspace_source.clone()),
        workspace_display_path: local.and_then(|project| project.workspace_display_path.clone()),
        requirements_doc_path: local.and_then(|project| project.requirements_doc_path.clone()),
        current_status: local
            .map(|project| project.current_status)
            .unwrap_or(ProjectStatus::Active),
        build_command: local.and_then(|project| project.build_command.clone()),
        test_command: local.and_then(|project| project.test_command.clone()),
        specs_summary: local.and_then(|project| project.specs_summary.clone()),
        specs_title: local.and_then(|project| project.specs_title.clone()),
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        git_repo_url: prefer_network(&net.git_repo_url, local, |p| &p.git_repo_url),
        git_branch: prefer_network(&net.git_branch, local, |p| &p.git_branch),
        orbit_base_url: prefer_network(&net.orbit_base_url, local, |p| &p.orbit_base_url),
        orbit_owner: prefer_network(&net.orbit_owner, local, |p| &p.orbit_owner),
        orbit_repo: prefer_network(&net.orbit_repo, local, |p| &p.orbit_repo),
    })
}

pub(crate) fn ensure_local_shadow(state: &AppState, project: &Project) {
    if let Err(err) = state.project_service.save_project_shadow(project) {
        warn!(project_id = %project.project_id, error = %err, "Failed to save local project shadow");
    }
}

pub(crate) fn folder_name_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
}

fn orbit_create_repo_url(
    base_url: &str,
    owner: &str,
    repo: &str,
    resp: &aura_os_orbit::CreateRepoResponse,
) -> String {
    resp.clone_url
        .clone()
        .or_else(|| resp.git_url.clone())
        .unwrap_or_else(|| {
            let base = base_url.trim_end_matches('/');
            format!("{}/{}/{}.git", base, owner, repo)
        })
}

pub(super) fn should_create_new_orbit_repo(
    git_repo_url: &Option<String>,
    orbit_owner: &Option<String>,
    orbit_repo: &Option<String>,
) -> bool {
    orbit_owner.is_some()
        && orbit_repo.is_some()
        && git_repo_url
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
}

pub(super) fn to_project_input(req: &CreateProjectRequest) -> CreateProjectInput {
    CreateProjectInput {
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
        linked_folder_path: req.linked_folder_path.clone(),
        workspace_source: req.workspace_source.clone(),
        workspace_display_path: req.workspace_display_path.clone(),
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
    }
}

fn sanitize_import_path(relative_path: &str) -> ApiResult<PathBuf> {
    let candidate = FsPath::new(relative_path);
    let mut sanitized = PathBuf::new();

    for component in candidate.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ApiError::bad_request(format!(
                    "invalid imported file path: {relative_path}",
                )));
            }
        }
    }

    if sanitized.as_os_str().is_empty() {
        return Err(ApiError::bad_request(
            "imported files must include a relative path".to_string(),
        ));
    }

    Ok(sanitized)
}

pub(super) async fn write_imported_files(
    workspace_root: &FsPath,
    files: Vec<ImportedProjectFile>,
) -> ApiResult<()> {
    if files.is_empty() {
        return Err(ApiError::bad_request(
            "select at least one file to import".to_string(),
        ));
    }

    for file in files {
        let relative_path = sanitize_import_path(&file.relative_path)?;
        let destination = workspace_root.join(relative_path);
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ApiError::internal(format!(
                    "failed to create imported workspace directories: {e}",
                ))
            })?;
        }

        let contents = base64::engine::general_purpose::STANDARD
            .decode(file.contents_base64)
            .map_err(|e| ApiError::bad_request(format!("invalid imported file contents: {e}",)))?;

        tokio::fs::write(&destination, contents)
            .await
            .map_err(|e| {
                ApiError::internal(format!(
                    "failed to write imported file {}: {e}",
                    destination.display(),
                ))
            })?;
    }

    Ok(())
}

pub(super) fn build_local_shadow(
    project_id: ProjectId,
    req: &CreateProjectRequest,
    orbit: OrbitRepoFields,
) -> Project {
    Project {
        project_id,
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
        linked_folder_path: req.linked_folder_path.clone(),
        workspace_source: req.workspace_source.clone(),
        workspace_display_path: req.workspace_display_path.clone(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
        specs_summary: None,
        specs_title: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        git_repo_url: orbit.git_repo_url,
        git_branch: orbit.git_branch,
        orbit_base_url: orbit.orbit_base_url,
        orbit_owner: orbit.orbit_owner,
        orbit_repo: orbit.orbit_repo,
    }
}

pub(super) struct OrbitRepoFields {
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
}

pub(super) async fn resolve_orbit_repo(
    state: &AppState,
    req: &CreateProjectRequest,
    net_project: &aura_os_network::NetworkProject,
    jwt: &str,
) -> ApiResult<OrbitRepoFields> {
    if !should_create_new_orbit_repo(&req.git_repo_url, &req.orbit_owner, &req.orbit_repo) {
        return Ok(OrbitRepoFields {
            git_repo_url: req.git_repo_url.clone(),
            git_branch: req.git_branch.clone(),
            orbit_base_url: req.orbit_base_url.clone(),
            orbit_owner: req.orbit_owner.clone(),
            orbit_repo: req.orbit_repo.clone(),
        });
    }
    let base_url = state.orbit_base_url.as_deref().ok_or_else(|| {
        ApiError::service_unavailable("Orbit repo creation is not configured (ORBIT_BASE_URL)")
    })?;
    let owner = req.orbit_owner.as_deref().unwrap_or(&net_project.org_id);
    let repo_name = req.orbit_repo.as_deref().unwrap_or(&req.name);
    let created = state
        .orbit_client
        .create_repo(&aura_os_orbit::CreateRepoParams {
            base_url,
            org_id: &net_project.org_id,
            project_id: &net_project.id,
            repo: repo_name,
            description: (!req.description.trim().is_empty()).then_some(req.description.as_str()),
            jwt,
        })
        .await
        .map_err(|err| ApiError::internal(err.message_for_api()))?;
    Ok(OrbitRepoFields {
        git_repo_url: Some(orbit_create_repo_url(
            base_url,
            owner,
            &created.name,
            &created,
        )),
        git_branch: req.git_branch.clone().or_else(|| Some("main".into())),
        orbit_base_url: Some(base_url.to_string()),
        orbit_owner: Some(owner.to_string()),
        orbit_repo: Some(created.name),
    })
}
