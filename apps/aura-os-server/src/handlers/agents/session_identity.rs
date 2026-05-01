//! Tier 1 fail-fast preflight validation for harness session identity.
//!
//! Before each `harness.open_session(...)` / `client.start(...)` call,
//! the server checks that every required identity field on the
//! [`SessionConfig`] / [`AutomatonStartParams`] is populated for that
//! call-site shape. Missing required fields surface as
//! [`crate::error::ApiError::session_identity_missing`] (HTTP 422 with
//! a stable `missing_<field>` code) instead of being silently dropped
//! into the harness wire and surfacing later as a Cloudflare 403 /
//! generic 5xx with no actionable signal.
//!
//! Soft-but-recommended fields (e.g. `intent_classifier`,
//! `installed_tools`) are only emitted as `tracing::warn!` events on
//! the `aura_os_server::session_shape` target so operators can opt in
//! via `RUST_LOG=aura_os_server::session_shape=debug` without
//! affecting request behaviour.
//!
//! See `crates/aura-os-harness/src/error.rs` for the matching
//! Tier 2 detection contract on the harness side.

use aura_os_harness::{AutomatonStartParams, SessionConfig};
use tracing::warn;

use crate::error::{ApiError, ApiResult};

/// Per-call-site contract describing which identity fields must be
/// populated before the server hands the session off to the harness.
///
/// Every required field is enforced as a hard 422
/// [`ApiError::session_identity_missing`]. Optional fields are left
/// to the call site to populate or skip; this struct only governs the
/// preflight gate.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SessionIdentityRequirements {
    pub require_org_id: bool,
    pub require_session_id: bool,
    /// Strictly require [`SessionConfig::template_agent_id`] /
    /// [`AutomatonStartParams::template_agent_id`].
    ///
    /// Used by chat / dev-loop where the partition `agent_id` is the
    /// `{template}::{instance}` turn-lock string and the *template*
    /// agent id is the billing identity.
    pub require_template_agent_id: bool,
    /// Require *some* agent identity (either `template_agent_id` or
    /// the bare `agent_id`) so the harness can stamp
    /// `X-Aura-Agent-Id` on the outbound proxy call. Project-tool
    /// sessions use this relaxed check because they sometimes use a
    /// synthetic `{tool_agent_name}-{project_id}` agent_id when no
    /// agent instance is bound.
    pub require_any_agent_identity: bool,
    pub require_user_id: bool,
    pub require_auth_token: bool,
}

impl SessionIdentityRequirements {
    /// Interactive chat (both bare-agent and instance routes) and
    /// non-interactive chat-driven actions like `generate_specs`
    /// flowing through the chat events stream. The chat path always
    /// has a resolved agent + signed-in user + JWT, so every identity
    /// field is required.
    pub(crate) const CHAT: Self = Self {
        require_org_id: true,
        require_session_id: true,
        require_template_agent_id: true,
        require_any_agent_identity: true,
        require_user_id: true,
        require_auth_token: true,
    };

    /// Dev-loop / single-task automaton starts. The server resolves
    /// the org from the project, generates a stable session id, and
    /// always has a signed-in user + JWT.
    pub(crate) const DEV_LOOP: Self = Self {
        require_org_id: true,
        require_session_id: true,
        require_template_agent_id: true,
        require_any_agent_identity: true,
        require_user_id: true,
        require_auth_token: true,
    };

    /// Project-tool sessions (spec generation, task extraction, spec
    /// summary). After commit `4cffca5f1` `project_tool_session_config`
    /// always populates `aura_session_id` via the deterministic
    /// `stable_project_tool_session_id`, falls back to `project.org_id`
    /// for `aura_org_id`, and threads the JWT + user id through.
    ///
    /// `template_agent_id` is *not* required because the helper falls
    /// back to a synthetic `{tool_agent_name}-{project_id}`
    /// `agent_id` when no agent instance is bound (Local mode). The
    /// `require_any_agent_identity` flag still ensures *some* agent
    /// identity is present so the harness can stamp
    /// `X-Aura-Agent-Id`.
    pub(crate) const PROJECT_TOOL: Self = Self {
        require_org_id: true,
        require_session_id: true,
        require_template_agent_id: false,
        require_any_agent_identity: true,
        require_user_id: true,
        require_auth_token: true,
    };

