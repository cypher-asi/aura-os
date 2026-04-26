//! Workspace path / harness session resolution for project tools.

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId};
use aura_os_harness::SessionConfig;

use crate::handlers::agents::conversions_pub::resolve_workspace_path;
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::AppState;

pub(crate) fn resolve_project_workspace_path_for_machine(
    state: &AppState,
    project_id: &ProjectId,
    project_name: Option<&str>,
    machine_type: &str,
) -> Option<String> {
    let project_local_path = state
        .project_service
        .get_project(project_id)
        .ok()
        .and_then(|p| p.local_workspace_path);
    Some(resolve_workspace_path(
        machine_type,
        project_id,
        &state.data_dir,
        project_name.unwrap_or(""),
        project_local_path.as_deref(),
        None,
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

pub(crate) async fn resolve_project_tool_workspace_path(
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
            let mut tools = installed_workspace_app_tools(state, &project.org_id, jwt).await;
            // Defensive: even though this path only concatenates workspace
            // tools (no cross-agent tools), a malformed integration
            // manifest or an MCP discovery that echoes a legacy name
            // could still produce a duplicate. Funnelling through the
            // shared helper keeps the "tool names must be unique"
            // invariant observable in logs from every entry point.
            dedupe_and_log_installed_tools(
                "project_tool_session",
                &project_id.to_string(),
                &mut tools,
            );
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
                installed_workspace_integrations_for_org_with_token(state, &project.org_id, jwt)
                    .await;
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
