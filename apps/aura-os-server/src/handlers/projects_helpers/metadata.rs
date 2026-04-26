//! Metadata projection helpers between local [`Project`] shadows and
//! [`NetworkProject`] payloads, plus DTO conversion for create-project
//! requests.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::warn;

use aura_os_core::{OrgId, Project, ProjectId, ProjectStatus};
use aura_os_network::NetworkProject;
use aura_os_projects::CreateProjectInput;

use crate::dto::CreateProjectRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::paths::normalize_optional_path;

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
    Ok(Project {
        project_id: meta.project_id,
        org_id: meta.org_id,
        name: net.name.clone(),
        description: net
            .description
            .clone()
            .or_else(|| local.map(|project| project.description.clone()))
            .unwrap_or_default(),
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
        // Local-only: never sent by aura-network.
        local_workspace_path: local.and_then(|p| p.local_workspace_path.clone()),
    })
}

pub(crate) fn ensure_local_shadow(state: &AppState, project: &Project) {
    if let Err(err) = state.project_service.save_project_shadow(project) {
        warn!(project_id = %project.project_id, error = %err, "Failed to save local project shadow");
    }
}

pub(crate) fn normalize_project_workspace(state: &AppState, project: &Project) -> Project {
    let _ = state;
    project.clone()
}

pub(crate) fn to_project_input(req: &CreateProjectRequest) -> CreateProjectInput {
    CreateProjectInput {
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
        local_workspace_path: normalize_optional_path(&req.local_workspace_path),
    }
}

pub(crate) fn build_local_shadow(project_id: ProjectId, req: &CreateProjectRequest) -> Project {
    Project {
        project_id,
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
        specs_summary: None,
        specs_title: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        git_repo_url: req.git_repo_url.clone(),
        git_branch: req.git_branch.clone(),
        orbit_base_url: req.orbit_base_url.clone(),
        orbit_owner: req.orbit_owner.clone(),
        orbit_repo: req.orbit_repo.clone(),
        local_workspace_path: normalize_optional_path(&req.local_workspace_path),
    }
}