    /// Image / 3D generation sessions opened by
    /// `handlers::generation::harness_stream::open_generation_stream`.
    /// Until Phase 5 threads identity through these sessions, only
    /// the JWT is hard-required so the existing call site keeps
    /// working without breaking the eval pipeline.
    #[allow(dead_code)] // wired up in Phase 5
    pub(crate) const GENERATION: Self = Self {
        require_org_id: false,
        require_session_id: false,
        require_template_agent_id: false,
        require_any_agent_identity: false,
        require_user_id: false,
        require_auth_token: true,
    };

    /// Scheduled-process automatons started via `process_automaton.rs`.
    /// Currently `HarnessAutomatonStartParams` carries no `aura_org_id`
    /// / `aura_session_id` fields (Phase 5 follow-up), so the preflight
    /// is intentionally relaxed to JWT-only here too.
    #[allow(dead_code)] // wired up in Phase 5
    pub(crate) const SCHEDULED_PROCESS: Self = Self {
        require_org_id: false,
        require_session_id: false,
        require_template_agent_id: false,
        require_any_agent_identity: false,
        require_user_id: false,
        require_auth_token: true,
    };
}

/// Preflight a [`SessionConfig`] against `requirements`. Returns
/// `Err(ApiError::session_identity_missing(...))` on the first missing
/// required field; emits `tracing::warn!` for soft fields that are
/// strongly recommended but not blocking.
///
/// `context` is a stable, machine-readable label for the call site
/// (e.g. `"chat_session"`, `"project_tool_session"`,
/// `"generation_session"`). It surfaces in the error `data.context`
/// and in the warn log target so operators can grep both.
pub(crate) fn validate_session_identity(
    cfg: &SessionConfig,
    requirements: SessionIdentityRequirements,
    context: &'static str,
) -> ApiResult<()> {
    if requirements.require_org_id && is_missing(cfg.aura_org_id.as_deref()) {
        return Err(ApiError::session_identity_missing("aura_org_id", context));
    }
    if requirements.require_session_id && is_missing(cfg.aura_session_id.as_deref()) {
        return Err(ApiError::session_identity_missing(
            "aura_session_id",
            context,
        ));
    }
    if requirements.require_template_agent_id && is_missing(cfg.template_agent_id.as_deref()) {
        return Err(ApiError::session_identity_missing(
            "template_agent_id",
            context,
        ));
    }
    if requirements.require_any_agent_identity
        && is_missing(cfg.template_agent_id.as_deref())
        && is_missing(cfg.agent_id.as_deref())
    {
        // The harness's `build_session_init` falls back from
        // `template_agent_id` to `agent_id` for `aura_agent_id` /
        // X-Aura-Agent-Id, so requiring *either* (rather than both)
        // is the minimum the proxy needs to bucket the request.
        return Err(ApiError::session_identity_missing("agent_id", context));
    }
    if requirements.require_user_id && is_missing(cfg.user_id.as_deref()) {
        return Err(ApiError::session_identity_missing("user_id", context));
    }
    if requirements.require_auth_token && is_missing(cfg.token.as_deref()) {
        return Err(ApiError::session_identity_missing("auth_token", context));
    }

    log_session_shape(cfg, context);
    Ok(())
}

