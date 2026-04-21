//! Cross-agent tool dispatcher invoked by harness-hosted agents.
//!
//! Any agent whose [`AgentPermissions`](aura_os_core::AgentPermissions)
//! include one of the cross-agent capabilities
//! (`spawn_agent`, `control_agent`, etc.) is issued an
//! [`aura_protocol::InstalledTool`] pointing at this endpoint when the
//! server opens the harness session. The harness calls back here with
//! the user's JWT and the tool arguments; this handler executes the
//! tool in-process against the authenticated user's world.
//!
//! ```text
//! POST /api/agent_tools/:name
//! Authorization: Bearer <jwt>
//! X-Aura-Org-Id: <org-uuid>     (optional; falls back to server resolution)
//! X-Aura-Agent-Id: <agent-uuid> (set by `stamp_agent_tool_auth` so the
//!                                dispatcher can re-check policy)
//! Content-Type: application/json
//!
//! { ...tool args... }
//! ```
//!
//! The handler resolves `:name` against the server's tool registry,
//! re-checks the calling agent's capabilities against the tool's
//! declared `required_capabilities` (Tier A defense-in-depth in case
//! the harness filter was bypassed), builds a fresh execution context
//! for the authenticated user, executes the tool, and always records
//! the invocation to the in-memory audit log before returning.
//! Non-2xx is only produced for genuine errors (missing tool, bad
//! args, policy denial, tool-level failure).

use aura_os_agent_runtime::audit::{hash_args, AgentToolAuditLog, AgentToolInvocation};
use aura_os_agent_runtime::policy;
use aura_os_core::AgentId;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::Utc;
use serde_json::Value;
use tracing::{info, warn};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Sentinel used when we genuinely have no org context at all (no
/// header stamped by the harness AND no network client available to
/// resolve the caller's membership). Tools that do org-scoped I/O
/// (`list_agents_by_org`, etc.) should treat this exactly the same as
/// "no org supplied" so the server falls back to the user-scoped
/// query instead of sending a bogus literal to aura-network.
const DEFAULT_ORG_SENTINEL: &str = "default";

/// `X-Aura-Org-Id` header the harness forwards from the session init
/// payload so the dispatcher doesn't have to re-resolve the org on
/// every tool call.
const ORG_ID_HEADER: &str = "x-aura-org-id";

/// `X-Aura-Agent-Id` header stamped by
/// [`aura_os_agent_tools::ceo::stamp_agent_tool_auth`] so the
/// dispatcher can resolve the calling agent and re-enforce its
/// capability bundle on every tool call.
const AGENT_ID_HEADER: &str = "x-aura-agent-id";

/// `permit_decision` values persisted in the audit log. String
/// literals rather than an enum so the schema maps 1:1 to a future
/// `agent_tool_invocations` storage table without a `FromStr` dance.
const PERMIT_ALLOW: &str = "allow";
const PERMIT_DENY: &str = "deny";
/// Audit-mode sibling of `PERMIT_DENY`: the call would have been
/// denied in `enforce` mode, but the active `AURA_TOOL_POLICY_MODE`
/// is `audit` so we log the would-be denial and still execute the
/// tool. Keeps the denial visible in the audit stream without taking
/// users down when a policy regression lands.
const PERMIT_DENY_AUDIT: &str = "deny_audit";
/// Off-mode marker: the policy check was skipped entirely. Recorded
/// after the tool executes so the audit trail still carries a row for
/// every invocation.
const PERMIT_SKIPPED: &str = "skipped";

/// Env variable controlling the dispatcher's policy behavior. See
/// [`PolicyMode`] for the semantics of each value. Read on every
/// request so operators can flip the mode by restarting the process
/// (or, with the current impl, on the fly — the resolve is cheap
/// enough that we don't bother memoising).
const POLICY_MODE_ENV: &str = "AURA_TOOL_POLICY_MODE";

/// Runtime policy mode for the cross-agent tool dispatcher.
///
/// Tier A originally hard-coded [`PolicyMode::Enforce`] behavior,
/// which regressed the CEO agent on local-only installs (no
/// aura-network) because `agent_permissions_for_header` couldn't
/// resolve the calling agent and returned 403 on every tool call.
/// The env knob lets us ship the permissions-cache correctness fix
/// behind a safety valve: default to [`PolicyMode::Audit`] so a
/// residual misconfiguration still lets tools execute (with an audit
/// warning), and flip to [`PolicyMode::Enforce`] once the cache hit
/// rate is high enough that denials are trustworthy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PolicyMode {
    /// Tier A behavior: deny-by-default. A missing agent lookup or a
    /// failed capability check returns 403 to the harness.
    Enforce,
    /// Logs the denial and executes the tool anyway. Default while
    /// the fleet migrates off broken permission bundles.
    Audit,
    /// Skips the capability check entirely — the dispatcher doesn't
    /// even try to resolve the calling agent. Invocations are still
    /// recorded to the audit log with `permit_decision = "skipped"`.
    Off,
}

