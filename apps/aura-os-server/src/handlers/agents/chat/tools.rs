//! Build the server-contributed `installed_tools` payload shipped to
//! the harness `SessionConfig`.
//!
//! This list is intentionally limited to server-owned workspace,
//! integration, learning, and project-lifecycle tools. Capability-gated
//! native agent tools such as `send_to_agent` are owned by the harness
//! catalog and become visible through `visible_tools_with_permissions`
//! using `SessionConfig.agent_permissions`.

use std::collections::HashMap;

use aura_os_agents::{AgentSelfImprovementConfig, AgentSelfImprovementMode};
use aura_os_core::{AgentId, AgentPermissions, Capability, OrgId};
use aura_os_harness::{InstalledTool, ToolAuth};
use serde_json::json;

use crate::error::ApiResult;
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::installed_workspace_app_tools;
use crate::state::AppState;

/// Configuration bundle for installed-tool assembly. Avoids the >5
/// parameter limit while keeping the call sites compact.
pub(super) struct InstalledToolsCtx<'a> {
    pub(super) state: &'a AppState,
    pub(super) org_id: Option<&'a OrgId>,
    pub(super) jwt: &'a str,
    pub(super) context: &'static str,
    pub(super) agent_id: &'a str,
    pub(super) template_agent_id: &'a str,
    pub(super) project_id: Option<&'a str>,
    pub(super) source_session_id: Option<&'a str>,
    pub(super) integrations: Option<&'a [aura_os_core::OrgIntegration]>,
}

/// Build the `installed_tools` payload for a harness chat session.
///
/// The returned manifest is server-tool-only. Cross-agent capabilities
/// are expressed through `SessionConfig.agent_permissions`; the harness
/// uses that bundle to expose its native agent tools.
pub(super) async fn build_session_installed_tools(
    ctx: &InstalledToolsCtx<'_>,
    permissions: &AgentPermissions,
) -> ApiResult<Option<Vec<InstalledTool>>> {
    let mut tools = if let Some(org_id) = ctx.org_id {
        match ctx.integrations {
            Some(ints) => {
                crate::handlers::agents::workspace_tools::installed_workspace_app_tools_with_integrations(
                    ctx.state, org_id, ctx.jwt, ints,
                )
                .await
            }
            None => installed_workspace_app_tools(ctx.state, org_id, ctx.jwt).await,
        }
    } else {
        Vec::new()
    };

    if let Some(tool) = self_improvement_tool(ctx) {
        tools.push(tool);
    }
    if let Some(tool) = set_project_workspace_tool(ctx.project_id, ctx.jwt) {
        tools.push(tool);
    }
    tools.extend(project_management_tools(
        ctx.template_agent_id,
        ctx.org_id,
        ctx.source_session_id,
        ctx.jwt,
        permissions,
    ));

    dedupe_and_log_installed_tools(ctx.context, ctx.agent_id, &mut tools);

    Ok((!tools.is_empty()).then_some(tools))
}

