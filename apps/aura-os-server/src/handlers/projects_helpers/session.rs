//! Workspace path / harness session resolution for project tools.

use aura_os_core::{AgentInstance, AgentInstanceId, HarnessMode, ProjectId};
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
    user_id: Option<&str>,
) -> SessionConfig {
    let agent_instance = if let Some(agent_instance_id) = agent_instance_id {
        state
            .agent_instance_service
            .get_instance(project_id, &agent_instance_id)
            .await
            .ok()
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
    // Swarm project tools use the normal template::instance partition.
    // Local project tools keep their synthetic per-project partition so
    // spec/task extraction cannot collide with chat/dev-loop turns, but
    // still carry the real template id/model/permissions metadata.
    let agent_id_field = match (harness_mode, agent_instance.as_ref()) {
        (HarnessMode::Swarm, Some(instance)) => Some(aura_os_core::harness_agent_id(
            &instance.agent_id,
            Some(&instance.agent_instance_id),
        )),
        (HarnessMode::Local, _) => Some(format!("{tool_agent_name}-{project_id}")),
        (HarnessMode::Swarm, None) => None,
    };
    let template_agent_id_field = agent_instance
        .as_ref()
        .map(|instance| instance.agent_id.to_string());
    let model = effective_project_tool_model(agent_instance.as_ref());
    let agent_permissions = agent_instance
        .as_ref()
        .map(|instance| {
            instance
                .permissions
                .clone()
                .normalized_for_identity(&instance.name, Some(instance.role.as_str()))
                .into()
        })
        .unwrap_or_default();
    SessionConfig {
        agent_id: agent_id_field,
        template_agent_id: template_agent_id_field,
        agent_name: Some(
            agent_instance
                .as_ref()
                .map(|instance| instance.name.clone())
                .unwrap_or_else(|| tool_agent_name.to_string()),
        ),
        model,
        token: Some(jwt.to_string()),
        user_id: user_id.map(ToString::to_string),
        project_id: Some(project_id.to_string()),
        project_path,
        installed_tools,
        installed_integrations,
        aura_org_id: agent_instance
            .as_ref()
            .and_then(|instance| instance.org_id.as_ref())
            .map(ToString::to_string),
        agent_permissions,
        intent_classifier: agent_instance
            .as_ref()
            .and_then(|instance| instance.intent_classifier.clone()),
        ..Default::default()
    }
}

fn effective_project_tool_model(instance: Option<&AgentInstance>) -> Option<String> {
    instance.and_then(|instance| {
        first_non_empty_model(instance.default_model.as_deref(), instance.model.as_deref())
    })
}

fn first_non_empty_model(default_model: Option<&str>, model: Option<&str>) -> Option<String> {
    default_model
        .into_iter()
        .chain(model)
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::first_non_empty_model;

    #[test]
    fn project_tool_model_prefers_non_empty_default_model() {
        assert_eq!(
            first_non_empty_model(Some(" aura-claude-opus-4-7 "), Some("claude-opus-4-6"))
                .as_deref(),
            Some("aura-claude-opus-4-7")
        );
    }

    #[test]
    fn project_tool_model_falls_back_to_instance_model() {
        assert_eq!(
            first_non_empty_model(Some("  "), Some(" aura-claude-sonnet-4-5 ")).as_deref(),
            Some("aura-claude-sonnet-4-5")
        );
    }
}