impl PolicyMode {
    /// Parse the mode from `AURA_TOOL_POLICY_MODE`. Unknown /
    /// malformed values fall back to [`PolicyMode::Audit`] with a
    /// `warn!` so a typo never accidentally hardens (or disables)
    /// the policy layer.
    pub(crate) fn from_env() -> Self {
        match std::env::var(POLICY_MODE_ENV) {
            Ok(raw) => Self::from_raw(&raw),
            Err(_) => Self::Audit,
        }
    }

    fn from_raw(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" => Self::Audit,
            "enforce" => Self::Enforce,
            "audit" => Self::Audit,
            "off" => Self::Off,
            other => {
                warn!(
                    value = %other,
                    env = POLICY_MODE_ENV,
                    "unknown policy mode; defaulting to audit"
                );
                Self::Audit
            }
        }
    }

    /// Short label for structured logging / audit rows.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Enforce => "enforce",
            Self::Audit => "audit",
            Self::Off => "off",
        }
    }
}

/// Emit a one-liner at process start so operators can confirm which
/// policy mode is active. Called from `app_builder::build_app_state`.
pub fn log_active_policy_mode() {
    let mode = PolicyMode::from_env();
    info!(
        mode = %mode.as_str(),
        env = POLICY_MODE_ENV,
        "cross-agent tool policy mode active"
    );
}

