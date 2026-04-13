use std::path::{Component, Path as FsPath, PathBuf};

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::warn;

use aura_os_core::{AgentInstanceId, HarnessMode, OrgId, Project, ProjectId, ProjectStatus};
use aura_os_link::SessionConfig;
use aura_os_network::NetworkProject;
use aura_os_projects::CreateProjectInput;

use crate::dto::{CreateProjectRequest, ImportedProjectFile};
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::conversions_pub::resolve_workspace_path;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org,
};
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

pub(crate) fn canonical_workspace_path(
    data_dir: &std::path::Path,
    project_id: &ProjectId,
) -> PathBuf {
    data_dir.join("workspaces").join(project_id.to_string())
}

pub(crate) fn slugify(name: &str) -> String {
    let s = name
        .trim()
        .to_lowercase()
        .replace(char::is_whitespace, "-")
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "");
    if s.is_empty() {
        "unnamed-project".to_string()
    } else {
        s
    }
}

pub(crate) fn resolve_project_workspace_path_for_machine(
    state: &AppState,
    project_id: &ProjectId,
    project_name: Option<&str>,
    machine_type: &str,
) -> Option<String> {
    Some(resolve_workspace_path(
        machine_type,
        project_id,
        &state.data_dir,
        project_name.unwrap_or(""),
    ))
}

pub(crate) async fn resolve_agent_instance_workspace_path(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> Option<String> {
    if let Some(agent_instance_id) = agent_instance_id {
        if let Ok(instance) = state
            .agent_instance_service
            .get_instance(project_id, &agent_instance_id)
            .await
        {
            if let Some(workspace_path) = instance
                .workspace_path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
            {
                return Some(workspace_path.to_string());
            }

            let project = state.project_service.get_project(project_id).ok();
            return resolve_project_workspace_path_for_machine(
                state,
                project_id,
                project.as_ref().map(|project| project.name.as_str()),
                &instance.machine_type,
            );
        }
    }
    None
}

async fn resolve_project_tool_workspace_path(
    state: &AppState,
    project_id: &ProjectId,
    harness_mode: HarnessMode,
    agent_instance_id: Option<AgentInstanceId>,
) -> Option<String> {
    if let Some(path) =
        resolve_agent_instance_workspace_path(state, project_id, agent_instance_id).await
    {
        return Some(path);
    }

    let project = state.project_service.get_project(project_id).ok()?;
    let machine_type = match harness_mode {
        HarnessMode::Local => "local",
        HarnessMode::Swarm => "remote",
    };
    resolve_project_workspace_path_for_machine(
        state,
        project_id,
        Some(project.name.as_str()),
        machine_type,
    )
}

/// Build a standard project tool session config with JWT propagation.
pub(crate) async fn project_tool_session_config(
    state: &AppState,
    project_id: &ProjectId,
    tool_agent_name: &'static str,
    harness_mode: HarnessMode,
    agent_instance_id: Option<AgentInstanceId>,
    jwt: &str,
) -> SessionConfig {
    let remote_instance = if harness_mode == HarnessMode::Swarm {
        if let Some(agent_instance_id) = agent_instance_id {
            state
                .agent_instance_service
                .get_instance(project_id, &agent_instance_id)
                .await
                .ok()
        } else {
            None
        }
    } else {
        None
    };
    let project_path =
        resolve_project_tool_workspace_path(state, project_id, harness_mode, agent_instance_id)
            .await;
    let installed_tools = match state.project_service.get_project(project_id).ok() {
        Some(project) => {
            let tools = installed_workspace_app_tools(state, &project.org_id, jwt).await;
            if tools.is_empty() {
                None
            } else {
                Some(tools)
            }
        }
        None => None,
    };
    let installed_integrations = match state.project_service.get_project(project_id).ok() {
        Some(project) => {
            let integrations =
                installed_workspace_integrations_for_org(state, &project.org_id).await;
            if integrations.is_empty() {
                None
            } else {
                Some(integrations)
            }
        }
        None => None,
    };
    SessionConfig {
        agent_id: if let Some(instance) = remote_instance.as_ref() {
            Some(instance.agent_id.to_string())
        } else if harness_mode == HarnessMode::Local {
            Some(format!("{tool_agent_name}-{project_id}"))
        } else {
            None
        },
        agent_name: Some(
            remote_instance
                .as_ref()
                .map(|instance| instance.name.clone())
                .unwrap_or_else(|| tool_agent_name.to_string()),
        ),
        token: Some(jwt.to_string()),
        project_id: Some(project_id.to_string()),
        project_path,
        installed_tools,
        installed_integrations,
        ..Default::default()
    }
}

pub(super) fn to_project_input(req: &CreateProjectRequest) -> CreateProjectInput {
    CreateProjectInput {
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
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

pub(super) fn build_local_shadow(project_id: ProjectId, req: &CreateProjectRequest) -> Project {
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
    }
}
