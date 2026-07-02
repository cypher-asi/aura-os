//! Build the server-contributed `installed_tools` payload shipped to
//! the harness `SessionConfig`.
//!
//! This list is intentionally limited to workspace and integration
//! tools. Capability-gated native agent tools such as `send_to_agent`
//! are owned by the harness catalog and become visible through
//! `visible_tools_with_permissions` using `SessionConfig.agent_permissions`.

use std::collections::HashMap;

use aura_os_agents::{AgentSelfImprovementConfig, AgentSelfImprovementMode};
use aura_os_core::{AgentId, AgentPermissions, OrgId};
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
    pub(super) integrations: Option<&'a [aura_os_core::OrgIntegration]>,
}

/// Build the `installed_tools` payload for a harness chat session.
///
/// The returned manifest is server-tool-only. Cross-agent capabilities
/// are expressed through `SessionConfig.agent_permissions`; the harness
/// uses that bundle to expose its native agent tools.
pub(super) async fn build_session_installed_tools(
    ctx: &InstalledToolsCtx<'_>,
    _permissions: &AgentPermissions,
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

    dedupe_and_log_installed_tools(ctx.context, ctx.agent_id, &mut tools);

    Ok((!tools.is_empty()).then_some(tools))
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

    self_improvement_tool_for_config(&config, ctx.jwt, ctx.template_agent_id)
}

fn self_improvement_tool_for_config(
    config: &AgentSelfImprovementConfig,
    jwt: &str,
    template_agent_id: &str,
) -> Option<InstalledTool> {
    if config.mode == AgentSelfImprovementMode::Off {
        return None;
    }

    let endpoint = format!(
        "{}/api/agents/{}/improvements/propose",
        crate::handlers::agents::workspace_tools::control_plane_api_base_url(),
        template_agent_id
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
        assert!(self_improvement_tool_for_config(&off, "jwt", "agent-1").is_none());

        let propose = AgentSelfImprovementConfig {
            mode: AgentSelfImprovementMode::Propose,
            allow_memory: true,
            allow_skills: true,
            allow_background_review: false,
        };
        let tool = self_improvement_tool_for_config(&propose, "jwt-token", "agent-1")
            .expect("propose mode should install the learning proposal tool");

        assert_eq!(tool.name, "propose_agent_improvement");
        assert_eq!(tool.namespace.as_deref(), Some("aura_learning"));
        assert!(tool
            .endpoint
            .ends_with("/api/agents/agent-1/improvements/propose"));
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
}