/// POST `/api/agent_tools/:name` — execute a cross-agent tool on behalf
/// of a harness-hosted agent session.
pub(crate) async fn dispatch_agent_tool(
    State(state): State<AppState>,
    Path(tool_name): Path<String>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> ApiResult<Json<Value>> {
    let sas = state.agent_runtime.clone();

    // Use the process-wide cached registry so every cross-agent tool
    // invocation skips the ~55-entry HashMap rebuild.
    let registry = aura_os_agent_tools::shared_all_tools_registry();
    let tool = registry
        .get(&tool_name)
        .ok_or_else(|| ApiError::not_found(format!("unknown agent tool: {tool_name}")))?;

    let args = body.map(|Json(v)| v).unwrap_or(Value::Null);
    if !matches!(&args, Value::Object(_) | Value::Null) {
        return Err(ApiError::bad_request(
            "tool arguments must be a JSON object".to_string(),
        ));
    }

    let user_id = auth_session.user_id.as_str();
    let org_id = resolve_org_id(&headers, &state, &jwt, user_id).await;
    let agent_id_header = extract_agent_id(&headers);

    let ctx = sas.build_context(user_id, &org_id, &jwt);
    let audit_log = sas.audit_log();
    let args_hash = hash_args(&args);
    let started_at = Utc::now();
    let invocation_id = Uuid::new_v4().to_string();

    info!(
        tool = %tool_name,
        user = %user_id,
        org = %org_id,
        agent = agent_id_header.as_deref().unwrap_or("-"),
        invocation = %invocation_id,
        "dispatching cross-agent tool"
    );

    // --- Policy enforcement -------------------------------------------------
    //
    // Resolve the tool's declared capability requirements first so we
    // can skip the (potentially network-bound) agent lookup for
    // unrestricted tools like `list_feed` / `get_current_time`.
    let required = tool.resolve_required_capabilities(&args);
    let policy_mode = PolicyMode::from_env();
    // Tracks whether this request bypassed the policy check via
    // `PolicyMode::Off` (skip the resolve + check entirely) — used
    // to pick the `PERMIT_SKIPPED` audit decision post-execute.
    let mut policy_skipped = matches!(policy_mode, PolicyMode::Off);
    // Set when an Audit-mode deny fell through to execution. We
    // already recorded a `deny_audit` row before execute, so the
    // post-execute allow write is suppressed to avoid a duplicate
    // audit row for the same invocation id.
    let mut policy_audit_fallthrough = false;

    if !required.is_empty() && !matches!(policy_mode, PolicyMode::Off) {
        match agent_permissions_for_header(&state, &jwt, agent_id_header.as_deref()).await {
            Ok(perms) => {
                let decision = policy::check_capabilities(&perms, &required);
                if !decision.allowed {
                    let reason = decision
                        .reason
                        .unwrap_or_else(|| "policy denied tool call".to_string());
                    match policy_mode {
                        PolicyMode::Enforce => {
                            record_deny(
                                &audit_log,
                                &invocation_id,
                                started_at,
                                agent_id_header.clone(),
                                user_id,
                                &org_id,
                                &tool_name,
                                &args_hash,
                                &reason,
                                PERMIT_DENY,
                            )
                            .await;
                            warn!(
                                tool = %tool_name,
                                agent = agent_id_header.as_deref().unwrap_or("-"),
                                reason = %reason,
                                policy_mode = %policy_mode.as_str(),
                                "agent tool denied by policy"
                            );
                            return Err(ApiError::forbidden(reason));
                        }
                        PolicyMode::Audit => {
                            record_deny(
                                &audit_log,
                                &invocation_id,
                                started_at,
                                agent_id_header.clone(),
                                user_id,
                                &org_id,
                                &tool_name,
                                &args_hash,
                                &reason,
                                PERMIT_DENY_AUDIT,
                            )
                            .await;
                            warn!(
                                tool = %tool_name,
                                agent = agent_id_header.as_deref().unwrap_or("-"),
                                reason = %reason,
                                policy_mode = "audit",
                                "policy would deny — executing anyway (audit mode)"
                            );
                            // Fall through: execute the tool. Mark the
                            // allow-row so we don't double-write to
                            // the audit log after execute returns.
                            let _ = reason;
                            policy_audit_fallthrough = true;
                        }
                        // Off handled by the enclosing `if` guard.
                        PolicyMode::Off => unreachable!(),
                    }
                }
            }
            Err(deny_reason) => match policy_mode {
                PolicyMode::Enforce => {
                    record_deny(
                        &audit_log,
                        &invocation_id,
                        started_at,
                        agent_id_header.clone(),
                        user_id,
                        &org_id,
                        &tool_name,
                        &args_hash,
                        &deny_reason,
                        PERMIT_DENY,
                    )
                    .await;
                    warn!(
                        tool = %tool_name,
                        agent = agent_id_header.as_deref().unwrap_or("-"),
                        reason = %deny_reason,
                        policy_mode = "enforce",
                        "agent tool denied by policy (unable to resolve agent)"
                    );
                    return Err(ApiError::forbidden(deny_reason));
                }
                PolicyMode::Audit => {
                    record_deny(
                        &audit_log,
                        &invocation_id,
                        started_at,
                        agent_id_header.clone(),
                        user_id,
                        &org_id,
                        &tool_name,
                        &args_hash,
                        &deny_reason,
                        PERMIT_DENY_AUDIT,
                    )
                    .await;
                    warn!(
                        tool = %tool_name,
                        agent = agent_id_header.as_deref().unwrap_or("-"),
                        reason = %deny_reason,
                        policy_mode = "audit",
                        "policy would deny (resolve failed) — executing anyway (audit mode)"
                    );
                    let _ = deny_reason;
                    policy_audit_fallthrough = true;
                }
                PolicyMode::Off => unreachable!(),
            },
        }
    } else if !required.is_empty() && matches!(policy_mode, PolicyMode::Off) {
        policy_skipped = true;
    }

    // --- Execute -----------------------------------------------------------

    let tool = tool.clone();
    let result = tool.execute(args, &ctx).await;

    match result {
        Ok(result) => {
            // Log the serialized content byte size so a future
            // context-bloat regression in any tool surfaces in logs
            // without needing a user bug report. `list_agents` used to
            // return multi-KB `NetworkAgent` records (personality /
            // system_prompt) and a single call drove the CEO's context
            // utilisation to 100% on the next turn — the harness's
            // `Session.messages` vector is append-only, so every
            // bloated tool_result rides along forever. The
            // CONTENT_SIZE_WARN_BYTES threshold (8 KiB) is deliberately
            // generous: typical slim tool outputs land well under 1
            // KiB, so a warn here means something genuinely changed
            // shape.
            const CONTENT_SIZE_WARN_BYTES: usize = 8 * 1024;
            let content_bytes = serde_json::to_string(&result.content)
                .map(|s| s.len())
                .unwrap_or(0);
            // Audit-mode deny-fallthrough already wrote a `deny_audit`
            // row before execute; don't duplicate it post-execute.
            // Everything else gets the usual allow / skipped row.
            if !policy_audit_fallthrough {
                let decision = if policy_skipped {
                    PERMIT_SKIPPED
                } else {
                    PERMIT_ALLOW
                };
                record_allow(
                    &audit_log,
                    &invocation_id,
                    started_at,
                    agent_id_header.clone(),
                    user_id,
                    &org_id,
                    &tool_name,
                    &args_hash,
                    content_bytes as u64,
                    decision,
                )
                .await;
            }
            if content_bytes > CONTENT_SIZE_WARN_BYTES {
                warn!(
                    tool = %tool_name,
                    user = %user_id,
                    org = %org_id,
                    content_bytes,
                    "agent tool result is large — possible context bloat"
                );
            } else {
                info!(
                    tool = %tool_name,
                    content_bytes,
                    "agent tool result ready"
                );
            }
            Ok(Json(serde_json::json!({
                "tool": tool_name,
                "is_error": result.is_error,
                "content": result.content,
            })))
        }
        Err(err) => {
            if !policy_audit_fallthrough {
                let decision = if policy_skipped {
                    PERMIT_SKIPPED
                } else {
                    PERMIT_ALLOW
                };
                record_allow(
                    &audit_log,
                    &invocation_id,
                    started_at,
                    agent_id_header,
                    user_id,
                    &org_id,
                    &tool_name,
                    &args_hash,
                    0,
                    decision,
                )
                .await;
            }
            warn!(
                tool = %tool_name,
                error = %err,
                "agent tool execution failed"
            );
            Err(ApiError::internal(err.to_string()))
        }
    }
}

/// Resolve the org id the tool should run under.
///
/// Resolution order:
/// 1. `X-Aura-Org-Id` header (set by `stamp_agent_tool_auth` whenever
///    the chatting agent carries an `org_id`).
/// 2. Live lookup against aura-network — pick the first org the JWT
///    has membership in via `client.list_orgs(jwt)`. This is the
///    fallback path for cases where the session was opened without an
///    agent `org_id` (bootstrap-seeded CEO on a fresh install, older
///    harness that didn't forward the header, direct curl, ...).
///
/// If neither yields a real org id we fall back to
/// [`DEFAULT_ORG_SENTINEL`]. Tools that care — `ListAgentsTool` in
/// particular — must recognize the sentinel and degrade gracefully
/// (e.g. by calling the unscoped `list_agents(jwt)` instead of sending
/// `?org_id=default` to aura-network, which would 403 because nobody
/// is a member of that string-literal org).
async fn resolve_org_id(
    headers: &HeaderMap,
    state: &AppState,
    jwt: &str,
    _user_id: &str,
) -> String {
    if let Some(org) = headers
        .get(ORG_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.trim().is_empty())
    {
        return org.to_string();
    }

    if let Some(ref client) = state.network_client {
        match client.list_orgs(jwt).await {
            Ok(orgs) => {
                if let Some(first) = orgs.into_iter().next() {
                    return first.id;
                }
            }
            Err(err) => {
                warn!(
                    error = %err,
                    "resolve_org_id: list_orgs failed; falling back to default sentinel"
                );
            }
        }
    }

    DEFAULT_ORG_SENTINEL.to_string()
}

/// Extract the calling agent id from the `X-Aura-Agent-Id` header.
/// Trimmed and normalised to `None` for empty / whitespace-only values
/// so downstream code can test `Option<&str>` semantics directly.
fn extract_agent_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AGENT_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Fetch the calling agent's `AgentPermissions`, consulting the local
/// shadow first (hot path; avoids a round-trip per tool call) and
/// falling back to aura-network's authoritative record. Errors are
/// mapped to a human-readable string suitable for a 403 response
/// body; the dispatcher never leaks aura-network / storage error
/// types to the harness.
async fn agent_permissions_for_header(
    state: &AppState,
    jwt: &str,
    agent_id: Option<&str>,
) -> Result<aura_os_core::AgentPermissions, String> {
    let Some(agent_id_str) = agent_id else {
        // The harness is expected to always stamp the header via
        // `stamp_agent_tool_auth`. A missing header means either a
        // misconfigured harness or a direct curl bypass; in both
        // cases we refuse the call rather than guessing.
        return Err("missing X-Aura-Agent-Id header".to_string());
    };

    // Hot path: the session-open handlers populate the
    // `permissions_cache` with the already-normalized bundle keyed by
    // whatever id they stamped (`AgentId` for org-level chat,
    // `AgentInstanceId` for project-instance chat). Checking the
    // cache first means:
    //   - no `AgentId::parse` step (instance ids are a different
    //     flavor of uuid and would fail the parse),
    //   - no local-shadow lookup,
    //   - no aura-network round-trip on local-only installs where
    //     `get_agent_with_jwt` returns `"aura-network is not
    //     configured"` and regresses the CEO agent to 403.
    if let Some(perms) = state.permissions_cache.get(agent_id_str) {
        return Ok(perms);
    }

    // Cold fallback: resolve through AgentService. This path still
    // exists for direct-curl callers, restart-after-session-open,
    // and any request that arrives before the session-open handler
    // has populated the cache. We cache the resolved bundle on the
    // way out so subsequent calls skip the resolve.
    let parsed: AgentId = agent_id_str
        .parse()
        .map_err(|e| format!("invalid X-Aura-Agent-Id: {e}"))?;

    if let Ok(agent) = state.agent_service.get_agent_local(&parsed) {
        let perms = agent
            .permissions
            .clone()
            .normalized_for_identity(&agent.name, Some(agent.role.as_str()));
        state
            .permissions_cache
            .insert(agent_id_str.to_string(), perms.clone());
        return Ok(perms);
    }

    match state.agent_service.get_agent_with_jwt(jwt, &parsed).await {
        Ok(agent) => {
            let perms = agent
                .permissions
                .clone()
                .normalized_for_identity(&agent.name, Some(agent.role.as_str()));
            state
                .permissions_cache
                .insert(agent_id_str.to_string(), perms.clone());
            Ok(perms)
        }
        Err(err) => Err(format!("failed to resolve calling agent: {err}")),
    }
}

/// Best-effort audit write for a policy denial.
///
/// `permit_decision` is parameterised so callers can record the
/// Tier A hard-deny ([`PERMIT_DENY`]) or the safety-valve
/// audit-only fallthrough ([`PERMIT_DENY_AUDIT`]) through the same
/// code path.
#[allow(clippy::too_many_arguments)]
async fn record_deny(
    audit_log: &AgentToolAuditLog,
    invocation_id: &str,
    started_at: chrono::DateTime<Utc>,
    agent_id: Option<String>,
    user_id: &str,
    org_id: &str,
    tool_name: &str,
    args_hash: &str,
    reason: &str,
    permit_decision: &str,
) {
    let finished_at = Utc::now();
    audit_log
        .record(AgentToolInvocation {
            id: invocation_id.to_string(),
            agent_id,
            tool_name: tool_name.to_string(),
            args_hash: args_hash.to_string(),
            permit_decision: permit_decision.to_string(),
            permit_reason: Some(reason.to_string()),
            result_bytes: 0,
            started_at,
            finished_at,
            org_id: org_id_option(org_id),
            user_id: user_id.to_string(),
        })
        .await;
}

/// Best-effort audit write for an allowed invocation. Call sites
/// pass the serialized result size as `result_bytes`; errored tool
/// executions pass `0` so the allow decision is still visible without
/// pretending a result was produced.
///
/// `permit_decision` is parameterised so callers can distinguish a
/// normal allow ([`PERMIT_ALLOW`]) from an off-mode bypass
/// ([`PERMIT_SKIPPED`]) without a parallel function.
#[allow(clippy::too_many_arguments)]
async fn record_allow(
    audit_log: &AgentToolAuditLog,
    invocation_id: &str,
    started_at: chrono::DateTime<Utc>,
    agent_id: Option<String>,
    user_id: &str,
    org_id: &str,
    tool_name: &str,
    args_hash: &str,
    result_bytes: u64,
    permit_decision: &str,
) {
    let finished_at = Utc::now();
    audit_log
        .record(AgentToolInvocation {
            id: invocation_id.to_string(),
            agent_id,
            tool_name: tool_name.to_string(),
            args_hash: args_hash.to_string(),
            permit_decision: permit_decision.to_string(),
            permit_reason: None,
            result_bytes,
            started_at,
            finished_at,
            org_id: org_id_option(org_id),
            user_id: user_id.to_string(),
        })
        .await;
}

/// Map the resolved org id to `Option<String>`, collapsing the
/// "default" sentinel to `None` so audit rows don't record a literal
/// `org_id = "default"` that no real membership query ever returns.
fn org_id_option(org_id: &str) -> Option<String> {
    if org_id == DEFAULT_ORG_SENTINEL || org_id.trim().is_empty() {
        None
    } else {
        Some(org_id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn header_parsing_extracts_org_id() {
        let mut h = HeaderMap::new();
        h.insert("x-aura-org-id", HeaderValue::from_static("org-42"));
        let got = h.get("x-aura-org-id").and_then(|v| v.to_str().ok());
        assert_eq!(got, Some("org-42"));
    }

    #[test]
    fn empty_header_is_ignored() {
        let mut h = HeaderMap::new();
        h.insert("x-aura-org-id", HeaderValue::from_static("   "));
        let got = h
            .get("x-aura-org-id")
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.trim().is_empty());
        assert_eq!(got, None);
    }

    #[test]
    fn extract_agent_id_normalises_whitespace() {
        let mut h = HeaderMap::new();
        h.insert("x-aura-agent-id", HeaderValue::from_static("  a-b-c  "));
        assert_eq!(super::extract_agent_id(&h), Some("a-b-c".to_string()));
    }

    #[test]
    fn extract_agent_id_empty_is_none() {
        let mut h = HeaderMap::new();
        h.insert("x-aura-agent-id", HeaderValue::from_static("   "));
        assert_eq!(super::extract_agent_id(&h), None);
    }

    #[test]
    fn org_id_option_collapses_default_sentinel() {
        assert_eq!(super::org_id_option("default"), None);
        assert_eq!(super::org_id_option(""), None);
        assert_eq!(super::org_id_option("   "), None);
        assert_eq!(super::org_id_option("org-42"), Some("org-42".to_string()));
    }

    // -----------------------------------------------------------------
    // PolicyMode parsing
    // -----------------------------------------------------------------

    use super::PolicyMode;

    #[test]
    fn policy_mode_parses_canonical_values() {
        assert_eq!(PolicyMode::from_raw("enforce"), PolicyMode::Enforce);
        assert_eq!(PolicyMode::from_raw("audit"), PolicyMode::Audit);
        assert_eq!(PolicyMode::from_raw("off"), PolicyMode::Off);
    }

    #[test]
    fn policy_mode_parse_is_case_insensitive_and_trims() {
        assert_eq!(PolicyMode::from_raw("ENFORCE"), PolicyMode::Enforce);
        assert_eq!(PolicyMode::from_raw("  Audit  "), PolicyMode::Audit);
        assert_eq!(PolicyMode::from_raw("Off"), PolicyMode::Off);
        // Empty / whitespace-only falls back to the default.
        assert_eq!(PolicyMode::from_raw(""), PolicyMode::Audit);
        assert_eq!(PolicyMode::from_raw("   "), PolicyMode::Audit);
    }

    #[test]
    fn policy_mode_unknown_value_falls_back_to_audit() {
        assert_eq!(PolicyMode::from_raw("banana"), PolicyMode::Audit);
        assert_eq!(PolicyMode::from_raw("strict"), PolicyMode::Audit);
        assert_eq!(PolicyMode::from_raw("0"), PolicyMode::Audit);
    }
}
