//! Workspace path / harness session resolution for project tools.

use std::time::Duration;

use aura_os_core::{AgentInstance, AgentInstanceId, HarnessMode, ProjectId};
use aura_os_harness::SessionConfig;

use crate::error::ApiResult;
use crate::handlers::agents::build_harness_provider_config;
use crate::handlers::agents::chat::build_project_system_prompt;
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

/// Default agentic-step ceiling for project-tool LLM sessions
/// (spec generation, spec summary, task extraction).
///
/// Without a cap, a degenerate model can loop on read-only tools
/// (e.g. `list_specs`) until the JS-side `fetch` trips Node's default
/// 5 minute `headersTimeout` and surfaces as the cryptic `fetch failed`.
/// Healthy spec-gen runs in this codebase complete in ~14 tool calls
/// (see the SWE-bench astropy__astropy-12907 trace at
/// `infra/evals/local-stack/.runtime/logs/aura-os.log`), and the
/// existing harness-session-runner already defaults to 16 turns
/// for ad-hoc CLI sessions. 40 leaves comfortable headroom for the
/// chained spec → tasks workflow on real benchmarks while still
/// cutting off a runaway in well under 4 minutes at the observed
/// ~3 s/call cadence.
const DEFAULT_PROJECT_TOOL_MAX_TURNS: u32 = 40;

/// Default wall-clock deadline for project-tool LLM sessions.
///
/// Strictly less than Node's undici `headersTimeout` (300 s) so the
/// server is the one that fails first on a stalled session and the
/// JS client gets a typed HTTP error instead of `TypeError: fetch
/// failed`.
const DEFAULT_PROJECT_TOOL_DEADLINE_SECS: u64 = 240;

/// Pure parser for the `AURA_PROJECT_TOOL_MAX_TURNS` env value. Empty /
/// non-numeric / zero values fall back to the default rather than
/// disabling the cap. Split out from [`project_tool_max_turns`] so the
/// parsing rules are unit-testable without mutating process env state.
fn parse_project_tool_max_turns(raw: Option<&str>) -> u32 {
    raw.and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_PROJECT_TOOL_MAX_TURNS)
}

/// Pure parser for the `AURA_PROJECT_TOOL_DEADLINE_SECS` env value.
/// Same fall-back rules as [`parse_project_tool_max_turns`].
fn parse_project_tool_deadline(raw: Option<&str>) -> Duration {
    let secs = raw
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_PROJECT_TOOL_DEADLINE_SECS);
    Duration::from_secs(secs)
}

/// Read `AURA_PROJECT_TOOL_MAX_TURNS`, defaulting to
/// [`DEFAULT_PROJECT_TOOL_MAX_TURNS`]. Empty / non-numeric / zero
/// values fall back to the default rather than disabling the cap.
pub(crate) fn project_tool_max_turns() -> u32 {
    parse_project_tool_max_turns(std::env::var("AURA_PROJECT_TOOL_MAX_TURNS").ok().as_deref())
}