/// Preflight an [`AutomatonStartParams`] against `requirements`. Same
/// contract as [`validate_session_identity`], but for the dev-loop /
/// single-task automaton wire shape.
pub(crate) fn validate_automaton_identity(
    params: &AutomatonStartParams,
    requirements: SessionIdentityRequirements,
    context: &'static str,
) -> ApiResult<()> {
    if requirements.require_org_id && is_missing(params.aura_org_id.as_deref()) {
        return Err(ApiError::session_identity_missing("aura_org_id", context));
    }
    if requirements.require_session_id && is_missing(params.aura_session_id.as_deref()) {
        return Err(ApiError::session_identity_missing(
            "aura_session_id",
            context,
        ));
    }
    if requirements.require_template_agent_id && is_missing(params.template_agent_id.as_deref()) {
        return Err(ApiError::session_identity_missing(
            "template_agent_id",
            context,
        ));
    }
    if requirements.require_any_agent_identity
        && is_missing(params.template_agent_id.as_deref())
        && is_missing(params.agent_id.as_deref())
        && is_missing(params.aura_agent_id.as_deref())
    {
        return Err(ApiError::session_identity_missing("agent_id", context));
    }
    if requirements.require_user_id && is_missing(params.user_id.as_deref()) {
        return Err(ApiError::session_identity_missing("user_id", context));
    }
    if requirements.require_auth_token && is_missing(params.auth_token.as_deref()) {
        return Err(ApiError::session_identity_missing("auth_token", context));
    }

    log_automaton_shape(params, context);
    Ok(())
}

fn is_missing(value: Option<&str>) -> bool {
    value
        .map(|v| v.trim().is_empty())
        .unwrap_or(true)
}

/// Replace the previous Windows-only file-logging shims
/// (`debug_log_session_shape*`) with a structured tracing event on a
/// dedicated target. Operators opt in via
/// `RUST_LOG=aura_os_server::session_shape=debug` instead of writing
/// to a hardcoded `C:\code\aura-os\debug-95fd5c.log` path that was
/// silently dropped on Linux/macOS.
fn log_session_shape(cfg: &SessionConfig, context: &'static str) {
    tracing::debug!(
        target: "aura_os_server::session_shape",
        context = context,
        has_aura_org_id = cfg.aura_org_id.is_some(),
        has_aura_session_id = cfg.aura_session_id.is_some(),
        has_template_agent_id = cfg.template_agent_id.is_some(),
        has_agent_id = cfg.agent_id.is_some(),
        has_user_id = cfg.user_id.is_some(),
        has_token = cfg.token.is_some(),
        has_provider_overrides = cfg.provider_overrides.is_some(),
        has_intent_classifier = cfg.intent_classifier.is_some(),
        has_project_id = cfg.project_id.is_some(),
        has_project_path = cfg.project_path.is_some(),
        system_prompt_len = cfg.system_prompt.as_deref().map(str::len).unwrap_or(0),
        installed_tools_count = cfg.installed_tools.as_ref().map(Vec::len).unwrap_or(0),
        installed_integrations_count = cfg
            .installed_integrations
            .as_ref()
            .map(Vec::len)
            .unwrap_or(0),
        max_turns = ?cfg.max_turns,
        "session shape preflight"
    );

    if cfg.intent_classifier.is_none() {
        // Soft signal: most chat / project-tool sessions intentionally
        // omit the classifier, but on the dev-loop / spec-gen path it
        // tends to indicate a stale agent template that hasn't been
        // re-synced. Keep it at debug level to avoid noise.
        tracing::trace!(
            target: "aura_os_server::session_shape",
            context = context,
            "session opened without intent_classifier"
        );
    }
    if cfg.project_id.is_some() && cfg.project_path.is_none() {
        warn!(
            target: "aura_os_server::session_shape",
            context = context,
            "project_id is set but project_path is not — workspace tools may fail"
        );
    }
}