fn project_management_tools(
    template_agent_id: &str,
    org_id: Option<&OrgId>,
    source_session_id: Option<&str>,
    jwt: &str,
    permissions: &AgentPermissions,
) -> Vec<InstalledTool> {
    if !permissions
        .capabilities
        .contains(&Capability::WriteAllProjects)
    {
        return Vec::new();
    }

    let base = crate::handlers::agents::workspace_tools::control_plane_api_base_url();
    let mut create_endpoint = format!("{base}/api/agents/{template_agent_id}/projects");
    append_project_tool_query(&mut create_endpoint, org_id, source_session_id);
    let mut access_endpoint = format!("{base}/api/agents/{template_agent_id}/projects/access");
    append_project_tool_query(&mut access_endpoint, org_id, source_session_id);

    let mut metadata = HashMap::new();
    metadata.insert(
        "aura_source_kind".to_string(),
        serde_json::Value::String("aura_native".to_string()),
    );
    metadata.insert(
        "aura_trust_class".to_string(),
        serde_json::Value::String("platform".to_string()),
    );

    vec![
        InstalledTool {
            name: "create_project".to_string(),
            description: "Create an Aura project from this chat, bind this agent to it, and by default copy the current conversation into a project-scoped session. The result includes project_id, agent_instance_id, session_id, chat_route, and project_route. Continue work from the returned route/session before using project-scoped spec, task, or execution tools.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Project name."
                    },
                    "description": {
                        "type": "string",
                        "description": "Concise project purpose and the agreed scope from the conversation."
                    },
                    "build_command": {
                        "type": "string",
                        "description": "Optional build command when already known."
                    },
                    "test_command": {
                        "type": "string",
                        "description": "Optional test command when already known."
                    },
                    "move_current_conversation": {
                        "type": "boolean",
                        "default": true,
                        "description": "Copy this chat into the new project's session."
                    }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
            endpoint: create_endpoint,
            auth: ToolAuth::Bearer {
                token: jwt.to_string(),
            },
            timeout_ms: Some(60_000),
            namespace: Some("aura_project".to_string()),
            required_integration: None,
            runtime_execution: None,
            metadata: metadata.clone(),
        },
        InstalledTool {
            name: "access_project".to_string(),
            description: "Bind this agent to an existing Aura project and, by default, copy the current conversation into a project-scoped session. Use list_projects first to resolve the project_id. The result includes the canonical project/agent/session ids plus chat_route and project_route; continue there before using project-scoped spec, task, or execution tools.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project_id": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Existing Aura project UUID from list_projects."
                    },
                    "move_current_conversation": {
                        "type": "boolean",
                        "default": true,
                        "description": "Copy this chat into a new session under the selected project."
                    }
                },
                "required": ["project_id"],
                "additionalProperties": false
            }),
            endpoint: access_endpoint,
            auth: ToolAuth::Bearer {
                token: jwt.to_string(),
            },
            timeout_ms: Some(60_000),
            namespace: Some("aura_project".to_string()),
            required_integration: None,
            runtime_execution: None,
            metadata,
        },
    ]
}

fn append_project_tool_query(
    endpoint: &mut String,
    org_id: Option<&OrgId>,
    source_session_id: Option<&str>,
) {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    if let Some(org_id) = org_id {
        query.append_pair("org_id", &org_id.to_string());
    }
    if let Some(source_session_id) = source_session_id.filter(|value| !value.trim().is_empty()) {
        query.append_pair("source_session_id", source_session_id);
    }
    let query = query.finish();
    if !query.is_empty() {
        endpoint.push('?');
        endpoint.push_str(&query);
    }
}

fn set_project_workspace_tool(project_id: Option<&str>, jwt: &str) -> Option<InstalledTool> {
    let project_id = project_id?.trim();
    if project_id.is_empty() {
        return None;
    }

    let endpoint = format!(
        "{}/api/projects/{project_id}/workspace",
        crate::handlers::agents::workspace_tools::control_plane_api_base_url()
    );
    let mut metadata = HashMap::new();
    metadata.insert(
        "aura_source_kind".to_string(),
        serde_json::Value::String("aura_native".to_string()),
    );
    metadata.insert(
        "aura_trust_class".to_string(),
        serde_json::Value::String("platform".to_string()),
    );

    Some(InstalledTool {
        name: "set_project_workspace".to_string(),
        description: "Set the current project's local workspace folder on this Aura Desktop machine. Pass an absolute OS path to attach a folder, or null to clear the custom folder and return to the project default.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "local_workspace_path": {
                    "description": "Absolute local folder path, or null to clear the custom workspace override.",
                    "oneOf": [
                        { "type": "string", "minLength": 1 },
                        { "type": "null" }
                    ]
                }
            },
            "required": ["local_workspace_path"],
            "additionalProperties": false
        }),
        endpoint,
        auth: ToolAuth::Bearer {
            token: jwt.to_string(),
        },
        timeout_ms: Some(15_000),
        namespace: Some("aura_project".to_string()),
        required_integration: None,
        runtime_execution: None,
        metadata,
    })
}

fn self_improvement_tool(ctx: &InstalledToolsCtx<'_>) -> Option<InstalledTool> {
    let agent_id = ctx.template_agent_id.parse::<AgentId>().ok()?;
    let config = ctx
        .state
        .agent_service
        .load_agent_self_improvement_config(&agent_id)
        .ok()?;
    if config.mode == AgentSelfImprovementMode::Off {
        return None;
    }

    self_improvement_tool_for_config(&config, ctx.jwt, ctx.template_agent_id, ctx.project_id)
}