/// Read `AURA_PROJECT_TOOL_DEADLINE_SECS`, defaulting to
/// [`DEFAULT_PROJECT_TOOL_DEADLINE_SECS`]. Empty / non-numeric / zero
/// values fall back to the default rather than disabling the cap.
pub(crate) fn project_tool_deadline() -> Duration {
    parse_project_tool_deadline(
        std::env::var("AURA_PROJECT_TOOL_DEADLINE_SECS")
            .ok()
            .as_deref(),
    )
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
///
/// Mirrors the structural shape of the desktop chat session built in
/// [`crate::handlers::agents::chat::instance_route::send_event_stream`]:
/// the project-aware `system_prompt` and the harness `provider_config`
/// must be present so the LLM request signature matches the working
/// chat path. Without them, the SWE-bench eval pipeline was hitting
/// recurring Cloudflare 403s on the post-tool-result LLM call when
/// running spec-gen / task-extract under Swarm.
pub(crate) async fn project_tool_session_config(
    state: &AppState,
    project_id: &ProjectId,
    tool_agent_name: &'static str,
    harness_mode: HarnessMode,
    agent_instance_id: Option<AgentInstanceId>,
    jwt: &str,
    user_id: Option<&str>,
) -> ApiResult<SessionConfig> {
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
    // Mirror the chat path: build the same `<project_context>` block +
    // template prompt the agent instance gets on the chat surface so the
    // first LLM call has identical structure (system prompt, provider
    // config, tools). Without this, the harness sent a structurally
    // different request that the upstream proxy was 403-ing under load.
    let agent_template_prompt = agent_instance
        .as_ref()
        .map(|instance| instance.system_prompt.as_str())
        .unwrap_or("");
    let system_prompt = Some(build_project_system_prompt(
        state,
        project_id,
        agent_template_prompt,
        project_path.as_deref(),
    ));
    let auth_source = agent_instance
        .as_ref()
        .map(|instance| instance.auth_source.as_str())
        .unwrap_or("aura");
    let provider_config =
        build_harness_provider_config(harness_mode, auth_source, None, model.as_deref())?;
    Ok(SessionConfig {
        system_prompt,
        agent_id: agent_id_field,
        template_agent_id: template_agent_id_field,
        agent_name: Some(
            agent_instance
                .as_ref()
                .map(|instance| instance.name.clone())
                .unwrap_or_else(|| tool_agent_name.to_string()),
        ),
        model,
        max_turns: Some(project_tool_max_turns()),
        token: Some(jwt.to_string()),
        user_id: user_id.map(ToString::to_string),
        project_id: Some(project_id.to_string()),
        project_path,
        provider_config,
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
    })
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
    use std::time::Duration;

    use super::{
        first_non_empty_model, parse_project_tool_deadline, parse_project_tool_max_turns,
        DEFAULT_PROJECT_TOOL_DEADLINE_SECS, DEFAULT_PROJECT_TOOL_MAX_TURNS,
    };
    use crate::handlers::agents::chat::{render_project_context, render_project_context_fallback};
    use aura_os_core::ProjectId;

    #[test]
    fn parse_max_turns_uses_explicit_positive_values() {
        assert_eq!(parse_project_tool_max_turns(Some("12")), 12);
        assert_eq!(parse_project_tool_max_turns(Some("  64  ")), 64);
    }

    #[test]
    fn parse_max_turns_falls_back_for_invalid_or_zero_values() {
        assert_eq!(
            parse_project_tool_max_turns(None),
            DEFAULT_PROJECT_TOOL_MAX_TURNS
        );
        assert_eq!(
            parse_project_tool_max_turns(Some("")),
            DEFAULT_PROJECT_TOOL_MAX_TURNS
        );
        assert_eq!(
            parse_project_tool_max_turns(Some("   ")),
            DEFAULT_PROJECT_TOOL_MAX_TURNS
        );
        assert_eq!(
            parse_project_tool_max_turns(Some("abc")),
            DEFAULT_PROJECT_TOOL_MAX_TURNS
        );
        assert_eq!(
            parse_project_tool_max_turns(Some("0")),
            DEFAULT_PROJECT_TOOL_MAX_TURNS
        );
    }

    #[test]
    fn parse_deadline_uses_explicit_positive_values() {
        assert_eq!(
            parse_project_tool_deadline(Some("1")),
            Duration::from_secs(1)
        );
        assert_eq!(
            parse_project_tool_deadline(Some(" 60 ")),
            Duration::from_secs(60)
        );
    }

    #[test]
    fn parse_deadline_falls_back_for_invalid_or_zero_values() {
        let default = Duration::from_secs(DEFAULT_PROJECT_TOOL_DEADLINE_SECS);
        assert_eq!(parse_project_tool_deadline(None), default);
        assert_eq!(parse_project_tool_deadline(Some("")), default);
        assert_eq!(parse_project_tool_deadline(Some("nope")), default);
        assert_eq!(parse_project_tool_deadline(Some("0")), default);
    }

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

    /// `project_tool_session_config` now mirrors the chat path by
    /// composing its `system_prompt` from the same render helpers.
    /// These tests pin the project_context formatting (project_id +
    /// IMPORTANT reminders) so the prompt the LLM sees during spec-gen
    /// and task-extract stays structurally identical to the chat
    /// surface — that's what stops the upstream proxy from 403-ing on
    /// the post-tool-result LLM call. Wiring a full `AppState` for an
    /// end-to-end `build_project_system_prompt` test was deemed too
    /// heavy; testing the rendering helpers it delegates to gives us
    /// the same coverage cheaply.
    #[test]
    fn project_context_renders_id_and_important_reminders() {
        let project_id = ProjectId::new();
        let rendered = render_project_context(
            &project_id,
            "test-project",
            "a project for tests",
            Some("/tmp/workspace"),
        );

        assert!(rendered.contains("<project_context>"));
        assert!(rendered.contains("</project_context>"));
        assert!(
            rendered.contains(&project_id.to_string()),
            "expected project_id in rendered context: {rendered}"
        );
        assert!(
            rendered.contains("project_name: test-project"),
            "expected project name line: {rendered}"
        );
        assert!(
            rendered.contains("workspace: /tmp/workspace"),
            "expected workspace line: {rendered}"
        );
        let important_count = rendered.matches("IMPORTANT:").count();
        assert!(
            important_count >= 3,
            "expected three IMPORTANT reminders, got {important_count}: {rendered}"
        );
    }

    #[test]
    fn project_context_fallback_keeps_id_and_important_reminders() {
        let project_id = ProjectId::new();
        let rendered = render_project_context_fallback(&project_id);

        assert!(rendered.contains("<project_context>"));
        assert!(rendered.contains(&project_id.to_string()));
        assert!(rendered.contains("IMPORTANT:"));
    }
}