fn log_automaton_shape(params: &AutomatonStartParams, context: &'static str) {
    tracing::debug!(
        target: "aura_os_server::session_shape",
        context = context,
        has_aura_org_id = params.aura_org_id.is_some(),
        has_aura_session_id = params.aura_session_id.is_some(),
        has_template_agent_id = params.template_agent_id.is_some(),
        has_aura_agent_id = params.aura_agent_id.is_some(),
        has_partition_agent_id = params.agent_id.is_some(),
        has_user_id = params.user_id.is_some(),
        has_auth_token = params.auth_token.is_some(),
        has_system_prompt = params.system_prompt.is_some(),
        has_provider_overrides = params.provider_overrides.is_some(),
        has_intent_classifier = params.intent_classifier.is_some(),
        has_workspace_root = params.workspace_root.is_some(),
        task_id_present = params.task_id.is_some(),
        max_turns = ?params.max_turns,
        installed_tools_count = params.installed_tools.as_ref().map(Vec::len).unwrap_or(0),
        installed_integrations_count = params
            .installed_integrations
            .as_ref()
            .map(Vec::len)
            .unwrap_or(0),
        "automaton start shape preflight"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_protocol::AgentPermissionsWire;
    use axum::http::StatusCode;

    fn full_chat_config() -> SessionConfig {
        SessionConfig {
            agent_id: Some("template::instance".to_string()),
            template_agent_id: Some("template".to_string()),
            user_id: Some("user-1".to_string()),
            token: Some("jwt".to_string()),
            aura_org_id: Some("org-1".to_string()),
            aura_session_id: Some("session-1".to_string()),
            agent_permissions: AgentPermissionsWire::default(),
            ..Default::default()
        }
    }

    fn full_automaton_params() -> AutomatonStartParams {
        AutomatonStartParams {
            project_id: "project-1".to_string(),
            agent_id: Some("template::instance".to_string()),
            aura_agent_id: Some("template".to_string()),
            template_agent_id: Some("template".to_string()),
            auth_token: Some("jwt".to_string()),
            model: None,
            system_prompt: None,
            provider_overrides: None,
            user_id: Some("user-1".to_string()),
            intent_classifier: None,
            max_turns: None,
            workspace_root: None,
            task_id: None,
            git_repo_url: None,
            git_branch: None,
            installed_tools: None,
            installed_integrations: None,
            agent_permissions: AgentPermissionsWire::default(),
            prior_failure: None,
            work_log: Vec::new(),
            aura_org_id: Some("org-1".to_string()),
            aura_session_id: Some("session-1".to_string()),
        }
    }

    #[test]
    fn chat_requirements_accept_fully_populated_config() {
        let cfg = full_chat_config();
        assert!(
            validate_session_identity(&cfg, SessionIdentityRequirements::CHAT, "chat_session")
                .is_ok()
        );
    }

    #[test]
    fn chat_requirements_reject_missing_org_id() {
        let mut cfg = full_chat_config();
        cfg.aura_org_id = None;
        let (status, axum::Json(api_err)) =
            validate_session_identity(&cfg, SessionIdentityRequirements::CHAT, "chat_session")
                .expect_err("missing aura_org_id should fail preflight");
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(api_err.code, "missing_aura_org_id");
        let data = api_err.data.expect("structured data populated");
        assert_eq!(data["field"], "aura_org_id");
        assert_eq!(data["context"], "chat_session");
    }

    #[test]
    fn chat_requirements_reject_blank_session_id() {
        let mut cfg = full_chat_config();
        // A whitespace-only string is no better than `None` for the
        // billing header — treat it as missing.
        cfg.aura_session_id = Some("   ".to_string());
        let (_, axum::Json(api_err)) =
            validate_session_identity(&cfg, SessionIdentityRequirements::CHAT, "chat_session")
                .expect_err("blank aura_session_id should fail preflight");
        assert_eq!(api_err.code, "missing_aura_session_id");
    }

    #[test]
    fn chat_requirements_reject_missing_user_id() {
        let mut cfg = full_chat_config();
        cfg.user_id = None;
        let (_, axum::Json(api_err)) =
            validate_session_identity(&cfg, SessionIdentityRequirements::CHAT, "chat_session")
                .expect_err("missing user_id should fail preflight");
        assert_eq!(api_err.code, "missing_user_id");
    }

    #[test]
    fn chat_requirements_reject_missing_template_agent_id() {
        let mut cfg = full_chat_config();
        cfg.template_agent_id = None;
        let (_, axum::Json(api_err)) =
            validate_session_identity(&cfg, SessionIdentityRequirements::CHAT, "chat_session")
                .expect_err("missing template_agent_id should fail preflight");
        assert_eq!(api_err.code, "missing_template_agent_id");
    }

    #[test]
    fn chat_requirements_reject_missing_auth_token() {
        let mut cfg = full_chat_config();
        cfg.token = None;
        let (_, axum::Json(api_err)) =
            validate_session_identity(&cfg, SessionIdentityRequirements::CHAT, "chat_session")
                .expect_err("missing auth_token should fail preflight");
        assert_eq!(api_err.code, "missing_auth_token");
    }

    #[test]
    fn project_tool_requirements_accept_synthetic_agent_id() {
        // Project-tool sessions in Local mode use a synthetic
        // `{tool}-{project_id}` agent_id when no agent instance is
        // bound; the relaxed PROJECT_TOOL preflight must accept that
        // shape (template_agent_id missing, agent_id present).
        let mut cfg = full_chat_config();
        cfg.template_agent_id = None;
        cfg.agent_id = Some("spec-gen-project-1".to_string());
        assert!(validate_session_identity(
            &cfg,
            SessionIdentityRequirements::PROJECT_TOOL,
            "project_tool_session",
        )
        .is_ok());
    }

    #[test]
    fn project_tool_requirements_reject_when_no_agent_identity_at_all() {
        let mut cfg = full_chat_config();
        cfg.template_agent_id = None;
        cfg.agent_id = None;
        let (status, axum::Json(api_err)) = validate_session_identity(
            &cfg,
            SessionIdentityRequirements::PROJECT_TOOL,
            "project_tool_session",
        )
        .expect_err("missing every agent identity should fail preflight");
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(api_err.code, "missing_agent_id");
    }

    #[test]
    fn generation_requirements_only_enforce_auth_token() {
        let cfg = SessionConfig {
            agent_id: Some("generation-1".to_string()),
            token: Some("jwt".to_string()),
            agent_permissions: AgentPermissionsWire::default(),
            ..Default::default()
        };
        // Generation sessions intentionally omit org / session / user
        // until Phase 5 threads them through; ensure the preflight
        // accepts that.
        assert!(validate_session_identity(
            &cfg,
            SessionIdentityRequirements::GENERATION,
            "generation_session"
        )
        .is_ok());
    }

    #[test]
    fn dev_loop_requirements_accept_fully_populated_params() {
        let params = full_automaton_params();
        assert!(validate_automaton_identity(
            &params,
            SessionIdentityRequirements::DEV_LOOP,
            "dev_loop_automaton"
        )
        .is_ok());
    }

    #[test]
    fn dev_loop_requirements_reject_missing_session_id() {
        let mut params = full_automaton_params();
        params.aura_session_id = None;
        let (status, axum::Json(api_err)) = validate_automaton_identity(
            &params,
            SessionIdentityRequirements::DEV_LOOP,
            "dev_loop_automaton",
        )
        .expect_err("missing aura_session_id should fail preflight");
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(api_err.code, "missing_aura_session_id");
        assert_eq!(
            api_err.data.expect("structured data populated")["context"],
            "dev_loop_automaton"
        );
    }

    #[test]
    fn dev_loop_requirements_reject_missing_org_id() {
        let mut params = full_automaton_params();
        params.aura_org_id = None;
        let (_, axum::Json(api_err)) = validate_automaton_identity(
            &params,
            SessionIdentityRequirements::DEV_LOOP,
            "dev_loop_automaton",
        )
        .expect_err("missing aura_org_id should fail preflight");
        assert_eq!(api_err.code, "missing_aura_org_id");
    }

    #[test]
    fn scheduled_process_requirements_only_enforce_auth_token() {
        let mut params = full_automaton_params();
        params.aura_org_id = None;
        params.aura_session_id = None;
        params.user_id = None;
        params.template_agent_id = None;
        // Scheduled-process automatons currently only have an auth
        // token threaded; Phase 5 will tighten this. The preflight
        // must accept the relaxed shape so existing call sites keep
        // working.
        assert!(validate_automaton_identity(
            &params,
            SessionIdentityRequirements::SCHEDULED_PROCESS,
            "scheduled_process_automaton"
        )
        .is_ok());
    }
}