fn self_improvement_tool_for_config(
    config: &AgentSelfImprovementConfig,
    jwt: &str,
    template_agent_id: &str,
    project_id: Option<&str>,
) -> Option<InstalledTool> {
    if config.mode == AgentSelfImprovementMode::Off {
        return None;
    }

    let mut endpoint = format!(
        "{}/api/agents/{}/improvements/propose",
        crate::handlers::agents::workspace_tools::control_plane_api_base_url(),
        template_agent_id
    );
    if let Some(project_id) = project_id.filter(|value| !value.trim().is_empty()) {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("project_id", project_id)
            .finish();
        endpoint.push('?');
        endpoint.push_str(&query);
    }
    let mut metadata = HashMap::new();
    metadata.insert(
        "aura_source_kind".to_string(),
        serde_json::Value::String("aura_native".to_string()),
    );
    metadata.insert(
        "aura_trust_class".to_string(),
        serde_json::Value::String("platform".to_string()),
    );
    metadata.insert(
        "aura_self_improvement_mode".to_string(),
        serde_json::Value::String("propose".to_string()),
    );

    Some(InstalledTool {
        name: "propose_agent_improvement".to_string(),
        description: "Stage a durable self-improvement proposal for this agent. Use it only for lessons, workflow updates, memory facts, or skill changes that should persist beyond the current conversation. Include concise evidence when available. The proposal waits for user approval before it changes memory or skills.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["memory_fact", "memory_procedure", "skill_create", "skill_update"],
                    "description": "The durable target to improve."
                },
                "title": {
                    "type": "string",
                    "description": "Short label for the proposed improvement."
                },
                "rationale": {
                    "type": "string",
                    "description": "Why this should persist for future work."
                },
                "source_session_id": {
                    "type": "string",
                    "description": "Optional session id that produced the lesson."
                },
                "evidence": {
                    "type": "array",
                    "description": "Optional source quotes or event references that justify the proposal.",
                    "maxItems": 5,
                    "items": {
                        "type": "object",
                        "properties": {
                            "session_id": { "type": "string" },
                            "event_id": { "type": "string" },
                            "event_type": { "type": "string" },
                            "quote": {
                                "type": "string",
                                "description": "Short quote or paraphrase from the conversation that supports the improvement."
                            },
                            "created_at": { "type": "string" }
                        },
                        "required": ["quote"],
                        "additionalProperties": false
                    }
                },
                "payload": {
                    "type": "object",
                    "description": "Payload matching kind. Use JSON numbers from 0.0 to 1.0 for confidence, importance, and skill_relevance; do not use labels such as high or low.",
                    "oneOf": [
                        {
                            "title": "memory_fact",
                            "type": "object",
                            "properties": {
                                "key": {
                                    "type": "string",
                                    "description": "Stable fact lookup key."
                                },
                                "value": {
                                    "description": "Durable fact value to remember."
                                },
                                "confidence": {
                                    "type": "number",
                                    "minimum": 0.0,
                                    "maximum": 1.0
                                },
                                "importance": {
                                    "type": "number",
                                    "minimum": 0.0,
                                    "maximum": 1.0
                                }
                            },
                            "required": ["key", "value"],
                            "additionalProperties": false
                        },
                        {
                            "title": "memory_procedure",
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "trigger": { "type": "string" },
                                "steps": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                },
                                "context_constraints": {},
                                "skill_name": { "type": "string" },
                                "skill_relevance": {
                                    "type": "number",
                                    "minimum": 0.0,
                                    "maximum": 1.0
                                }
                            },
                            "required": ["name", "trigger", "steps"],
                            "additionalProperties": false
                        },
                        {
                            "title": "skill_create",
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "description": { "type": "string" },
                                "body": { "type": "string" },
                                "allowed_tools": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                },
                                "model": { "type": "string" },
                                "context": { "type": "string" },
                                "user_invocable": { "type": "boolean" },
                                "model_invocable": { "type": "boolean" }
                            },
                            "required": ["name", "description"],
                            "additionalProperties": false
                        },
                        {
                            "title": "skill_update",
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "description": { "type": "string" },
                                "body": { "type": "string" },
                                "allowed_tools": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                },
                                "model": { "type": "string" },
                                "context": { "type": "string" },
                                "user_invocable": { "type": "boolean" },
                                "model_invocable": { "type": "boolean" }
                            },
                            "required": ["name", "description"],
                            "additionalProperties": false
                        }
                    ]
                }
            },
            "required": ["kind", "title", "rationale", "payload"],
            "additionalProperties": false
        }),
        endpoint,
        auth: ToolAuth::Bearer {
            token: jwt.to_string(),
        },
        timeout_ms: Some(15_000),
        namespace: Some("aura_learning".to_string()),
        required_integration: None,
        runtime_execution: None,
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_improvement_tool_is_only_emitted_in_propose_mode() {
        let off = AgentSelfImprovementConfig {
            mode: AgentSelfImprovementMode::Off,
            allow_memory: true,
            allow_skills: true,
            allow_background_review: false,
        };
        assert!(self_improvement_tool_for_config(&off, "jwt", "agent-1", None).is_none());

        let propose = AgentSelfImprovementConfig {
            mode: AgentSelfImprovementMode::Propose,
            allow_memory: true,
            allow_skills: true,
            allow_background_review: false,
        };
        let tool =
            self_improvement_tool_for_config(&propose, "jwt-token", "agent-1", Some("project-1"))
                .expect("propose mode should install the learning proposal tool");

        assert_eq!(tool.name, "propose_agent_improvement");
        assert_eq!(tool.namespace.as_deref(), Some("aura_learning"));
        assert!(tool
            .endpoint
            .ends_with("/api/agents/agent-1/improvements/propose?project_id=project-1"));
        assert!(matches!(tool.auth, ToolAuth::Bearer { ref token } if token == "jwt-token"));
        assert_eq!(
            tool.metadata.get("aura_self_improvement_mode"),
            Some(&serde_json::Value::String("propose".to_string()))
        );
        let payload_schema = &tool.input_schema["properties"]["payload"];
        assert_eq!(
            payload_schema["description"],
            serde_json::Value::String(
                "Payload matching kind. Use JSON numbers from 0.0 to 1.0 for confidence, importance, and skill_relevance; do not use labels such as high or low.".to_string()
            )
        );
        assert_eq!(
            payload_schema["oneOf"][0]["properties"]["importance"]["type"],
            serde_json::Value::String("number".to_string())
        );
    }

    #[test]
    fn project_workspace_tool_targets_the_bound_project() {
        let tool = set_project_workspace_tool(Some("project-123"), "jwt-token")
            .expect("project-bound sessions should expose the workspace tool");

        assert_eq!(tool.name, "set_project_workspace");
        assert!(tool
            .endpoint
            .ends_with("/api/projects/project-123/workspace"));
        assert!(matches!(tool.auth, ToolAuth::Bearer { ref token } if token == "jwt-token"));
        assert_eq!(
            tool.input_schema["required"],
            serde_json::json!(["local_workspace_path"])
        );
        assert_eq!(
            tool.input_schema["properties"]["local_workspace_path"]["oneOf"][1]["type"],
            serde_json::Value::String("null".to_string())
        );
        assert!(set_project_workspace_tool(None, "jwt-token").is_none());
    }

    #[test]
    fn project_management_tools_are_permission_gated_and_session_bound() {
        let org_id = OrgId::new();
        let tools = project_management_tools(
            "agent-1",
            Some(&org_id),
            Some("session-1"),
            "jwt-token",
            &AgentPermissions::full_access(),
        );

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "create_project");
        assert_eq!(tools[1].name, "access_project");
        assert!(tools[0].endpoint.contains(&format!("org_id={org_id}")));
        assert!(tools[0].endpoint.contains("source_session_id=session-1"));
        assert_eq!(
            tools[0].input_schema["properties"]["move_current_conversation"]["default"],
            serde_json::Value::Bool(true)
        );
        assert!(matches!(tools[1].auth, ToolAuth::Bearer { ref token } if token == "jwt-token"));

        assert!(project_management_tools(
            "agent-1",
            Some(&org_id),
            Some("session-1"),
            "jwt-token",
            &AgentPermissions::empty(),
        )
        .is_empty());
    }
}
