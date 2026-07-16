//! Workspace path / harness session resolution for project tools.

use std::time::Duration;

use aura_os_core::{AgentInstance, AgentInstanceId, HarnessMode, ProjectId};
use aura_os_harness::{HarnessLink, SessionConfig};

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::{
    build_typed_session_fields, TypedProjectInputs, TypedSessionFields, TypedSessionInputs,
};
use crate::handlers::agents::conversions_pub::resolve_workspace_path;
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};
use crate::handlers::agents::session_model_overrides_with_cache;
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::AppState;

/// Filesystem namespace that owns an agent run's workspace.
///
/// `HarnessMode::Local` describes the direct transport, not filesystem
/// locality: desktop loopback runs are server-local, while Web's deployed
/// direct harness owns a separate filesystem. Swarm always owns its remote
/// workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExecutionWorkspaceAuthority {
    AuraServer,
    HostedHarness,
    Swarm,
}

pub(crate) fn execution_workspace_authority(
    hosted_local_runtime: bool,
    harness_mode: HarnessMode,
) -> ExecutionWorkspaceAuthority {
    match (harness_mode, hosted_local_runtime) {
        (HarnessMode::Local, false) => ExecutionWorkspaceAuthority::AuraServer,
        (HarnessMode::Local, true) => ExecutionWorkspaceAuthority::HostedHarness,
        (HarnessMode::Swarm, _) => ExecutionWorkspaceAuthority::Swarm,
    }
}

pub(crate) async fn server_can_inspect_agent_workspace(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: AgentInstanceId,
) -> bool {
    let Ok(instance) = state
        .agent_instance_service
        .get_instance(project_id, &agent_instance_id)
        .await
    else {
        return false;
    };
    execution_workspace_authority(
        state.harness_http.hosted_local_runtime_available(),
        instance.harness_mode(),
    ) == ExecutionWorkspaceAuthority::AuraServer
}

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

/// Resolve a path that belongs to the aura-os-server filesystem namespace.
///
/// This remains separate from hosted-harness resolution because callers such
/// as spec mirroring perform the filesystem write inside aura-os-server.
pub(crate) async fn resolve_server_local_workspace_path(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> Option<String> {
    // An instance path is safe to reuse only when the instance is executed by
    // the loopback harness. Hosted-local and Swarm paths belong to another
    // filesystem namespace and must never become a server-side write target.
    if let Some(agent_instance_id) = agent_instance_id {
        if server_can_inspect_agent_workspace(state, project_id, agent_instance_id).await {
            if let Ok(instance) = state
                .agent_instance_service
                .get_instance(project_id, &agent_instance_id)
                .await
            {
                if let Some(path) = instance
                    .workspace_path
                    .as_deref()
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                {
                    return Some(path.to_string());
                }
            }
        }
    }

    let project = state.project_service.get_project(project_id).ok()?;
    if state.harness_http.hosted_local_runtime_available() {
        return Some(
            crate::handlers::projects_helpers::canonical_workspace_path(
                &state.data_dir,
                project_id,
            )
            .to_string_lossy()
            .into_owned(),
        );
    }
    resolve_project_workspace_path_for_machine(
        state,
        project_id,
        Some(project.name.as_str()),
        "local",
    )
}

/// Resolve a project path on a separately hosted local harness.
///
/// A hosted harness runs in a different filesystem namespace from
/// `aura-os-server`, so server-local paths such as
/// `/opt/render/.local/share/aura-dev/workspaces/<project-id>` must never be
/// forwarded to it. The harness's `/workspace/resolve` endpoint is the source
/// of truth for the path that its kernel can create and access. The immutable
/// project UUID is deliberately used as the resolver key: project names are
/// mutable and slug-collidable, which could otherwise alias two tenants onto
/// the same hosted workspace.
pub(crate) async fn resolve_hosted_local_workspace_path(
    state: &AppState,
    project_id: &ProjectId,
) -> anyhow::Result<Option<String>> {
    resolve_hosted_workspace_path(
        state.harness_http.hosted_local_runtime_available(),
        state.local_harness.as_ref(),
        &project_id.to_string(),
    )
    .await
}

async fn resolve_hosted_workspace_path(
    hosted_local_runtime: bool,
    harness: &dyn HarnessLink,
    workspace_key: &str,
) -> anyhow::Result<Option<String>> {
    if !hosted_local_runtime {
        return Ok(None);
    }

    let path = harness.resolve_workspace(workspace_key, None).await?;
    let path = path.trim();
    if path.is_empty() {
        anyhow::bail!("hosted harness returned an empty workspace path");
    }
    Ok(Some(path.to_string()))
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

/// Whether `SendChatRequest.action` corresponds to a non-interactive
/// project-tool workflow that should be subject to the same agentic
/// step cap as the dedicated `/specs/generate` and `/tasks/extract`
/// endpoints.
///
/// The benchmark and live-pipeline preflight drivers issue spec
/// generation through the chat instance route with
/// `action: "generate_specs"` (see
/// `interface/scripts/lib/benchmark-api-runner.mjs` and
/// `live-pipeline-preflight.mjs`). Without a cap the LLM can land in
/// the same `list_specs` ↔ `create_spec` loop that previously
/// surfaced as `TypeError: fetch failed` once Node's default
/// `headersTimeout` tripped. Interactive chat actions
/// (`None`, `Some("chat")`, `Some("plan")`) deliberately stay
/// uncapped — long human-in-the-loop conversations need many turns.
pub(crate) fn is_project_tool_action(action: Option<&str>) -> bool {
    match action.map(str::trim) {
        Some(s) => matches!(
            s.to_ascii_lowercase().as_str(),
            "generate_specs" | "regenerate_specs_summary" | "extract_tasks"
        ),
        None => false,
    }
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
) -> ApiResult<Option<String>> {
    if execution_workspace_authority(
        state.harness_http.hosted_local_runtime_available(),
        harness_mode,
    ) == ExecutionWorkspaceAuthority::HostedHarness
    {
        match resolve_hosted_local_workspace_path(state, project_id).await {
            Ok(Some(path)) => return Ok(Some(path)),
            Ok(None) => {}
            Err(error) => {
                // Do not fall back to an aura-os-server path here. A hosted
                // harness cannot access the server's filesystem namespace.
                return Err(ApiError::bad_gateway(format!(
                    "resolving workspace from hosted local harness: {error}"
                )));
            }
        }
    }

    if let Some(path) =
        resolve_agent_instance_workspace_path(state, project_id, agent_instance_id).await
    {
        return Ok(Some(path));
    }

    let Ok(project) = state.project_service.get_project(project_id) else {
        return Ok(None);
    };
    let machine_type = match harness_mode {
        HarnessMode::Local => "local",
        HarnessMode::Swarm => "remote",
    };
    Ok(resolve_project_workspace_path_for_machine(
        state,
        project_id,
        Some(project.name.as_str()),
        machine_type,
    ))
}

/// Build a standard project tool session config with JWT propagation.
///
/// Mirrors the structural shape of the desktop chat session built in
/// [`crate::handlers::agents::chat::instance_route::send_event_stream`]:
/// the project-aware `system_prompt` and the harness `provider_overrides`
/// must be present so the LLM request signature matches the working
/// chat path. Without them, the SWE-bench eval pipeline was hitting
/// recurring Cloudflare 403s on the post-tool-result LLM call when
/// running spec-gen / task-extract under Swarm.
///
/// Tier 1 fail-fast: the returned config is preflighted against
/// [`SessionIdentityRequirements::PROJECT_TOOL`] before being handed
/// back, so call sites cannot accidentally hand the harness a config
/// missing one of the required `X-Aura-*` identity headers.
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
            .await?;
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
            None,
        )),
        (HarnessMode::Local, _) => Some(format!("{tool_agent_name}-{project_id}")),
        (HarnessMode::Swarm, None) => None,
    };
    let template_agent_id_field = agent_instance
        .as_ref()
        .map(|instance| instance.agent_id.to_string());
    // Resolve the model this project-tool session runs on. Agent
    // *instances* frequently carry no model of their own — the chat
    // surface supplies one per turn via the client model picker — so
    // fall back to the parent Agent template's default, and finally to a
    // pinned default. Without this, non-interactive endpoints like
    // `/specs/summary` and `/specs/generate` fail the harness turn with
    // "model name must not be empty".
    let model = effective_project_tool_model(agent_instance.as_ref())
        .or_else(|| {
            agent_instance.as_ref().and_then(|instance| {
                state
                    .agent_service
                    .get_agent_local(&instance.agent_id)
                    .ok()
                    .and_then(|agent| agent.default_model.filter(|value| !value.trim().is_empty()))
            })
        })
        .or_else(|| Some(DEFAULT_PROJECT_TOOL_MODEL.to_string()));
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
    // Mirror the chat path on the wire: forward the typed identity /
    // skills / operator-prompt / project_info bundle so the harness's
    // `SystemPromptBuilder` produces the same
    // `<chat_capabilities>` + `<agent_identity>` + `<agent_skills>` +
    // `<agent_system_prompt>` + `<project_context>` + `<agents_md>`
    // envelope a chat-surface session would. Without identical
    // structure the upstream proxy was 403-ing on the post-tool-result
    // LLM call under load.
    let TypedSessionFields {
        agent_identity,
        agent_skills,
        agent_system_prompt,
        project_info,
    } = build_typed_session_fields(
        state,
        TypedSessionInputs {
            name: agent_instance
                .as_ref()
                .map(|i| i.name.as_str())
                .unwrap_or(""),
            role: agent_instance
                .as_ref()
                .map(|i| i.role.as_str())
                .unwrap_or(""),
            personality: agent_instance
                .as_ref()
                .map(|i| i.personality.as_str())
                .unwrap_or(""),
            skills: agent_instance
                .as_ref()
                .map(|i| i.skills.as_slice())
                .unwrap_or(&[]),
            agent_template_prompt: agent_instance
                .as_ref()
                .map(|i| i.system_prompt.as_str())
                .unwrap_or(""),
            project_state_snapshot: None,
            plan_mode: false,
            project: Some(TypedProjectInputs {
                project_id,
                workspace_path: project_path.as_deref(),
            }),
        },
    );
    let aura_org = agent_instance
        .as_ref()
        .and_then(|instance| instance.org_id.as_ref())
        .cloned()
        .or_else(|| {
            state
                .project_service
                .get_project(project_id)
                .ok()
                .map(|project| project.org_id)
        });
    let provider_overrides = session_model_overrides_with_cache(
        model.as_deref(),
        Some(format!("tool:{project_id}:{tool_agent_name}")),
        Some("24h"),
    );
    let aura_org_id = aura_org.as_ref().map(ToString::to_string);
    let cfg = SessionConfig {
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
        provider_overrides,
        installed_tools,
        installed_integrations,
        aura_org_id,
        aura_session_id: Some(stable_project_tool_session_id(
            project_id,
            agent_instance_id.as_ref(),
            tool_agent_name,
        )),
        agent_permissions,
        intent_classifier: agent_instance
            .as_ref()
            .and_then(|instance| instance.intent_classifier.clone()),
        agent_identity,
        agent_skills,
        agent_system_prompt,
        project_info,
        ..Default::default()
    };

    validate_session_identity(
        &cfg,
        SessionIdentityRequirements::PROJECT_TOOL,
        "project_tool_session",
    )?;

    Ok(cfg)
}

/// Pinned fallback model for non-interactive project-tool sessions
/// (spec generation/summary, etc.) when neither the agent instance nor
/// its parent template pins one. Mirrors the client's default chat
/// model so these server-driven turns never fail with "model name must
/// not be empty" — same pinned-id strategy as `BUG_REPORT_MODEL` and
/// `PUBLIC_DEMO_MODEL`.
const DEFAULT_PROJECT_TOOL_MODEL: &str = "aura-claude-sonnet-4-6";

fn effective_project_tool_model(instance: Option<&AgentInstance>) -> Option<String> {
    instance.and_then(|instance| {
        first_non_empty_model(instance.default_model.as_deref(), instance.model.as_deref())
    })
}

fn stable_project_tool_session_id(
    project_id: &ProjectId,
    agent_instance_id: Option<&AgentInstanceId>,
    tool_agent_name: &str,
) -> String {
    let instance_segment = agent_instance_id
        .map(ToString::to_string)
        .unwrap_or_else(|| "no-agent-instance".to_string());
    let payload = format!("aura-os/project-tool:{project_id}:{instance_segment}:{tool_agent_name}");
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, payload.as_bytes()).to_string()
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use async_trait::async_trait;

    use super::{
        execution_workspace_authority, first_non_empty_model, is_project_tool_action,
        parse_project_tool_deadline, parse_project_tool_max_turns, resolve_hosted_workspace_path,
        stable_project_tool_session_id, ExecutionWorkspaceAuthority,
        DEFAULT_PROJECT_TOOL_DEADLINE_SECS, DEFAULT_PROJECT_TOOL_MAX_TURNS,
    };
    use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId};
    use aura_os_harness::{HarnessLink, HarnessSession, SessionConfig};

    struct WorkspaceResolvingHarness {
        calls: AtomicUsize,
        path: &'static str,
        expected_key: &'static str,
        fail: bool,
    }

    #[async_trait]
    impl HarnessLink for WorkspaceResolvingHarness {
        async fn open_session(&self, _config: SessionConfig) -> anyhow::Result<HarnessSession> {
            anyhow::bail!("not used by workspace resolution tests")
        }

        async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn resolve_workspace(
            &self,
            project_name: &str,
            _auth_token: Option<&str>,
        ) -> anyhow::Result<String> {
            assert_eq!(project_name, self.expected_key);
            self.calls.fetch_add(1, Ordering::Relaxed);
            if self.fail {
                anyhow::bail!("hosted resolver unavailable");
            }
            Ok(self.path.to_string())
        }
    }

    #[test]
    fn workspace_authority_keeps_the_three_execution_lanes_isolated() {
        assert_eq!(
            execution_workspace_authority(false, HarnessMode::Local),
            ExecutionWorkspaceAuthority::AuraServer,
            "desktop/loopback local execution must stay on the Aura server filesystem",
        );
        assert_eq!(
            execution_workspace_authority(true, HarnessMode::Local),
            ExecutionWorkspaceAuthority::HostedHarness,
            "Web local execution must use the deployed Harness filesystem",
        );
        assert_eq!(
            execution_workspace_authority(false, HarnessMode::Swarm),
            ExecutionWorkspaceAuthority::Swarm,
        );
        assert_eq!(
            execution_workspace_authority(true, HarnessMode::Swarm),
            ExecutionWorkspaceAuthority::Swarm,
            "configuring a hosted local Harness must not reroute Swarm agents",
        );
    }

    #[tokio::test]
    async fn hosted_local_workspace_uses_harness_filesystem_path() {
        let harness = WorkspaceResolvingHarness {
            calls: AtomicUsize::new(0),
            path: " /var/data/aura/workspaces/my-project ",
            expected_key: "36d4494f-75df-4c02-84d5-07aef06d2569",
            fail: false,
        };

        let resolved =
            resolve_hosted_workspace_path(true, &harness, "36d4494f-75df-4c02-84d5-07aef06d2569")
                .await
                .expect("resolve hosted workspace");

        assert_eq!(
            resolved.as_deref(),
            Some("/var/data/aura/workspaces/my-project")
        );
        assert_eq!(harness.calls.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn loopback_local_workspace_does_not_query_harness() {
        let harness = WorkspaceResolvingHarness {
            calls: AtomicUsize::new(0),
            path: "/unused",
            expected_key: "unused-because-loopback-does-not-query",
            fail: false,
        };

        let resolved = resolve_hosted_workspace_path(false, &harness, "My Project")
            .await
            .expect("skip hosted workspace resolution");

        assert_eq!(resolved, None);
        assert_eq!(harness.calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn hosted_workspace_resolution_error_is_not_masked_by_a_local_fallback() {
        let harness = WorkspaceResolvingHarness {
            calls: AtomicUsize::new(0),
            path: "/must-not-be-used",
            expected_key: "36d4494f-75df-4c02-84d5-07aef06d2569",
            fail: true,
        };

        let error = resolve_hosted_workspace_path(true, &harness, harness.expected_key)
            .await
            .expect_err("hosted resolver failures must propagate");

        assert!(error.to_string().contains("hosted resolver unavailable"));
        assert_eq!(harness.calls.load(Ordering::Relaxed), 1);
    }

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
    fn is_project_tool_action_recognises_known_tool_flows() {
        assert!(is_project_tool_action(Some("generate_specs")));
        assert!(is_project_tool_action(Some("extract_tasks")));
        assert!(is_project_tool_action(Some("regenerate_specs_summary")));
        // Casing / whitespace tolerance keeps callers from accidentally
        // bypassing the cap by sending uppercase from a UI control.
        assert!(is_project_tool_action(Some("Generate_Specs")));
        assert!(is_project_tool_action(Some("  generate_specs  ")));
    }

    #[test]
    fn is_project_tool_action_leaves_interactive_chat_uncapped() {
        assert!(!is_project_tool_action(None));
        assert!(!is_project_tool_action(Some("")));
        assert!(!is_project_tool_action(Some("chat")));
        assert!(!is_project_tool_action(Some("plan")));
        assert!(!is_project_tool_action(Some("send")));
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

    #[test]
    fn stable_project_tool_session_id_is_deterministic() {
        let project_id = ProjectId::new();
        let instance_id = AgentInstanceId::new();
        let a = stable_project_tool_session_id(&project_id, Some(&instance_id), "task-extract");
        let b = stable_project_tool_session_id(&project_id, Some(&instance_id), "task-extract");
        assert_eq!(a, b);
        uuid::Uuid::parse_str(&a).expect("session id should parse as uuid");
    }

    #[test]
    fn stable_project_tool_session_id_partitions_tool_flows() {
        let project_id = ProjectId::new();
        let instance_id = AgentInstanceId::new();
        let specs = stable_project_tool_session_id(&project_id, Some(&instance_id), "spec-gen");
        let tasks = stable_project_tool_session_id(&project_id, Some(&instance_id), "task-extract");
        assert_ne!(specs, tasks);
    }

    // The legacy "render the project context inline server-side"
    // tests (`project_context_renders_id_and_important_reminders` /
    // `project_context_fallback_keeps_id_and_important_reminders`)
    // were retired alongside `render_project_context*` in the
    // chat-WS migration. Equivalent coverage now lives on the
    // harness side: `aura-agent`'s `prompts::system::tests`
    // snapshots assert the canonical `<project_context>` shape that
    // `SystemPromptBuilder::project_context` produces from the typed
    // `ChatProjectInfoWire` we forward over the wire.
}
