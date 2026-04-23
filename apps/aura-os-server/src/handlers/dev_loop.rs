use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

use aura_os_core::{
    AgentInstanceId, HarnessMode, ProjectId, SessionId, SpecId, TaskId, TaskStatus,
};
use aura_os_link::{connect_with_retries, AutomatonStartError, AutomatonStartParams};
use aura_os_network::{NetworkClient, ReportUsageRequest};
use aura_os_sessions::{CreateSessionParams, UpdateContextUsageParams};
use aura_os_storage::StorageTaskFileChangeSummary;
use aura_os_tasks::TaskService;

use super::projects_helpers::{
    resolve_agent_instance_workspace_path, validate_workspace_is_initialised,
};
use crate::dto::{ActiveLoopTask, LoopStatusResponse};
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::persistence;
use crate::state::{
    ActiveAutomaton, AppState, AuthJwt, AutomatonRegistry, CachedTaskOutput, TaskOutputCache,
};
use crate::sync_state::{derive_sync_state_from_checkpoints, TaskSyncCheckpoint, TaskSyncState};

/// One of the four Definition-of-Done verification step categories the dev
/// loop recognises. `classify_run_command_steps` maps shell commands to
/// these categories; the event forwarder then buckets the event into the
/// matching field on [`CachedTaskOutput`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VerificationStepKind {
    Build,
    Test,
    Format,
    Lint,
}

/// Resolve the effective git clone URL for a project. If `git_repo_url` is set,
/// use it directly. Otherwise construct from `orbit_base_url` (or `ORBIT_BASE_URL`
/// env var) combined with `orbit_owner` / `orbit_repo`.
fn resolve_git_repo_url(project: Option<&aura_os_core::Project>) -> Option<String> {
    let p = project?;
    if let Some(ref url) = p.git_repo_url {
        if !url.is_empty() {
            return Some(url.clone());
        }
    }
    let owner = p.orbit_owner.as_deref().filter(|s| !s.is_empty())?;
    let repo = p.orbit_repo.as_deref().filter(|s| !s.is_empty())?;
    let base = p
        .orbit_base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| std::env::var("ORBIT_BASE_URL").ok())
        .filter(|s| !s.is_empty())?;
    let base = base.trim_end_matches('/');
    Some(format!("{base}/{owner}/{repo}.git"))
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
    pub model: Option<String>,
}

/// Preflight-validate a resolved **local** workspace path before starting
/// an automaton against it. When the harness mode is `Swarm`, the
/// workspace lives on the remote runner and local inspection is
/// meaningless, so we skip the check.
///
/// When a `git_repo_url` is configured, the automaton is expected to
/// clone into a previously-empty workspace on first run, so we relax
/// the check to only reject `Missing` and `NotADirectory` (i.e. the
/// workspace path cannot be created or is outright broken). When no
/// repo URL is configured we enforce the full check: the workspace
/// must already contain a `.git` entry and at least one non-`.git`
/// file, otherwise the automaton has no source to work with and will
/// flail producing `Untitled file` writes that the DoD gate later
/// rejects with no useful diagnosis.
pub(super) fn preflight_local_workspace(
    harness_mode: HarnessMode,
    project_path: &str,
    git_repo_url: Option<&str>,
) -> ApiResult<()> {
    if harness_mode != HarnessMode::Local {
        return Ok(());
    }
    if project_path.is_empty() {
        return Err(ApiError::bad_request(
            "workspace path is empty; project workspace must be configured before starting the dev loop".to_string(),
        ));
    }
    let path = std::path::Path::new(project_path);
    match validate_workspace_is_initialised(path) {
        Ok(()) => Ok(()),
        Err(err) => {
            use super::projects_helpers::WorkspacePreflightError as E;
            let bootstrap_pending =
                git_repo_url.is_some_and(|url| !url.trim().is_empty());
            let skip_for_bootstrap = bootstrap_pending
                && matches!(err, E::Empty | E::NotAGitRepo);
            if skip_for_bootstrap {
                info!(
                    workspace = %project_path,
                    reason = ?err,
                    "Workspace preflight tolerated empty dir because git_repo_url is configured; automaton will clone on first run"
                );
                return Ok(());
            }
            let hint = err.remediation_hint(path);
            warn!(workspace = %project_path, reason = ?err, "Workspace preflight rejected dev loop start");
            Err(ApiError::bad_request(hint))
        }
    }
}

/// Broadcast a synthetic domain event as JSON on the global event channel.
pub(super) fn emit_domain_event(
    broadcast_tx: &tokio::sync::broadcast::Sender<serde_json::Value>,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let (Some(base), Some(ext)) = (event.as_object_mut(), extra.as_object()) {
        for (k, v) in ext {
            base.insert(k.clone(), v.clone());
        }
    }
    let _ = broadcast_tx.send(event);
}

/// Extract a user-facing failure reason from a harness event payload.
///
/// The harness conventionally emits `task_failed` events with a `reason`
/// field, but older/synthetic events may only carry `error` or `message`.
/// This helper normalises those so every code path can produce a non-empty
/// reason string whenever possible.
fn extract_failure_reason(event: &serde_json::Value) -> Option<String> {
    for key in ["reason", "error", "message"] {
        if let Some(value) = event.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Structured failure context derived from a harness-emitted `task_failed`
/// event (or a synthetic one we build on the server side).
///
/// Today the reason string is the single source of truth; these fields are
/// best-effort extras used to let the UI render a compact
/// `req=req_01 · claude-sonnet-4 · api_error` label underneath the reason,
/// and to let operators correlate a failure with provider / router logs
/// without parsing the reason string.
///
/// Sources, in priority order:
///   1. Sibling fields on the event (`provider_request_id`, `model`,
///      `sse_error_type`, `message_id` — populated by the harness once
///      `aura-automaton` forwards them from `DebugEvent::LlmCall`).
///   2. Fragments parsed out of the reason string produced by
///      `StreamAccumulator::into_response` (aura-harness), which has the
///      shape
///      `stream terminated with error (model=…, msg_id=…, request_id=…): <type>: <raw>`.
///
/// All fields are optional; an empty `TaskFailureContext` is a valid value
/// and tells the UI to render nothing but the raw reason.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct TaskFailureContext {
    pub(super) provider_request_id: Option<String>,
    pub(super) model: Option<String>,
    pub(super) sse_error_type: Option<String>,
    pub(super) message_id: Option<String>,
}

impl TaskFailureContext {
    /// `true` iff at least one field is populated. The forwarded
    /// `task_failed` event only gains sibling fields when this is `true`,
    /// so existing consumers see an unchanged payload on paths where no
    /// structured context is available (e.g. a bare "reset: …" reason from
    /// an infra retry).
    pub(super) fn has_any(&self) -> bool {
        self.provider_request_id.is_some()
            || self.model.is_some()
            || self.sse_error_type.is_some()
            || self.message_id.is_some()
    }

    /// Merge sibling fields into the given object under their canonical
    /// names. Only populated fields are inserted, so the shape stays
    /// backward-compatible on failures that don't carry a provider
    /// context (e.g. Phase 3 remediation failures).
    pub(super) fn merge_into(&self, obj: &mut serde_json::Map<String, serde_json::Value>) {
        if let Some(ref v) = self.provider_request_id {
            obj.insert(
                "provider_request_id".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(ref v) = self.model {
            obj.insert("model".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(ref v) = self.sse_error_type {
            obj.insert(
                "sse_error_type".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(ref v) = self.message_id {
            obj.insert("message_id".into(), serde_json::Value::String(v.clone()));
        }
    }
}

/// Extract a [`TaskFailureContext`] from a harness-emitted `task_failed`
/// event.
///
/// Prefers structured sibling fields (once the harness starts emitting
/// them) and falls back to parsing fragments from the reason string
/// produced by `StreamAccumulator::into_response` in aura-harness. See the
/// `TaskFailureContext` doc-comment for the full precedence order and wire
/// format.
pub(super) fn extract_task_failure_context(
    event: &serde_json::Value,
    reason: Option<&str>,
) -> TaskFailureContext {
    let mut ctx = TaskFailureContext::default();

    let read_str = |key: &str| -> Option<String> {
        event
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };

    ctx.provider_request_id = read_str("provider_request_id").or_else(|| read_str("request_id"));
    ctx.model = read_str("model");
    ctx.sse_error_type = read_str("sse_error_type").or_else(|| read_str("error_type"));
    ctx.message_id = read_str("message_id").or_else(|| read_str("msg_id"));

    if let Some(reason) = reason {
        let parsed = parse_failure_context_from_reason(reason);
        if ctx.provider_request_id.is_none() {
            ctx.provider_request_id = parsed.provider_request_id;
        }
        if ctx.model.is_none() {
            ctx.model = parsed.model;
        }
        if ctx.sse_error_type.is_none() {
            ctx.sse_error_type = parsed.sse_error_type;
        }
        if ctx.message_id.is_none() {
            ctx.message_id = parsed.message_id;
        }
    }

    ctx
}

/// Parse `model=…, msg_id=…, request_id=…` fragments out of the reason
/// string produced by `StreamAccumulator::into_response` in aura-harness.
///
/// The full wire format is:
///   `stream terminated with error (<fragments>): <error_type>: <raw>`
/// where `<fragments>` is a comma-separated list of `key=value` pairs and
/// `<error_type>` is the Anthropic `error.type` (e.g. `overloaded_error`,
/// `api_error`) when the upstream supplied one.
///
/// This parser is intentionally forgiving: any missing piece collapses to
/// `None`, and the fragments list may appear with or without the leading
/// `stream terminated with error` prefix (so prefix-amended reasons like
/// `reset: <orig>` still yield a context).
fn parse_failure_context_from_reason(reason: &str) -> TaskFailureContext {
    let mut ctx = TaskFailureContext::default();

    if let (Some(open), Some(close)) = (reason.find('('), reason.find(')')) {
        if close > open {
            let fragments = &reason[open + 1..close];
            for raw in fragments.split(',') {
                let part = raw.trim();
                if let Some(value) = part.strip_prefix("model=") {
                    let v = value.trim().to_string();
                    if !v.is_empty() {
                        ctx.model = Some(v);
                    }
                } else if let Some(value) = part.strip_prefix("msg_id=") {
                    let v = value.trim().to_string();
                    if !v.is_empty() {
                        ctx.message_id = Some(v);
                    }
                } else if let Some(value) = part.strip_prefix("request_id=") {
                    let v = value.trim().to_string();
                    if !v.is_empty() {
                        ctx.provider_request_id = Some(v);
                    }
                }
            }
        }
    }

    // After the fragments' closing paren the reason continues as
    // `: <error_type>: <raw_message>` when the upstream SSE error carried
    // a `type`. Extract just the first token up to the second colon.
    if let Some(close) = reason.find(") :").or_else(|| reason.find("): ")) {
        // Position *after* the `): ` / `) :` marker.
        let after = &reason[close + 2..];
        let after = after.trim_start_matches(|c: char| c == ':' || c.is_whitespace());
        if let Some(colon_idx) = after.find(':') {
            let candidate = after[..colon_idx].trim();
            if is_plausible_error_type(candidate) {
                ctx.sse_error_type = Some(candidate.to_string());
            }
        }
    }

    ctx
}

/// Guard for the `parse_failure_context_from_reason` error-type extractor.
///
/// The reason string can carry arbitrary upstream text after the fragments
/// parenthetical, and we do not want to mis-identify e.g. `HTTP 500` or
/// `stream timed out` as an error_type. An Anthropic `error.type` is
/// always a snake_case identifier (`overloaded_error`, `api_error`,
/// `invalid_request_error`, …), so we accept only short ASCII
/// `[a-z0-9_]` tokens.
fn is_plausible_error_type(candidate: &str) -> bool {
    !candidate.is_empty()
        && candidate.len() <= 64
        && candidate
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

// ---------------------------------------------------------------------------
// Phase 3 — Autonomous recovery (truncation-failure remediation)
// ---------------------------------------------------------------------------

/// Upper bound on auto-generated retries/decompositions per task. A
/// decomposition, shaped retry, or force-tool retry each count as one
/// retry against this budget so a single pathological task can't spawn
/// children forever when the heuristics keep matching.
const MAX_RETRIES_PER_TASK: u32 = 3;

/// Coarse bucket for failure reason strings. We only distinguish the
/// cases Phase 3 can *do something* about (truncation / no-file-ops),
/// everything else falls through to the existing retry path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FailureClass {
    /// The harness reported a truncated write, a `max_tokens` stop
    /// without file ops, or the Phase 2b `NeedsDecomposition` outcome
    /// surfaced as a reason string.
    Truncation,
    /// Provider-side rate limit (HTTP 429) or transient overload (HTTP
    /// 529 / `overloaded_error`). The task didn't actually run to
    /// completion — the LLM request itself was rejected — so we want
    /// to back off and retry the same task instead of burning Phase 3
    /// budget or marking it permanently failed.
    RateLimited,
    /// Anything else — auth errors, crashes, etc. The existing retry
    /// path is a better match for these.
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum InfraFailureClass {
    ProviderRateLimited,
    ProviderOverloaded,
    /// Upstream LLM / proxy returned a transient 5xx (500/502/503/504),
    /// or the streaming connection aborted mid-response without a
    /// terminal event. Distinct from [`ProviderOverloaded`] (429/529)
    /// because the typical clear time is much shorter — provider
    /// internal errors usually resolve within seconds, while rate-limit
    /// windows are on the order of a minute.
    ProviderInternalError,
    TransportTimeout,
    /// Pre-commit git operation timeout (`git add` / `git commit`). The
    /// task's work is not yet persisted anywhere, so we reset the task
    /// to `ready` and restart the automaton.
    GitTimeout,
    /// Post-commit `git push` timeout. The commit is already in the
    /// workspace repo and, from the task's perspective, the work is
    /// done. We do NOT reset the task — the push is infrastructure and
    /// is retried separately by the harness. Treated as non-fatal on
    /// this side: the task is transitioned to `done` and a
    /// `git_push_failed` event is surfaced to the UI, but the loop is
    /// not paused.
    GitPushTimeout,
}

/// Classify a `task_failed` reason string into a [`FailureClass`].
///
/// Case-insensitive substring match — the Phase 2b error formats the
/// hint into its `Display` impl, so the reason text routinely contains
/// phrases like `"truncated response"` / `"no file operations"`.
///
/// `RateLimited` is checked before `Truncation` so a reason that
/// happens to include both (e.g. a truncated error body that quotes a
/// 429 response) is routed to the backoff path — retrying a truncation
/// inside a rate-limit window would just burn the Phase 3 budget on a
/// follow-up 429.
fn classify_failure(reason: &str) -> FailureClass {
    let lower = reason.to_ascii_lowercase();
    let rate_limit_markers = [
        "429",
        "rate limit",
        "rate-limit",
        "rate_limit",
        "ratelimit",
        "too many requests",
        "529",
        "overloaded",
        "overloaded_error",
    ];
    if rate_limit_markers.iter().any(|m| lower.contains(m)) {
        return FailureClass::RateLimited;
    }
    let truncation_markers = [
        "truncated",
        "no file operations",
        "needsdecomposition",
        "needs_decomposition",
        "needs decomposition",
        "max_tokens",
        "max tokens",
    ];
    if truncation_markers.iter().any(|m| lower.contains(m)) {
        FailureClass::Truncation
    } else {
        FailureClass::Other
    }
}

/// Test-only thin predicate over [`classify_failure`]. Exposed via
/// [`crate::phase7_test_support`] so Phase 7 integration tests can
/// exercise the classification without widening the visibility of the
/// private `FailureClass` enum.
pub(crate) fn is_truncation_failure_for_tests(reason: &str) -> bool {
    classify_failure(reason) == FailureClass::Truncation
}

/// Map the dev-loop's reason-string classifier onto the reconciler's
/// broader [`crate::reconciler::FailureClass`] vocabulary. Lets the
/// task-output API and future background reconciler reuse one
/// classifier instead of reimplementing the substring match.
///
/// The dev-loop classifier only distinguishes `Truncation`,
/// `RateLimited`, and `Other`. Post-commit `git push` timeouts flow
/// through [`InfraFailureClass::GitPushTimeout`] rather than the
/// `task_failed` reason path, so callers who can observe that signal
/// separately should override with
/// [`crate::reconciler::FailureClass::PushTimeout`] before running the
/// decision engine.
pub(crate) fn classify_failure_for_reconciler(reason: &str) -> crate::reconciler::FailureClass {
    match classify_failure(reason) {
        FailureClass::Truncation => crate::reconciler::FailureClass::Truncation,
        FailureClass::RateLimited => crate::reconciler::FailureClass::RateLimited,
        FailureClass::Other => crate::reconciler::FailureClass::Other,
    }
}

/// True when `reason` classifies as a provider-side transient 5xx /
/// stream-terminator error (Axis 1). Exposed through
/// [`crate::phase7_test_support`] so the integration tests in
/// `autonomous_recovery_replay.rs` can pin the exact strings that
/// must now survive round-tripping through the retry path without
/// needing access to the internal `InfraFailureClass` enum.
pub(crate) fn is_provider_internal_error_for_tests(reason: &str) -> bool {
    classify_infra_failure(reason) == Some(InfraFailureClass::ProviderInternalError)
}

/// True when `reason` is treated as a transient-looking failure by
/// [`looks_like_unclassified_transient`] despite
/// [`classify_infra_failure`] returning `None`. The dev loop emits
/// `debug.retry_miss` for exactly this condition so
/// `aura-run-heuristics::unclassified_retry_miss` can surface it.
pub(crate) fn looks_like_unclassified_transient_for_tests(reason: &str) -> bool {
    classify_infra_failure(reason).is_none() && looks_like_unclassified_transient(reason)
}

fn classify_infra_failure(reason: &str) -> Option<InfraFailureClass> {
    let lower = reason.to_ascii_lowercase();
    // Check `git push` first so it is routed to the non-fatal
    // `GitPushTimeout` path instead of the pre-commit `GitTimeout`
    // reset-to-ready path. A push-specific marker also includes things
    // like `orbit_push` / `git_commit_push` (where only the push leg
    // timed out — `git_commit_push_impl` preserves the commit SHA on
    // push failure, see `aura-harness/crates/aura-tools/src/git_tool`).
    let is_push = lower.contains("git push")
        || lower.contains("git_push")
        || lower.contains("git-push")
        || lower.contains("orbit_push")
        || lower.contains("commit+push")
        || lower.contains("git_commit_push");
    if is_push && (lower.contains("timed out") || lower.contains("timeout")) {
        return Some(InfraFailureClass::GitPushTimeout);
    }
    if (lower.contains("git ") || lower.contains("git_") || lower.contains("git-"))
        && (lower.contains("timed out") || lower.contains("timeout"))
    {
        return Some(InfraFailureClass::GitTimeout);
    }
    if lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("rate limited")
    {
        return Some(InfraFailureClass::ProviderRateLimited);
    }
    if lower.contains("529")
        || lower.contains("overloaded")
        || lower.contains("capacity")
        || lower.contains("temporarily unavailable")
        || lower.contains("server busy")
    {
        return Some(InfraFailureClass::ProviderOverloaded);
    }
    // Transient upstream 5xx from the LLM provider / proxy. Includes
    // mid-stream aborts surfaced by aura-reasoner as "stream terminated
    // with error: …" (see `aura-harness/crates/aura-reasoner/src/types/
    // streaming.rs`), which the harness wraps as "LLM error: …" before
    // the task_failed event carries the string here. Matched against
    // the lowercased reason so both the bare HTTP status codes and the
    // prose forms classify the same way.
    let has_5xx_status = lower.contains("500")
        || lower.contains("502")
        || lower.contains("503")
        || lower.contains("504");
    let has_5xx_prose = lower.contains("internal server error")
        || lower.contains("bad gateway")
        || lower.contains("service unavailable")
        || lower.contains("gateway timeout");
    let has_stream_abort = lower.contains("stream terminated")
        || lower.contains("stream closed prematurely")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("connection closed unexpectedly");
    if has_5xx_status || has_5xx_prose || has_stream_abort {
        return Some(InfraFailureClass::ProviderInternalError);
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return Some(InfraFailureClass::TransportTimeout);
    }
    None
}

fn infra_cooldown_for(class: InfraFailureClass) -> Duration {
    match class {
        InfraFailureClass::ProviderRateLimited => Duration::from_secs(60),
        InfraFailureClass::ProviderOverloaded => Duration::from_secs(30),
        // Provider 5xx / stream aborts typically clear faster than
        // rate-limit windows — keep the base cooldown short so a
        // single blip doesn't stall the loop for a minute.
        InfraFailureClass::ProviderInternalError => Duration::from_secs(10),
        InfraFailureClass::TransportTimeout => Duration::from_secs(20),
        InfraFailureClass::GitTimeout => Duration::from_secs(15),
        // `GitPushTimeout` never takes the pause-and-restart path, so
        // the cooldown is unused. Keep a small sentinel here so the
        // match remains exhaustive without implying a real backoff.
        InfraFailureClass::GitPushTimeout => Duration::from_secs(0),
    }
}

/// Heuristic: does `reason` *look* like a transient infra failure
/// even though [`classify_infra_failure`] returned `None`?
///
/// We use this for the `debug.retry_miss` telemetry — not to retry a
/// task silently, but to surface "the classifier is probably missing
/// this pattern" to whoever reads the run log bundle or an
/// `aura-run-heuristics` report. False positives here are cheap (a
/// few extra log lines); false negatives let classifier gaps hide,
/// which is exactly the class of problem Axis 4 exists to spot.
///
/// Deliberately uses a DIFFERENT word list than `classify_infra_failure`
/// so the two can't get out of sync silently — each new pattern we add
/// here should prompt a follow-up to decide whether it deserves its
/// own `InfraFailureClass`.
fn looks_like_unclassified_transient(reason: &str) -> bool {
    let lower = reason.to_lowercase();
    // Cheap list of words that generally imply "the provider / network
    // layer had a transient issue", ordered roughly by frequency in the
    // wild. If classify_infra_failure already matched these, the
    // outer `if let ...Some(infra_failure)` branch ran and this
    // helper is never called — so a match here means the classifier
    // has a gap.
    const HINTS: &[&str] = &[
        "econnreset",
        "socket hang up",
        "socket closed",
        "unexpected end of stream",
        "body stream",
        "deserialize",
        "parse error",
        "decode error",
        "tls handshake",
        "handshake failure",
        "dns",
        "name resolution",
        "connection refused",
        "network is unreachable",
        "temporary failure",
        "upstream disconnect",
        "upstream connect error",
        "stream reset",
        "rst_stream",
        "read econnaborted",
        "tokio::time::error::elapsed",
        "provider error",
        "anthropic",
        "openai",
        "proxy error",
    ];
    HINTS.iter().any(|h| lower.contains(h))
}

fn infra_failure_label(class: InfraFailureClass) -> &'static str {
    match class {
        InfraFailureClass::ProviderRateLimited => "provider_rate_limited",
        InfraFailureClass::ProviderOverloaded => "provider_overloaded",
        InfraFailureClass::ProviderInternalError => "provider_internal_error",
        InfraFailureClass::TransportTimeout => "transport_timeout",
        InfraFailureClass::GitTimeout => "git_timeout",
        InfraFailureClass::GitPushTimeout => "git_push_timeout",
    }
}

#[derive(Clone, Debug)]
struct ProjectCooldown {
    until: Instant,
    class: InfraFailureClass,
    reason: String,
    /// How many times in a row this project has hit this same failure
    /// class without a successful reset in between. Used to escalate
    /// the cooldown on repeated hits — a single 5xx gets the base 10s,
    /// the fourth in a row gets something closer to a minute. Reset
    /// to zero whenever `clear_project_cooldown` fires (i.e. a task
    /// actually made forward progress) or when the class changes.
    consecutive_count: u32,
}

/// Maximum per-class escalation multiplier. The effective cooldown is
/// `base * min(2^(count-1), ESCALATION_CAP)`, then capped by
/// `PROVIDER_BACKOFF_MAX_SECS`. 8x keeps escalation monotonic across
/// the first four hits and then flattens, which is plenty of runway
/// inside the 120-second ceiling and avoids starving the loop if a
/// provider is flapping but usually recovers.
const ESCALATION_CAP: u32 = 8;

/// Upper bound on jitter as a percentage of the pre-jitter cooldown.
/// ±20% is enough to de-synchronize retries across a fleet of loops
/// without making the post-jitter floor so small that we slam the
/// provider within a couple of seconds of the last failure.
const JITTER_PCT: u32 = 20;

/// Apply ±`JITTER_PCT`% jitter to `base`. Uses the current instant's
/// subsecond nanos as a pseudo-random source — not cryptographically
/// random, just enough entropy to keep separate loops from lock-stepping
/// into the same backoff window. Avoids pulling in the `rand` crate
/// for a ~2-line need.
///
/// The returned duration is guaranteed to lie in
/// `[base * (1 - JITTER_PCT/100), base * (1 + JITTER_PCT/100)]` and is
/// never zero unless `base` itself was zero.
fn apply_jitter(base: Duration) -> Duration {
    if base.is_zero() {
        return base;
    }
    let base_ms = base.as_millis() as u64;
    let pct = u64::from(JITTER_PCT);
    let span_ms = base_ms.saturating_mul(pct) / 100;
    if span_ms == 0 {
        return base;
    }
    // Use Instant's subsec_nanos plus the base's nanos as a cheap
    // mixing function. Different projects hitting cooldowns within
    // the same millisecond will still see different jitter because
    // their `base_ms` differs (class-dependent) and the instant ticks
    // on every call.
    let seed = Instant::now().elapsed().subsec_nanos() as u64
        ^ base.subsec_nanos() as u64
        ^ base_ms;
    let offset_ms = seed % (2 * span_ms + 1);
    let jittered_ms = base_ms.saturating_sub(span_ms).saturating_add(offset_ms);
    Duration::from_millis(jittered_ms.max(1))
}

/// Multiply `base` by `min(2^(count.saturating_sub(1)), ESCALATION_CAP)`.
/// `count = 0` or `1` leaves the cooldown unchanged; each additional
/// consecutive failure doubles it until the escalation cap, after
/// which further hits hold steady at `base * ESCALATION_CAP`. The
/// result is clamped to [`PROVIDER_BACKOFF_MAX_SECS`] here so callers
/// don't have to repeat the check.
fn escalate(base: Duration, count: u32) -> Duration {
    let factor = if count <= 1 {
        1u32
    } else {
        let shift = (count - 1).min(31);
        (1u32 << shift).min(ESCALATION_CAP)
    };
    let scaled = base.saturating_mul(factor);
    let cap = Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS);
    scaled.min(cap)
}

fn project_cooldowns() -> &'static std::sync::Mutex<HashMap<String, ProjectCooldown>> {
    static COOLDOWNS: std::sync::OnceLock<std::sync::Mutex<HashMap<String, ProjectCooldown>>> =
        std::sync::OnceLock::new();
    COOLDOWNS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

#[cfg(test)]
fn register_project_cooldown(
    project_id: ProjectId,
    class: InfraFailureClass,
    reason: &str,
) -> Duration {
    register_project_cooldown_with_hint(project_id, class, reason, None)
}

/// Like [`register_project_cooldown`] but lets the caller supply a
/// provider-supplied `Retry-After` hint (e.g. extracted from a 429
/// response). The effective cooldown is the larger of the class's
/// default (`infra_cooldown_for`) and the hint, clamped to
/// [`PROVIDER_BACKOFF_MAX_SECS`]. Using `max` rather than `hint or
/// default` means a provider that sends `Retry-After: 0` (which some
/// proxies do on cache misses) still gets a real backoff, and a hint
/// larger than our default is respected rather than ignored.
fn register_project_cooldown_with_hint(
    project_id: ProjectId,
    class: InfraFailureClass,
    reason: &str,
    hint: Option<Duration>,
) -> Duration {
    let key = project_id.to_string();
    let default = infra_cooldown_for(class);
    let cap = Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS);
    let mut guard = match project_cooldowns().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    // Per-class consecutive-failure counter: keeps escalating the
    // cooldown while the same class keeps firing, resets when the
    // class changes (new failure mode = new retry budget) or when
    // `clear_project_cooldown` runs after a successful iteration.
    // Reading the existing entry here before computing the effective
    // cooldown lets the escalation factor hit the first repeat — a
    // single 5xx gets 10s, the second in a row gets 20s, etc.
    let prior_count = guard
        .get(&key)
        .filter(|c| c.class == class)
        .map(|c| c.consecutive_count)
        .unwrap_or(0);
    let next_count = prior_count.saturating_add(1);
    let escalated_default = escalate(default, next_count);
    // A provider-supplied hint still wins when it's longer than our
    // escalated default — respecting `Retry-After` is more important
    // than our heuristic. When it's shorter, we hold the floor at
    // `escalated_default` so repeated short hints don't keep slamming
    // the provider every few seconds.
    let requested = hint
        .map(|h| h.min(cap).max(escalated_default))
        .unwrap_or(escalated_default);
    // Apply ±20% jitter AFTER escalation so the randomization scales
    // with the size of the window, keeping the ratio consistent.
    let jittered = apply_jitter(requested).min(cap);
    if let Some(existing) = guard.get_mut(&key) {
        // Longest-window-wins semantics preserved: if a larger hint
        // already landed and the remaining window is wider than what
        // we just computed, keep the existing `until` but refresh the
        // reason/class/count so the next failure builds on this chain.
        let remaining = existing.until.saturating_duration_since(Instant::now());
        if remaining >= jittered {
            existing.reason = reason.to_string();
            existing.class = class;
            existing.consecutive_count = next_count;
            return remaining;
        }
    }
    guard.insert(
        key,
        ProjectCooldown {
            until: Instant::now() + jittered,
            class,
            reason: reason.to_string(),
            consecutive_count: next_count,
        },
    );
    jittered
}

fn active_project_cooldown(project_id: ProjectId) -> Option<(Duration, InfraFailureClass, String)> {
    let key = project_id.to_string();
    let guard = match project_cooldowns().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let cooldown = guard.get(&key)?;
    let remaining = cooldown.until.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return None;
    }
    Some((remaining, cooldown.class, cooldown.reason.clone()))
}

fn loop_status_details(
    project_id: ProjectId,
    running: bool,
    paused: bool,
) -> (String, Option<u64>, Option<String>, Option<String>) {
    if let Some((remaining, class, reason)) = active_project_cooldown(project_id) {
        return (
            "cooldown".to_string(),
            Some(remaining.as_millis() as u64),
            Some(reason),
            Some(infra_failure_label(class).to_string()),
        );
    }
    let state = if paused {
        "paused"
    } else if running {
        "running"
    } else {
        "finished"
    };
    (state.to_string(), None, None, None)
}

/// Summary of what kinds of files a task actually touched. Drives the
/// Definition-of-Done gate: docs-only changes skip build/test, while
/// Rust source changes get the full four-gate treatment.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct PathChangeClassification {
    /// At least one changed path is source code we recognise (a file
    /// whose extension implies it participates in a build).
    has_source: bool,
    /// At least one changed path is a Rust source file (`*.rs`). When
    /// true, `has_source` is also true. `Cargo.lock` and `Cargo.toml`
    /// are not treated as Rust source for gate purposes — they don't
    /// change behavior on their own, and Cargo regenerates `Cargo.lock`
    /// on build.
    has_rust: bool,
}

/// Classify the set of changed paths into source/docs/Rust buckets.
///
/// Source extensions are deliberately conservative: if we're unsure,
/// we treat a path as docs-like so we don't false-fail a legitimate
/// content-only task. Adding an extension here tightens the gate; the
/// flip side is that new languages default to the loose docs treatment
/// until they're added.
fn classify_changed_paths(
    files_changed: &[aura_os_storage::StorageTaskFileChangeSummary],
) -> PathChangeClassification {
    const SOURCE_EXTS: &[&str] = &[
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".java", ".kt",
        ".swift", ".cpp", ".cc", ".c", ".h", ".hpp", ".cs", ".scala", ".php",
    ];
    let mut result = PathChangeClassification::default();
    for f in files_changed {
        let lower = f.path.to_ascii_lowercase();
        if lower.ends_with(".rs") {
            result.has_rust = true;
            result.has_source = true;
            continue;
        }
        if SOURCE_EXTS.iter().any(|ext| lower.ends_with(ext)) {
            result.has_source = true;
        }
    }
    result
}

/// Snapshot of the inputs the Definition-of-Done gate considered when
/// it decided whether to accept or reject a completion. Emitted as a
/// `task_completion_gate` domain event so supervisors and the UI can
/// audit gate decisions without having to replay the full run stream.
#[derive(Clone, Debug, Default, serde::Serialize)]
struct CompletionGateReport {
    had_live_output: bool,
    n_files_changed: usize,
    has_source_change: bool,
    has_rust_change: bool,
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    /// Number of `write_file`/`edit_file` calls the harness emitted with
    /// an empty or missing `path` input. Non-zero always fails the gate.
    n_empty_path_writes: u32,
    recovery_checkpoint: String,
    /// `None` on pass; the reason string that would be recorded on the
    /// task on fail.
    failure_reason: Option<String>,
}

impl CompletionGateReport {
    fn from_cached(cached: &CachedTaskOutput) -> Self {
        let paths = classify_changed_paths(&cached.files_changed);
        Self {
            had_live_output: !cached.live_output.trim().is_empty(),
            n_files_changed: cached.files_changed.len(),
            has_source_change: paths.has_source,
            has_rust_change: paths.has_rust,
            n_build_steps: cached.build_steps.len(),
            n_test_steps: cached.test_steps.len(),
            n_format_steps: cached.format_steps.len(),
            n_lint_steps: cached.lint_steps.len(),
            n_empty_path_writes: cached.empty_path_writes,
            recovery_checkpoint: recovery_checkpoint_label(recovery_checkpoint(cached)).to_string(),
            failure_reason: None,
        }
    }
}

/// Determine whether a cached task output represents genuine, verified work.
///
/// This is the **Definition-of-Done gate** that sits between the harness
/// emitting `task_completed` and the server transitioning the task to
/// `done` in storage. Rejects completions that either show no activity,
/// or show source-code changes without accompanying verification
/// evidence matching the change's language.
///
/// Layered checks (first failure wins):
///
/// 1. **Empty-path writes** — rejects runs where the harness emitted any
///    `write_file` / `edit_file` tool call with a missing or empty
///    `path` input. These cannot land on disk (the UI renders them as
///    "Untitled file") and are a strong signal the automaton
///    misfired. We reject rather than silently accept so the dev loop
///    retries with a real path.
/// 2. **Baseline activity** — rejects runs with no live output, no file
///    changes, and no verification steps. Catches automatons that claim
///    success after doing nothing.
/// 3. **Source-change evidence** — if the task modified a file with a
///    recognised source extension (`*.rs`, `*.ts`, `*.py`, etc.), the
///    run must include at least one build step and one test step. Docs
///    or config-only changes (`*.md`, `*.toml`, `*.yaml`, etc.) skip
///    this check since `cargo build` / `cargo test` would be nonsense
///    for them.
/// 4. **Rust-strict evidence** — if the task modified any `*.rs` file,
///    the run must additionally include a format step and a lint step
///    (e.g. `cargo fmt --check` and `cargo clippy`). This is the full
///    four-gate Definition of Done. Non-Rust source languages don't
///    currently get this treatment; we'll add them once the harness
///    reliably emits format/lint evidence for them.
fn completion_validation_failure_reason(cached: &CachedTaskOutput) -> Option<&'static str> {
    if cached.empty_path_writes > 0 {
        return Some(
            "Automaton emitted write_file/edit_file tool call(s) with an empty or missing \"path\" input; the harness must retry with a real path before task_done",
        );
    }

    let has_output = !cached.live_output.trim().is_empty();
    let has_file_changes = !cached.files_changed.is_empty();
    let has_build = !cached.build_steps.is_empty();
    let has_test = !cached.test_steps.is_empty();
    let has_fmt = !cached.format_steps.is_empty();
    let has_lint = !cached.lint_steps.is_empty();
    let has_verification = has_build || has_test;

    if !has_output && !has_file_changes && !has_verification {
        return Some(
            "Automaton reported task_completed without output, file changes, or verification evidence",
        );
    }

    let paths = classify_changed_paths(&cached.files_changed);

    if paths.has_source && !has_build {
        return Some(
            "Task modified source code but no build/compile step was run (Definition of Done: cargo build or equivalent must pass before task_done)",
        );
    }

    if paths.has_source && !has_test {
        return Some(
            "Task modified source code but no test step was run (Definition of Done: cargo test or equivalent must pass before task_done)",
        );
    }

    if paths.has_rust && !has_fmt {
        return Some(
            "Task modified Rust source but no format check was run (Definition of Done: cargo fmt --all -- --check must pass before task_done)",
        );
    }

    if paths.has_rust && !has_lint {
        return Some(
            "Task modified Rust source but no lint check was run (Definition of Done: cargo clippy --workspace --all-targets -- -D warnings must pass before task_done)",
        );
    }

    None
}

fn clear_project_cooldown(project_id: ProjectId) {
    let key = project_id.to_string();
    let mut guard = match project_cooldowns().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard
        .get(&key)
        .is_some_and(|cooldown| cooldown.until <= Instant::now())
    {
        guard.remove(&key);
    }
}

/// Returns true if the `AURA_AUTO_DECOMPOSE_DISABLED` env var is set to
/// `1` / `true` (case-insensitive). When set, Phase 3 remediation and
/// Phase 5 preflight decomposition are both no-ops and every failure
/// falls through to the existing retry path.
///
/// Shared across Phase 3 (post-failure remediation, this file) and
/// Phase 5 (preflight task decomposition,
/// [`super::task_decompose`]), both of which honour the same kill
/// switch.
pub(crate) fn auto_decompose_disabled() -> bool {
    std::env::var("AURA_AUTO_DECOMPOSE_DISABLED")
        .ok()
        .map(|v| {
            let trimmed = v.trim().to_ascii_lowercase();
            trimmed == "1" || trimmed == "true" || trimmed == "yes" || trimmed == "on"
        })
        .unwrap_or(false)
}

/// Module-local retry counter keyed by task id. Intentionally in-memory
/// (not persisted) — a server restart resets the budget, which is the
/// safe default: a stale retry count from a previous process shouldn't
/// permanently disable remediation on a task the operator is now
/// retrying manually.
fn remediation_retry_counts() -> &'static std::sync::Mutex<std::collections::HashMap<String, u32>> {
    static COUNTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, u32>>> =
        std::sync::OnceLock::new();
    COUNTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Increment the remediation-retry counter for `task_id` and return the
/// post-increment value. Also used to pre-check the budget: callers bail
/// out early if the current count has already reached
/// [`MAX_RETRIES_PER_TASK`].
fn bump_remediation_count(task_id: &str) -> u32 {
    let mut guard = match remediation_retry_counts().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let entry = guard.entry(task_id.to_string()).or_insert(0);
    *entry = entry.saturating_add(1);
    *entry
}

/// Read the current remediation-retry count without mutating it.
fn current_remediation_count(task_id: &str) -> u32 {
    let guard = match remediation_retry_counts().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard.get(task_id).unwrap_or(&0)
}

// ==========================================================================
// Axis 5 — Stateful resume preamble on retried tasks
// ==========================================================================
//
// When the dev loop restarts a task via `restart_with_infra_backoff` after a
// transient failure (5xx, stream abort, provider overload, …), the harness
// today starts the task from scratch with no knowledge that this is attempt
// N. The agent happily redoes any setup/search work it had already done,
// which both wastes provider tokens and pushes the task back into the same
// context-window shape that triggered the failure in the first place.
//
// The helpers below maintain an in-memory attempt counter and produce a
// short, stable "resume preamble" string that downstream consumers (UI and
// run bundles, via `task_retrying` / `debug.retry_preamble`) can surface to
// the LLM on the next turn.
//
// The counter lives alongside `remediation_retry_counts` and follows the same
// reset-on-process-restart policy: a stale attempt count shouldn't keep
// burning tokens on preamble injection for a task the operator is retrying
// by hand.

/// Module-local retry counter for infra-backoff restarts, keyed by task id.
/// Distinct from `remediation_retry_counts` because the two mechanisms have
/// independent budgets — remediation is a Phase 3 decision about task shape,
/// while these attempts are provider/network retries that should keep going
/// as long as the provider is actually transient.
fn retry_attempt_counts() -> &'static std::sync::Mutex<std::collections::HashMap<String, u32>> {
    static COUNTS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, u32>>> =
        std::sync::OnceLock::new();
    COUNTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Bump the retry-attempt counter for `task_id` and return the new count.
/// The first restart returns `1`; each subsequent restart returns `n + 1`.
fn bump_retry_attempt(task_id: &str) -> u32 {
    let mut guard = match retry_attempt_counts().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let entry = guard.entry(task_id.to_string()).or_insert(0);
    *entry = entry.saturating_add(1);
    *entry
}

/// Forget the retry-attempt counter for `task_id`. Called on terminal
/// states (`task_completed` / unrecoverable `task_failed`) so a subsequent
/// manual re-run of the same task starts from `1` instead of inheriting a
/// stale count from an earlier incident.
fn clear_retry_attempt(task_id: &str) {
    let mut guard = match retry_attempt_counts().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.remove(task_id);
}

/// Number of characters of the previous failure reason to include in the
/// preamble. Long enough to carry the HTTP status + human-readable prose
/// (e.g. "LLM error: stream terminated with error: Internal server error")
/// without dragging in multi-kilobyte provider body dumps that would blow
/// out the prompt budget on every retry.
const RETRY_PREAMBLE_REASON_BUDGET: usize = 240;

/// Build the stable, human-readable resume preamble surfaced on the
/// `task_retrying` event when the dev loop restarts a task after a transient
/// failure. Shape is deliberately fixed so the UI and any future harness
/// consumer can parse / pattern-match it reliably.
///
/// Format:
/// ```text
/// [aura-retry attempt=3] Previous attempt failed with: <reason-trimmed>.
/// Continue from where you left off; avoid re-running work that already
/// succeeded.
/// ```
///
/// Contract:
/// * `attempt` is 1-based (the first *restart* is attempt 2, so
///   `build_retry_preamble(2, ..)` is the shortest preamble ever produced).
///   Callers must not pass `0`; the function saturates to `1` in that case
///   so the output still parses cleanly.
/// * `previous_reason` is trimmed of surrounding whitespace and truncated
///   to [`RETRY_PREAMBLE_REASON_BUDGET`] chars with a `…` marker. Newlines
///   inside the reason are collapsed to single spaces so the preamble
///   stays on a predictable two-line shape.
fn build_retry_preamble(attempt: u32, previous_reason: &str) -> String {
    let attempt = attempt.max(1);
    let collapsed: String = previous_reason
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let trimmed = collapsed.trim();
    // Byte-length check before we walk chars for a clean UTF-8 truncation.
    let short = if trimmed.len() <= RETRY_PREAMBLE_REASON_BUDGET {
        trimmed.to_string()
    } else {
        let mut out = String::with_capacity(RETRY_PREAMBLE_REASON_BUDGET + 1);
        for ch in trimmed.chars() {
            if out.len() + ch.len_utf8() > RETRY_PREAMBLE_REASON_BUDGET {
                break;
            }
            out.push(ch);
        }
        out.push('…');
        out
    };
    format!(
        "[aura-retry attempt={attempt}] Previous attempt failed with: {short}. \
         Continue from where you left off; avoid re-running work that already \
         succeeded."
    )
}

/// Hard ceiling on any single provider-backoff duration. Provider
/// `Retry-After` hints longer than this are clamped so a pathological
/// response can't park the loop for an hour.
const PROVIDER_BACKOFF_MAX_SECS: u64 = 120;

/// Extract a suggested retry delay from a `task_failed` / `error`
/// event payload, returning `None` if nothing usable is present.
///
/// Preference order:
///   1. Structured `retry_after_ms` on the event root.
///   2. Structured `retry_after` (seconds, u64 or f64) on the event
///      root.
///   3. Nested `headers.retry-after` / `headers.Retry-After` header
///      value (seconds).
///   4. Free-form scan over the reason / error / message text for the
///      phrases the Anthropic SDK conventionally emits: `retry after
///      N`, `retry in N seconds`, `try again in N seconds`.
///
/// Result is clamped to [`PROVIDER_BACKOFF_MAX_SECS`].
fn extract_retry_after(event: &serde_json::Value) -> Option<Duration> {
    let cap = Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS);

    if let Some(ms) = event.get("retry_after_ms").and_then(|v| v.as_u64()) {
        return Some(Duration::from_millis(ms).min(cap));
    }
    if let Some(secs) = event.get("retry_after").and_then(|v| v.as_u64()) {
        return Some(Duration::from_secs(secs).min(cap));
    }
    if let Some(secs) = event.get("retry_after").and_then(|v| v.as_f64()) {
        if secs.is_finite() && secs > 0.0 {
            return Some(Duration::from_secs_f64(secs).min(cap));
        }
    }
    if let Some(headers) = event.get("headers").and_then(|v| v.as_object()) {
        for key in ["retry-after", "Retry-After", "retry_after"] {
            if let Some(value) = headers.get(key) {
                if let Some(secs) = value.as_u64() {
                    return Some(Duration::from_secs(secs).min(cap));
                }
                if let Some(text) = value.as_str() {
                    if let Ok(secs) = text.trim().parse::<u64>() {
                        return Some(Duration::from_secs(secs).min(cap));
                    }
                }
            }
        }
    }

    let text = ["reason", "error", "message"]
        .into_iter()
        .filter_map(|k| event.get(k).and_then(|v| v.as_str()))
        .collect::<Vec<_>>()
        .join(" ");
    parse_retry_after_seconds(&text).map(|secs| Duration::from_secs(secs).min(cap))
}

/// Parse a rate-limit retry hint out of free-form text. Matches
/// `retry after 30`, `retry in 30s`, `try again in 30 seconds`, etc.
/// Case-insensitive, stops at the first numeric match.
fn parse_retry_after_seconds(text: &str) -> Option<u64> {
    let lower = text.to_ascii_lowercase();
    let cues = [
        "retry after ",
        "retry in ",
        "try again in ",
        "please try again in ",
        "please retry in ",
        "please retry after ",
    ];
    for cue in cues {
        if let Some(idx) = lower.find(cue) {
            let tail = &lower[idx + cue.len()..];
            let digits: String = tail
                .chars()
                .skip_while(|c| c.is_whitespace())
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(secs) = digits.parse::<u64>() {
                if secs > 0 {
                    return Some(secs);
                }
            }
        }
    }
    None
}

/// Test-only predicate over [`classify_failure`].
pub(crate) fn is_rate_limited_failure_for_tests(reason: &str) -> bool {
    classify_failure(reason) == FailureClass::RateLimited
}

/// Test-only predicate over [`classify_infra_failure`].
pub(crate) fn is_git_push_timeout_failure_for_tests(reason: &str) -> bool {
    classify_infra_failure(reason) == Some(InfraFailureClass::GitPushTimeout)
}

pub(crate) fn completion_validation_failure_reason_for_tests(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
) -> Option<String> {
    completion_validation_failure_reason_with_empty_path_writes_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        0,
    )
}

pub(crate) fn completion_validation_failure_reason_with_empty_path_writes_for_tests(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    n_empty_path_writes: u32,
) -> Option<String> {
    let mut cached = CachedTaskOutput {
        live_output: live_output.to_string(),
        files_changed: files_changed
            .iter()
            .map(|path| aura_os_storage::StorageTaskFileChangeSummary {
                op: "modify".to_string(),
                path: (*path).to_string(),
                lines_added: 0,
                lines_removed: 0,
            })
            .collect(),
        empty_path_writes: n_empty_path_writes,
        ..Default::default()
    };
    cached.build_steps =
        vec![serde_json::json!({"type": "build_verification_passed"}); n_build_steps];
    cached.test_steps = vec![serde_json::json!({"type": "test_verification_passed"}); n_test_steps];
    cached.format_steps =
        vec![serde_json::json!({"type": "format_verification_passed"}); n_format_steps];
    cached.lint_steps = vec![serde_json::json!({"type": "lint_verification_passed"}); n_lint_steps];
    completion_validation_failure_reason(&cached).map(str::to_string)
}

pub(crate) fn recovery_checkpoint_for_tests(
    live_output: &str,
    files_changed: &[&str],
    git_steps: &[serde_json::Value],
) -> &'static str {
    let cached = CachedTaskOutput {
        live_output: live_output.to_string(),
        files_changed: files_changed
            .iter()
            .map(|path| aura_os_storage::StorageTaskFileChangeSummary {
                op: "modify".to_string(),
                path: (*path).to_string(),
                lines_added: 0,
                lines_removed: 0,
            })
            .collect(),
        git_steps: git_steps.to_vec(),
        ..Default::default()
    };
    recovery_checkpoint_label(recovery_checkpoint(&cached))
}

/// Locate the newest run bundle directory for a given
/// `(project_id, agent_instance_id)`. Used by the remediation path to
/// run `aura_run_heuristics` against the just-failed run without having
/// to know the exact `run_id` up front.
async fn latest_run_dir_for(
    loop_log: &crate::loop_log::LoopLogWriter,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) -> Option<std::path::PathBuf> {
    let runs = loop_log.list_runs(project_id).await;
    let run = runs
        .into_iter()
        .find(|r| r.agent_instance_id == agent_instance_id)?;
    Some(loop_log.bundle_dir(project_id, &run.run_id))
}

/// Locate the failed task in storage by id.
///
/// `TaskService::get_task` requires project/spec ids that the event
/// payload doesn't always carry, so we fall back to a project-wide
/// `list_tasks` scan. Returns `None` on any storage/auth error so the
/// caller can silently fall through to the existing retry path.
async fn find_task_by_id(
    task_service: &TaskService,
    project_id: ProjectId,
    task_id: &str,
) -> Option<aura_os_core::Task> {
    let parsed: TaskId = task_id.parse().ok()?;
    let tasks = task_service.list_tasks(&project_id).await.ok()?;
    tasks.into_iter().find(|t| t.task_id == parsed)
}

/// Create two follow-up tasks (skeleton + fill) that together replace a
/// write that was too big for a single turn. Returns the child task ids
/// on success.
///
/// Thin wrapper around
/// [`super::task_decompose::spawn_skeleton_and_fill_children`] that
/// supplies the Phase 3 post-failure [`DecompositionContext`] so the
/// child-task prompt header reads `"AUTO-DECOMPOSED from a truncated
/// run."` (the exact wording Phase 3 has always used). Phase 5 uses the
/// same helper with a `Preflight` context for a different header.
async fn decompose_truncated_task(
    task_service: &TaskService,
    parent: &aura_os_core::Task,
    path: &str,
    chunk_bytes: usize,
) -> Result<Vec<TaskId>, aura_os_tasks::TaskError> {
    super::task_decompose::spawn_skeleton_and_fill_children(
        task_service,
        parent,
        Some(path),
        chunk_bytes,
        super::task_decompose::DecompositionContext::PostFailure {
            reason: "truncated_run".to_string(),
        },
    )
    .await
}

/// Create a single follow-up task whose prompt discourages the
/// overlapping-search pattern flagged by `ReshapeSearchQuery`.
async fn enqueue_reshaped_retry(
    task_service: &TaskService,
    parent: &aura_os_core::Task,
    reason: &str,
) -> Result<Vec<TaskId>, aura_os_tasks::TaskError> {
    let title = format!("{} [retry: reshape-search]", parent.title);
    let description = format!(
        "AUTO-RETRY after a run where search queries repeatedly overlapped.\n\n\
         {reason}\n\n\
         Before any write, consolidate your search needs into ONE refined\n\
         search_code call. Do NOT issue two search_code calls whose patterns\n\
         share alternation terms.\n\n\
         Original task description:\n\
         {}",
        parent.description
    );
    let child = task_service
        .create_follow_up_task(parent, title, description, Vec::new())
        .await?;
    Ok(vec![child.task_id])
}

/// Create a single follow-up task whose prompt forces a tool call on
/// the first turn, steering the agent away from text-only iterations.
async fn enqueue_force_tool_retry(
    task_service: &TaskService,
    parent: &aura_os_core::Task,
) -> Result<Vec<TaskId>, aura_os_tasks::TaskError> {
    let title = format!("{} [retry: force-tool]", parent.title);
    let description = format!(
        "AUTO-RETRY after a run with consecutive text-only turns.\n\n\
         On your very first turn, call exactly ONE tool (submit_plan, read_file,\n\
         or a small write_file skeleton). Do NOT narrate a multi-paragraph plan.\n\n\
         Original task description:\n\
         {}",
        parent.description
    );
    let child = task_service
        .create_follow_up_task(parent, title, description, Vec::new())
        .await?;
    Ok(vec![child.task_id])
}

/// Attempt to remediate a `task_failed` event by auto-decomposing or
/// reshaping the task based on the first actionable
/// `RemediationHint` the heuristic pipeline emits.
///
/// Returns `true` when at least one follow-up task was persisted and a
/// `task_auto_remediated` domain event was broadcast. Returns `false`
/// on any short-circuit (flag disabled, non-truncation failure, budget
/// exhausted, missing parent task, heuristics produced nothing usable,
/// or storage failure) so the caller can fall back to the existing
/// retry path.
#[allow(clippy::too_many_arguments)]
async fn try_remediate_task_failure(
    task_service: &TaskService,
    loop_log: &crate::loop_log::LoopLogWriter,
    broadcast_tx: &tokio::sync::broadcast::Sender<serde_json::Value>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    failure_reason: &str,
) -> bool {
    if auto_decompose_disabled() {
        return false;
    }
    if classify_failure(failure_reason) != FailureClass::Truncation {
        return false;
    }
    if current_remediation_count(task_id) >= MAX_RETRIES_PER_TASK {
        warn!(
            %task_id,
            "Skipping Phase 3 remediation: task has reached MAX_RETRIES_PER_TASK"
        );
        return false;
    }

    let Some(bundle_dir) = latest_run_dir_for(loop_log, project_id, agent_instance_id).await else {
        warn!(%task_id, "Skipping Phase 3 remediation: no run bundle on disk yet");
        return false;
    };
    let view = match aura_run_heuristics::load_bundle(&bundle_dir) {
        Ok(v) => v,
        Err(error) => {
            warn!(%task_id, %error, path = %bundle_dir.display(), "Skipping Phase 3 remediation: failed to load run bundle");
            return false;
        }
    };
    let findings = aura_run_heuristics::analyze(&view);
    let Some(hint) = findings
        .into_iter()
        .filter_map(|f| f.remediation)
        .find(|r| {
            matches!(
                r,
                aura_run_heuristics::RemediationHint::SplitWriteIntoSkeletonPlusAppends { .. }
                    | aura_run_heuristics::RemediationHint::ReshapeSearchQuery { .. }
                    | aura_run_heuristics::RemediationHint::ForceToolCallNextTurn
            )
        })
    else {
        return false;
    };

    let Some(parent) = find_task_by_id(task_service, project_id, task_id).await else {
        warn!(%task_id, "Skipping Phase 3 remediation: parent task not found in storage");
        return false;
    };

    let (kind, result) = match &hint {
        aura_run_heuristics::RemediationHint::SplitWriteIntoSkeletonPlusAppends {
            path,
            suggested_chunk_bytes,
        } => (
            "split_write",
            decompose_truncated_task(task_service, &parent, path, *suggested_chunk_bytes).await,
        ),
        aura_run_heuristics::RemediationHint::ReshapeSearchQuery { reason, .. } => (
            "reshape_search",
            enqueue_reshaped_retry(task_service, &parent, reason).await,
        ),
        aura_run_heuristics::RemediationHint::ForceToolCallNextTurn => (
            "force_tool_call",
            enqueue_force_tool_retry(task_service, &parent).await,
        ),
        // Unreachable — the find() above filtered everything else out.
        _ => return false,
    };

    let child_ids = match result {
        Ok(ids) => ids,
        Err(error) => {
            warn!(%task_id, kind, %error, "Phase 3 remediation failed to create follow-up tasks");
            return false;
        }
    };

    let child_id_strings: Vec<String> = child_ids.iter().map(|id| id.to_string()).collect();
    let new_count = bump_remediation_count(task_id);

    info!(
        %task_id,
        kind,
        retry_count = new_count,
        children = ?child_id_strings,
        "Phase 3 auto-remediated a truncation failure"
    );

    emit_domain_event(
        broadcast_tx,
        "task_auto_remediated",
        project_id,
        agent_instance_id,
        serde_json::json!({
            "parent_task_id": task_id,
            "child_task_ids": child_id_strings,
            "hint_kind": kind,
            "retry_count": new_count,
        }),
    );

    true
}

fn is_work_event_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "task_started"
            | "text_delta"
            | "thinking_delta"
            | "tool_call_started"
            | "tool_call_snapshot"
            | "tool_result"
            | "log_line"
            | "progress"
    )
}

fn map_passthrough_event_type(event_type: &str) -> Option<&'static str> {
    match event_type {
        "started" => Some("loop_started"),
        "stopped" => Some("loop_stopped"),
        "paused" => Some("loop_paused"),
        "resumed" => Some("loop_resumed"),
        "task_started" => Some("task_started"),
        "task_retrying" => Some("task_retrying"),
        "loop_finished" => Some("loop_finished"),
        "token_usage" => Some("token_usage"),
        "text_delta" => Some("text_delta"),
        "thinking_delta" => Some("thinking_delta"),
        "tool_call_started" => Some("tool_use_start"),
        "tool_call_snapshot" => Some("tool_call_snapshot"),
        "tool_result" => Some("tool_result"),
        "progress" => Some("progress"),
        "git_pushed" => Some("git_pushed"),
        "git_committed" => Some("git_committed"),
        _ => None,
    }
}

fn automaton_is_active(status: &serde_json::Value) -> bool {
    if let Some(running) = status.get("running").and_then(|v| v.as_bool()) {
        return running;
    }
    let state = status
        .get("state")
        .or_else(|| status.get("status"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_ascii_lowercase());
    match state.as_deref() {
        // Paused loops are still active for singleton semantics.
        Some("running" | "active" | "started" | "paused") => true,
        Some(
            "done" | "stopped" | "finished" | "failed" | "cancelled" | "terminated" | "completed",
        ) => false,
        // Unknown schema/state: stay conservative and treat as active.
        _ => true,
    }
}

fn automaton_client_for_mode(
    state: &AppState,
    mode: HarnessMode,
    swarm_agent_id: Option<&str>,
    jwt: Option<&str>,
) -> Result<std::sync::Arc<aura_os_link::AutomatonClient>, (StatusCode, Json<ApiError>)> {
    match mode {
        HarnessMode::Local => Ok(state.automaton_client.clone()),
        HarnessMode::Swarm => {
            let base = state
                .swarm_base_url
                .as_deref()
                .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?;
            let base = base.trim_end_matches('/');
            let scoped_base = match swarm_agent_id {
                Some(aid) => format!("{base}/v1/agents/{aid}"),
                None => base.to_string(),
            };
            let client =
                aura_os_link::AutomatonClient::new(&scoped_base).with_auth(jwt.map(String::from));
            Ok(std::sync::Arc::new(client))
        }
    }
}

fn extract_run_command(event: &serde_json::Value) -> Option<String> {
    if event.get("name").and_then(|value| value.as_str()) != Some("run_command") {
        return None;
    }

    let input = event.get("input")?;
    if let Some(command) = input.get("command").and_then(|value| value.as_str()) {
        let command = command.trim();
        if !command.is_empty() {
            return Some(command.to_string());
        }
    }

    let program = input
        .get("program")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let args: Vec<&str> = input
        .get("args")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().filter_map(|value| value.as_str()).collect())
        .unwrap_or_default();

    if args.is_empty() {
        Some(program.to_string())
    } else {
        Some(format!("{program} {}", args.join(" ")))
    }
}

fn classify_run_command_steps(
    event_type: &str,
    event: &serde_json::Value,
) -> Vec<VerificationStepKind> {
    if !matches!(event_type, "tool_call_snapshot" | "tool_call_completed") {
        return Vec::new();
    }

    let Some(command) = extract_run_command(event) else {
        return Vec::new();
    };
    let normalized = command.to_ascii_lowercase();

    let build_markers = [
        "npm run build",
        "npm build",
        "pnpm run build",
        "pnpm build",
        "yarn run build",
        "yarn build",
        "bun run build",
        "bun build",
        "cargo build",
        "cargo check",
        "go build",
        "vite build",
        "next build",
        "turbo build",
        "mvn package",
        "mvn verify",
        "gradle build",
        "./gradlew build",
        "make build",
        "tsc",
    ];
    let test_markers = [
        "npm run test",
        "npm test",
        "pnpm run test",
        "pnpm test",
        "yarn run test",
        "yarn test",
        "bun run test",
        "bun test",
        "cargo test",
        "cargo nextest",
        "pytest",
        "go test",
        "vitest",
        "jest",
        "playwright test",
        "mvn test",
        "gradle test",
        "./gradlew test",
        "tox",
        "rspec",
    ];
    // Format-check commands: anything that verifies code style without
    // rewriting files. Evidence of one of these being run satisfies the
    // `fmt` leg of the Definition-of-Done gate.
    let format_markers = [
        "cargo fmt",
        "rustfmt",
        "prettier --check",
        "prettier -c",
        "npm run format",
        "pnpm run format",
        "yarn run format",
        "ruff format --check",
        "black --check",
        "gofmt -l",
        "dprint check",
    ];
    // Lint commands. Substring-based — tolerates flag suffixes like
    // `-- -D warnings` or `--all-targets`.
    let lint_markers = [
        "cargo clippy",
        "eslint",
        "npm run lint",
        "pnpm run lint",
        "yarn run lint",
        "bun run lint",
        "ruff check",
        "pylint",
        "mypy",
        "golangci-lint",
        "swiftlint",
        "ktlint",
    ];

    let mut kinds = Vec::new();
    if build_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        kinds.push(VerificationStepKind::Build);
    }
    if test_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        kinds.push(VerificationStepKind::Test);
    }
    if format_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        kinds.push(VerificationStepKind::Format);
    }
    if lint_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        kinds.push(VerificationStepKind::Lint);
    }
    kinds
}

#[derive(Clone, Debug, Default)]
struct TurnUsageSnapshot {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    cumulative_input_tokens: Option<u64>,
    cumulative_output_tokens: Option<u64>,
    cumulative_cache_creation_input_tokens: Option<u64>,
    cumulative_cache_read_input_tokens: Option<u64>,
    estimated_context_tokens: Option<u64>,
    context_utilization: Option<f64>,
    model: Option<String>,
    provider: Option<String>,
}

fn usage_payload(event: &serde_json::Value) -> &serde_json::Value {
    event.get("usage").unwrap_or(event)
}

fn extract_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(serde_json::Value::as_u64)
}

fn extract_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn extract_turn_usage(event: &serde_json::Value) -> Option<TurnUsageSnapshot> {
    let usage = usage_payload(event);
    let input_tokens = extract_u64(usage, "input_tokens")?;
    let output_tokens = extract_u64(usage, "output_tokens")?;

    Some(TurnUsageSnapshot {
        input_tokens,
        output_tokens,
        cache_creation_input_tokens: extract_u64(usage, "cache_creation_input_tokens")
            .unwrap_or_default(),
        cache_read_input_tokens: extract_u64(usage, "cache_read_input_tokens").unwrap_or_default(),
        cumulative_input_tokens: extract_u64(usage, "cumulative_input_tokens"),
        cumulative_output_tokens: extract_u64(usage, "cumulative_output_tokens"),
        cumulative_cache_creation_input_tokens: extract_u64(
            usage,
            "cumulative_cache_creation_input_tokens",
        ),
        cumulative_cache_read_input_tokens: extract_u64(
            usage,
            "cumulative_cache_read_input_tokens",
        ),
        estimated_context_tokens: extract_u64(usage, "estimated_context_tokens"),
        context_utilization: usage
            .get("context_utilization")
            .and_then(serde_json::Value::as_f64),
        model: extract_string(usage, "model"),
        provider: extract_string(usage, "provider"),
    })
}

fn extract_token_usage(event: &serde_json::Value) -> Option<(u64, u64)> {
    let usage = extract_turn_usage(event)?;
    Some((usage.input_tokens, usage.output_tokens))
}

fn extract_files_changed(event: &serde_json::Value) -> Vec<StorageTaskFileChangeSummary> {
    let Some(files_changed) = event.get("files_changed") else {
        return Vec::new();
    };

    [
        ("create", "created"),
        ("modify", "modified"),
        ("delete", "deleted"),
    ]
    .into_iter()
    .flat_map(|(op, key)| {
        files_changed
            .get(key)
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(move |value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                    .map(|path| StorageTaskFileChangeSummary {
                        op: op.to_string(),
                        path: path.to_string(),
                        lines_added: 0,
                        lines_removed: 0,
                    })
            })
    })
    .collect()
}

/// Returns `true` if `event` is a `tool_call_started` / `tool_call_snapshot`
/// for `write_file` or `edit_file` whose `input.path` is missing, not a
/// string, or empty/whitespace-only.
///
/// These events cannot land on disk (the UI renders them as "Untitled
/// file") and indicate the automaton misfired. The DoD gate rejects any
/// task whose harness emitted at least one so the dev loop retries with
/// a real path.
pub(crate) fn is_empty_path_write_event_for_tests(
    event_type: &str,
    event: &serde_json::Value,
) -> bool {
    is_empty_path_write_event(event_type, event)
}

pub(crate) fn preflight_local_workspace_for_tests(
    project_path: &str,
    git_repo_url: Option<&str>,
) -> Result<(), String> {
    preflight_local_workspace(HarnessMode::Local, project_path, git_repo_url)
        .map_err(|err| err.1 .0.error.clone())
}

fn is_empty_path_write_event(event_type: &str, event: &serde_json::Value) -> bool {
    if !matches!(
        event_type,
        "tool_call_started" | "tool_call_snapshot" | "tool_call_completed"
    ) {
        return false;
    }
    let name = event.get("name").and_then(|v| v.as_str());
    if !matches!(name, Some("write_file") | Some("edit_file")) {
        return false;
    }
    let path = event
        .get("input")
        .and_then(|input| input.get("path"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    path.is_empty()
}

fn latest_git_commit_sha(git_steps: &[serde_json::Value]) -> Option<String> {
    git_steps.iter().rev().find_map(|step| {
        step.get("commit_sha")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    })
}

fn sync_string_field(event: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        event
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    })
}

fn sync_attempt_field(event: &serde_json::Value) -> Option<u32> {
    ["attempt", "retry_attempt"].iter().find_map(|key| {
        event
            .get(*key)
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
    })
}

fn sync_commit_sha(event: &serde_json::Value) -> Option<String> {
    sync_string_field(event, &["commit_sha", "sha"]).or_else(|| {
        event
            .get("commits")
            .and_then(serde_json::Value::as_array)
            .and_then(|commits| commits.last())
            .and_then(|commit| commit.get("sha"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    })
}

fn checkpoint_phase_for_event(event_type: &str) -> Option<&'static str> {
    match event_type {
        "task_started" => Some("executing"),
        "task_retrying" => Some("retrying"),
        "git_committed" => Some("committed"),
        "git_commit_failed" => Some("commit_failed"),
        "git_pushed" => Some("pushed"),
        "git_push_failed" => Some("push_failed"),
        "task_completed" => Some("completed"),
        "task_failed" => Some("failed"),
        _ => None,
    }
}

fn build_task_sync_checkpoint(event: &serde_json::Value) -> Option<TaskSyncCheckpoint> {
    let event_type = event.get("type").and_then(|t| t.as_str())?;
    Some(TaskSyncCheckpoint {
        kind: event_type.to_string(),
        phase: checkpoint_phase_for_event(event_type).map(str::to_owned),
        commit_sha: sync_commit_sha(event),
        branch: sync_string_field(event, &["branch", "git_branch"]),
        repo: sync_string_field(event, &["repo", "remote", "remote_name"]),
        reason: sync_string_field(event, &["reason", "error", "message"]),
        attempt: sync_attempt_field(event),
        observed_at: sync_string_field(event, &["created_at", "timestamp"]),
    })
}

fn update_task_sync_progress(
    cached: &mut CachedTaskOutput,
    event: &serde_json::Value,
) -> Option<(TaskSyncCheckpoint, TaskSyncState)> {
    let checkpoint = build_task_sync_checkpoint(event)?;
    cached.sync_checkpoints.push(checkpoint.clone());
    let state = derive_sync_state_from_checkpoints(&cached.sync_checkpoints)?;
    cached.sync_state = Some(state.clone());
    Some((checkpoint, state))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecoveryCheckpoint {
    NoProgress,
    OutputObserved,
    WorkspaceChanged,
    CommitCreated,
    RemoteSynced,
}

fn recovery_checkpoint_label(checkpoint: RecoveryCheckpoint) -> &'static str {
    match checkpoint {
        RecoveryCheckpoint::NoProgress => "no_progress",
        RecoveryCheckpoint::OutputObserved => "output_observed",
        RecoveryCheckpoint::WorkspaceChanged => "workspace_changed",
        RecoveryCheckpoint::CommitCreated => "commit_created",
        RecoveryCheckpoint::RemoteSynced => "remote_synced",
    }
}

fn recovery_checkpoint(cached: &CachedTaskOutput) -> RecoveryCheckpoint {
    let has_push = cached
        .git_steps
        .iter()
        .rev()
        .any(|step| step.get("type").and_then(serde_json::Value::as_str) == Some("git_pushed"));
    if has_push {
        return RecoveryCheckpoint::RemoteSynced;
    }
    if latest_git_commit_sha(&cached.git_steps).is_some() {
        return RecoveryCheckpoint::CommitCreated;
    }
    if !cached.files_changed.is_empty() {
        return RecoveryCheckpoint::WorkspaceChanged;
    }
    if !cached.live_output.trim().is_empty() {
        return RecoveryCheckpoint::OutputObserved;
    }
    RecoveryCheckpoint::NoProgress
}

fn default_fee_schedule() -> [(&'static str, f64, f64); 3] {
    [
        ("claude-opus-4-6", 5.0, 25.0),
        ("claude-sonnet-4-5", 3.0, 15.0),
        ("claude-haiku-4-5", 0.80, 4.00),
    ]
}

#[derive(Clone, Copy, Debug)]
struct ModelRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

fn lookup_model_rates(model: &str) -> ModelRates {
    let normalized_model = model.trim().to_ascii_lowercase();
    let mut exact: Vec<_> = default_fee_schedule()
        .into_iter()
        .filter(|(candidate, _, _)| *candidate == normalized_model)
        .collect();
    if let Some((_, input, output)) = exact.pop() {
        return ModelRates {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: input * 0.10,
        };
    }

    let mut partial: Vec<_> = default_fee_schedule()
        .into_iter()
        .filter(|(candidate, _, _)| {
            normalized_model.starts_with(candidate) || candidate.starts_with(&normalized_model)
        })
        .collect();
    if let Some((_, input, output)) = partial.pop() {
        return ModelRates {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: input * 0.10,
        };
    }

    default_fee_schedule()
        .into_iter()
        .next()
        .map(|(_, input, output)| ModelRates {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: input * 0.10,
        })
        .unwrap_or(ModelRates {
            input: 5.0,
            output: 25.0,
            cache_write: 6.25,
            cache_read: 0.5,
        })
}

fn estimate_usage_cost_usd(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
) -> f64 {
    let rates = lookup_model_rates(model);
    input_tokens as f64 * rates.input / 1_000_000.0
        + output_tokens as f64 * rates.output / 1_000_000.0
        + cache_creation_input_tokens as f64 * rates.cache_write / 1_000_000.0
        + cache_read_input_tokens as f64 * rates.cache_read / 1_000_000.0
}

#[derive(Clone)]
struct UsageReportingContext {
    network_client: Arc<NetworkClient>,
    access_token: String,
    network_user_id: String,
    model: String,
    org_id: Option<String>,
}

async fn report_automaton_usage(
    usage: &UsageReportingContext,
    project_id: ProjectId,
    turn_usage: &TurnUsageSnapshot,
) {
    let model = turn_usage.model.as_deref().unwrap_or(&usage.model);
    let estimated_cost_usd = estimate_usage_cost_usd(
        model,
        turn_usage.input_tokens,
        turn_usage.output_tokens,
        turn_usage.cache_creation_input_tokens,
        turn_usage.cache_read_input_tokens,
    );
    let req = ReportUsageRequest {
        user_id: usage.network_user_id.clone(),
        model: model.to_string(),
        input_tokens: turn_usage.input_tokens,
        output_tokens: turn_usage.output_tokens,
        estimated_cost_usd,
        org_id: usage.org_id.clone(),
        agent_id: None,
        project_id: Some(project_id.to_string()),
        duration_ms: None,
    };

    if let Err(error) = usage
        .network_client
        .report_usage(&req, &usage.access_token)
        .await
    {
        warn!(%project_id, model, %error, "Failed to report automaton usage");
    }
}

async fn create_automaton_session(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    active_task_id: Option<TaskId>,
    model_override: Option<String>,
    jwt: Option<&str>,
) -> Option<SessionId> {
    let model = if model_override.is_some() {
        model_override
    } else {
        state
            .agent_instance_service
            .get_instance(&project_id, &agent_instance_id)
            .await
            .ok()
            .and_then(|instance| preferred_automaton_model(&instance))
    };
    let user_id = jwt
        .and_then(|j| state.validation_cache.get(j))
        .map(|entry| entry.session.user_id.clone());

    match state
        .session_service
        .create_session(CreateSessionParams {
            agent_instance_id,
            project_id,
            active_task_id,
            summary: String::new(),
            user_id,
            model,
        })
        .await
    {
        Ok(session) => Some(session.session_id),
        Err(error) => {
            warn!(%project_id, %agent_instance_id, %error, "Failed to create automaton session");
            None
        }
    }
}

async fn build_usage_reporting_context(
    state: &AppState,
    _project_id: ProjectId,
    _agent_instance_id: AgentInstanceId,
    org_id: Option<String>,
    model: Option<String>,
    jwt: Option<&str>,
) -> Option<UsageReportingContext> {
    let network_client = state.network_client.as_ref()?.clone();
    let jwt_str = jwt?;
    let cached = state.validation_cache.get(jwt_str)?;
    let network_user_id = cached.session.network_user_id.as_ref()?;

    Some(UsageReportingContext {
        network_client,
        access_token: jwt_str.to_string(),
        network_user_id: network_user_id.to_string(),
        model: model.unwrap_or_else(|| "claude-opus-4-6".to_string()),
        org_id,
    })
}

fn preferred_automaton_model(instance: &aura_os_core::AgentInstance) -> Option<String> {
    instance
        .default_model
        .clone()
        .or_else(|| instance.model.clone())
}

fn requested_automaton_model(
    requested_model: Option<&str>,
    instance: &aura_os_core::AgentInstance,
) -> Option<String> {
    requested_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| preferred_automaton_model(instance))
}

async fn close_automaton_session(
    storage_client: Option<&std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<&str>,
    session_id: SessionId,
    status: &str,
) {
    let (Some(storage_client), Some(jwt)) = (storage_client, jwt) else {
        return;
    };

    let req = aura_os_storage::UpdateSessionRequest {
        status: Some(status.to_string()),
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
        summary_of_previous_context: None,
        tasks_worked_count: None,
        ended_at: Some(Utc::now().to_rfc3339()),
    };
    if let Err(error) = storage_client
        .update_session(&session_id.to_string(), jwt, &req)
        .await
    {
        warn!(%session_id, %error, "Failed to close automaton session");
    }
}
struct ForwardParams {
    automaton_events_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    app_broadcast: tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
    task_service: std::sync::Arc<TaskService>,
    task_output_cache: TaskOutputCache,
    storage_client: Option<std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<String>,
    session_id: Option<SessionId>,
    session_service: std::sync::Arc<aura_os_sessions::SessionService>,
    agent_instance_service: std::sync::Arc<aura_os_agents::AgentInstanceService>,
    usage_reporting: Option<UsageReportingContext>,
    router_url: String,
    http_client: reqwest::Client,
    /// When set, the forward loop can restart the automaton once on an
    /// infra-transient failure (stream closed without a terminal event, or
    /// an `error` event with no accompanying `task_failed`). Consumed on use.
    retry: Option<TransientRetryContext>,
    /// Cleared (`store(false)`) when the forwarder terminates for any
    /// reason. `start_loop` reads this on adoption to detect whether a
    /// live forwarder is already attached to the active automaton and
    /// can therefore be reused instead of spawning a duplicate.
    alive: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Filesystem logger that persists every forwarded event into a run
    /// bundle (see `crate::loop_log`). Always wired so the Debug app
    /// and the `aura-run-analyze` CLI can replay any run.
    loop_log: std::sync::Arc<crate::loop_log::LoopLogWriter>,
}

/// RAII guard that flips the shared `alive` flag to `false` when the
/// forwarder task returns. Covers every exit path (normal end, stream
/// close, `break`/`return`, or panic-induced drop) so callers never
/// observe a stale "alive" marker for a dead forwarder.
struct ForwarderAliveGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl Drop for ForwarderAliveGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

#[derive(Clone)]
struct TransientRetryContext {
    automaton_client: std::sync::Arc<aura_os_link::AutomatonClient>,
    start_params: AutomatonStartParams,
    /// `None` means "retry indefinitely with backoff". `Some(n)` counts
    /// down each time the caller consumes a restart attempt.
    restart_budget: Option<u32>,
}

/// Restart budget for user-initiated single-task runs
/// (`POST /api/projects/:project_id/tasks/:task_id/run`).
///
/// The dev loop itself uses `None` (unlimited) because its scheduler
/// will pick the task up again on the next iteration. Single-task runs
/// are one-shot from the user's perspective, so the budget caps how
/// many infra-level restarts a single click can schedule.
///
/// 3 was chosen to give a ~30-60s healing window when combined with
/// the existing `ProviderInternalError` cooldown (10s base with
/// escalation via `escalate_by_count` up to ~40s). A budget of 1 (the
/// previous value) meant a single mid-stream provider 500 terminally
/// failed the retry even though `classify_infra_failure` had
/// identified the error as transient.
const SINGLE_TASK_RESTART_BUDGET: u32 = 3;

fn take_retry_context(retry: &mut Option<TransientRetryContext>) -> Option<TransientRetryContext> {
    let ctx = retry.as_mut()?;
    match ctx.restart_budget.as_mut() {
        Some(remaining) if *remaining == 0 => None,
        Some(remaining) => {
            *remaining -= 1;
            Some(ctx.clone())
        }
        None => Some(ctx.clone()),
    }
}

async fn reset_task_for_infra_retry(
    task_service: &TaskService,
    project_id: ProjectId,
    task_id: &str,
) -> Result<(), String> {
    let task = find_task_by_id(task_service, project_id, task_id)
        .await
        .ok_or_else(|| format!("unable to resolve failed task {task_id} for retry"))?;
    task_service
        .reset_task_to_ready(&project_id, &task.spec_id, &task.task_id)
        .await
        .map(|_| ())
        .map_err(|error| format!("failed to reset task {task_id} to ready: {error}"))
}

async fn pause_for_project_cooldown(
    app_broadcast: &tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: &AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<&str>,
    reason: &str,
    failure: InfraFailureClass,
    retry_after_hint: Option<Duration>,
) {
    let cooldown =
        register_project_cooldown_with_hint(project_id, failure, reason, retry_after_hint);
    {
        let mut reg = automaton_registry.lock().await;
        if let Some(entry) = reg.get_mut(&agent_instance_id) {
            entry.paused = true;
            entry.current_task_id = None;
        }
    }
    emit_domain_event(
        app_broadcast,
        "loop_paused",
        project_id,
        agent_instance_id,
        serde_json::json!({
            "task_id": task_id.map(str::to_owned),
            "reason": reason,
            "retry_kind": infra_failure_label(failure),
            "cooldown_ms": cooldown.as_millis() as u64,
        }),
    );
    tokio::time::sleep(cooldown).await;
    clear_project_cooldown(project_id);
    {
        let mut reg = automaton_registry.lock().await;
        if let Some(entry) = reg.get_mut(&agent_instance_id) {
            entry.paused = false;
        }
    }
    emit_domain_event(
        app_broadcast,
        "loop_resumed",
        project_id,
        agent_instance_id,
        serde_json::json!({
            "task_id": task_id.map(str::to_owned),
            "reason": reason,
            "retry_kind": infra_failure_label(failure),
        }),
    );
}

async fn restart_with_infra_backoff(
    app_broadcast: &tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: &AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    reason: &str,
    initial_failure: Option<InfraFailureClass>,
    initial_retry_after: Option<Duration>,
    ctx: &TransientRetryContext,
) -> Result<tokio::sync::broadcast::Sender<serde_json::Value>, String> {
    let mut retry_reason = reason.to_string();
    let mut pending_pause = initial_failure.map(|failure| (failure, retry_reason.clone()));
    let mut pending_hint = initial_retry_after;
    loop {
        if let Some((failure, pause_reason)) = pending_pause.take() {
            pause_for_project_cooldown(
                app_broadcast,
                automaton_registry,
                project_id,
                agent_instance_id,
                Some(task_id),
                &pause_reason,
                failure,
                pending_hint.take(),
            )
            .await;
            retry_reason = pause_reason;
        }
        match try_restart_automaton(
            app_broadcast,
            project_id,
            agent_instance_id,
            task_id,
            &retry_reason,
            ctx,
        )
        .await
        {
            Ok(tx) => return Ok(tx),
            Err(error) => {
                if let Some(failure) = classify_infra_failure(&error) {
                    retry_reason = error.clone();
                    // Restart errors don't carry a structured event, so
                    // scan the error text for a hint instead. Falls
                    // back to the class's default cooldown on no match.
                    pending_hint = parse_retry_after_seconds(&error).map(Duration::from_secs);
                    pending_pause = Some((failure, error));
                    continue;
                }
                return Err(error);
            }
        }
    }
}

async fn resolve_active_task_id(
    task_service: &TaskService,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> Option<String> {
    let tasks = task_service.list_tasks(project_id).await.ok()?;

    // Best signal: an in-progress task already assigned to this agent instance.
    if let Some(task) = tasks.iter().find(|t| {
        t.status == TaskStatus::InProgress
            && t.assigned_agent_instance_id == Some(*agent_instance_id)
    }) {
        return Some(task.task_id.to_string());
    }

    // The harness may assign tasks using its own agent ID which differs from
    // the agent_instance_id that start_loop generated.  Fall back to any
    // in-progress task so we can still stamp events with a task_id.
    if let Some(task) = tasks.iter().find(|t| t.status == TaskStatus::InProgress) {
        return Some(task.task_id.to_string());
    }

    // Fallback: global scheduler's next ready task.
    task_service
        .select_next_task(project_id)
        .await
        .ok()
        .flatten()
        .map(|t| t.task_id.to_string())
}

/// Resolve the `spec_id` for a task so `LoopLogWriter::on_task_started`
/// can stamp it on the run bundle metadata.
///
/// Returns `None` — never errors — if the storage client is not
/// configured, the JWT is missing, or the task lookup fails. The run
/// bundle writer tolerates missing spec ids, so a best-effort lookup
/// is the right trade-off here: logging a run is more important than
/// knowing which spec it came from.
async fn resolve_task_spec_id(
    storage_client: Option<&std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<&str>,
    task_id: &TaskId,
) -> Option<SpecId> {
    let storage = storage_client?;
    let jwt = jwt?;
    let storage_task = storage.get_task(&task_id.to_string(), jwt).await.ok()?;
    storage_task.spec_id?.parse::<SpecId>().ok()
}

/// Emit a synthetic `task_failed` domain event and mirror the failure into
/// storage so it survives a page reload.
///
/// Used when the automaton stream ends without a proper terminal event
/// (e.g. broadcast closed mid-run, harness-level `error` event with no
/// following `task_failed`, or HTTP connect failure). The UI hook
/// `useTaskStatus` reads `content.reason`, which is guaranteed to be
/// populated on this path.
async fn synthesize_task_failed(
    app_broadcast: &tokio::sync::broadcast::Sender<serde_json::Value>,
    storage_client: Option<&std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<&str>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    reason: &str,
) {
    // Parse whatever structured fragments the reason string carries so
    // synthetic events (done-without-terminal, error-without-task_failed,
    // restart-failed) get the same `req=… model=… sse_error_type=…`
    // siblings as a harness-emitted event would. `extract_task_failure_context`
    // tolerates a `None`/empty event object.
    let context =
        extract_task_failure_context(&serde_json::Value::Null, Some(reason));
    let mut payload = serde_json::json!({
        "task_id": task_id.to_string(),
        "reason": reason,
    });
    if context.has_any() {
        if let Some(obj) = payload.as_object_mut() {
            context.merge_into(obj);
        }
    }
    persist_task_failure_reason(storage_client, jwt, task_id, reason).await;
    emit_domain_event(
        app_broadcast,
        "task_failed",
        project_id,
        agent_instance_id,
        payload,
    );
}

/// Outcome of resolving an `AutomatonStartError::Conflict` on restart.
///
/// Mirrors the stale/adopt logic already in `start_loop` so the infra-retry
/// path can recover from the same "dev loop is already running" race when
/// the previous forwarder left a stale automaton registered on the harness.
enum ConflictResolution {
    /// We successfully started a new automaton after stopping the stale one.
    Fresh {
        automaton_id: String,
        event_stream_url: String,
    },
    /// The existing automaton is still active; adopt it and reconnect to
    /// its event stream using the default URL (the harness knows its own
    /// stream path when called with `None`).
    Adopt { automaton_id: String },
}

/// Resolve an `AutomatonStartError::Conflict` by probing the existing
/// automaton's status: if it's stale, stop it and retry `start`; otherwise
/// adopt the existing automaton. Returns an error only when the conflict
/// cannot be resolved (e.g. harness reported `Conflict(None)` so we have
/// no ID to probe or stop).
async fn resolve_start_conflict(
    automaton_client: &aura_os_link::AutomatonClient,
    existing_id: Option<String>,
    start_params: &AutomatonStartParams,
) -> Result<ConflictResolution, String> {
    let aid = existing_id.ok_or_else(|| {
        "a dev loop is already running but its ID could not be determined".to_string()
    })?;

    let stale = match automaton_client.status(&aid).await {
        Ok(status) => !automaton_is_active(&status),
        Err(e) => {
            warn!(%aid, error = %e, "Failed to inspect conflicting automaton; treating as stale");
            true
        }
    };

    if !stale {
        info!(%aid, "Adopting live automaton on restart conflict");
        return Ok(ConflictResolution::Adopt { automaton_id: aid });
    }

    info!(%aid, "Stopping stale conflicting automaton before restart retry");
    if let Err(e) = automaton_client.stop(&aid).await {
        warn!(%aid, error = %e, "Failed to stop stale conflicting automaton; will retry start anyway");
    }
    match automaton_client.start(start_params.clone()).await {
        Ok(r) => Ok(ConflictResolution::Fresh {
            automaton_id: r.automaton_id,
            event_stream_url: r.event_stream_url,
        }),
        Err(AutomatonStartError::Conflict(Some(retry_id))) => {
            info!(%retry_id, "Retry still conflicts; adopting existing automaton");
            Ok(ConflictResolution::Adopt {
                automaton_id: retry_id,
            })
        }
        Err(AutomatonStartError::Conflict(None)) => Err(
            "a dev loop is already running but its ID could not be determined after stop".into(),
        ),
        Err(e) => Err(format!("automaton start failed after stale cleanup: {e}")),
    }
}

/// Restart the automaton once after an infra-transient failure and
/// re-subscribe to its event stream.
///
/// Emits a `task_retrying` domain event before the restart so the UI can
/// surface the retry. Handles `AutomatonStartError::Conflict` the same way
/// the primary `start_loop` path does (stop-stale / adopt-live) so a
/// leftover harness-side automaton from the failed run doesn't turn every
/// rate-limit recovery into a permanent failure. Returns the new broadcast
/// sender on success, or an error message the caller can surface as part
/// of the failure reason.
async fn try_restart_automaton(
    app_broadcast: &tokio::sync::broadcast::Sender<serde_json::Value>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    reason: &str,
    ctx: &TransientRetryContext,
) -> Result<tokio::sync::broadcast::Sender<serde_json::Value>, String> {
    // Axis 5: record this restart as a retry attempt so UI and run bundles
    // can see the ladder of transient failures instead of a single opaque
    // `task_retrying` event. `bump_retry_attempt` returns 1 on the *first*
    // restart; the 0th attempt is the original run that just failed, so
    // the value surfaced on the event is `attempt + 1` to read naturally
    // as "now starting attempt N".
    let restart_count = bump_retry_attempt(task_id);
    let attempt_number = restart_count.saturating_add(1);
    let preamble = build_retry_preamble(attempt_number, reason);
    emit_domain_event(
        app_broadcast,
        "task_retrying",
        project_id,
        agent_instance_id,
        serde_json::json!({
            "task_id": task_id.to_string(),
            "reason": reason,
            "attempt": attempt_number,
            "preamble": preamble,
        }),
    );
    let (automaton_id, event_stream_url) =
        match ctx.automaton_client.start(ctx.start_params.clone()).await {
            Ok(r) => (r.automaton_id, Some(r.event_stream_url)),
            Err(AutomatonStartError::Conflict(existing_id)) => {
                match resolve_start_conflict(
                    ctx.automaton_client.as_ref(),
                    existing_id,
                    &ctx.start_params,
                )
                .await?
                {
                    ConflictResolution::Fresh {
                        automaton_id,
                        event_stream_url,
                    } => (automaton_id, Some(event_stream_url)),
                    ConflictResolution::Adopt { automaton_id } => (automaton_id, None),
                }
            }
            Err(e) => return Err(format!("automaton start failed: {e}")),
        };
    let tx = connect_with_retries(
        ctx.automaton_client.as_ref(),
        &automaton_id,
        event_stream_url.as_deref(),
        2,
    )
    .await
    .map_err(|e| format!("event stream reconnect failed: {e}"))?;
    Ok(tx)
}

/// Outcome of [`attempt_infra_retry`]. Callers branch on this instead of
/// each duplicating the `classify_infra_failure` → `take_retry_context`
/// → `reset_task_for_infra_retry` → `restart_with_infra_backoff` ladder.
enum InfraRetryOutcome {
    /// The reason classified as transient, a retry context was available,
    /// and the automaton restarted successfully. The caller should swap
    /// its broadcast receiver for `new_rx` and `continue` its event loop.
    Retried {
        new_rx: tokio::sync::broadcast::Receiver<serde_json::Value>,
    },
    /// Either the reason didn't classify as an infra transient, or the
    /// retry budget was already exhausted. Caller should fall through to
    /// its own terminal-failure handling without bridging through
    /// `ready`.
    NotClassified,
    /// The reason classified and a budget slot was consumed, but the
    /// reset (`reset_task_for_infra_retry`) or the restart
    /// (`restart_with_infra_backoff`) itself failed. `task_reset_to_ready`
    /// is `true` when the task was successfully flipped to `ready` before
    /// the failure, so the caller must bridge `ready → in_progress →
    /// failed` before persisting the terminal transition (aura-storage
    /// rejects a direct `ready → failed`).
    RetryFailed { task_reset_to_ready: bool },
}

/// Shared helper implementing the infra-transient retry ladder: classify
/// the reason, consume one restart budget slot, log a `debug.retry`
/// event, reset the task to `ready`, and trigger
/// `restart_with_infra_backoff`.
///
/// Used by both the `task_failed` arm and the `task_completed`
/// completion-validation-failure arm of the forwarder. The latter
/// previously bypassed this ladder entirely, which reintroduced the
/// `1.1 Create zero-core crate with newtype IDs` failure on every
/// provider 5xx even though the classifier correctly recognised the
/// error as transient (see the regression pinned by
/// `classify_stream_terminated_internal_as_provider_internal_error` in
/// `tests/autonomous_recovery_replay.rs`).
#[allow(clippy::too_many_arguments)]
async fn attempt_infra_retry(
    app_broadcast: &tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: &AutomatonRegistry,
    task_service: &TaskService,
    loop_log: &crate::loop_log::LoopLogWriter,
    retry: &mut Option<TransientRetryContext>,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    reason: &str,
    retry_after_hint: Option<Duration>,
) -> InfraRetryOutcome {
    let Some(infra_failure) = classify_infra_failure(reason) else {
        return InfraRetryOutcome::NotClassified;
    };
    let Some(ctx) = take_retry_context(retry) else {
        return InfraRetryOutcome::NotClassified;
    };
    let hint_ms = retry_after_hint.map(|d| d.as_millis() as u64);
    loop_log
        .on_json_event(
            project_id,
            agent_instance_id,
            &serde_json::json!({
                "type": "debug.retry",
                "task_id": task_id,
                "reason": reason,
                "class": infra_failure_label(infra_failure),
                "retry_after_ms": hint_ms,
            }),
        )
        .await;
    match reset_task_for_infra_retry(task_service, project_id, task_id).await {
        Ok(()) => match restart_with_infra_backoff(
            app_broadcast,
            automaton_registry,
            project_id,
            agent_instance_id,
            task_id,
            reason,
            Some(infra_failure),
            retry_after_hint,
            &ctx,
        )
        .await
        {
            Ok(new_tx) => InfraRetryOutcome::Retried {
                new_rx: new_tx.subscribe(),
            },
            Err(restart_err) => {
                warn!(
                    task_id = %task_id,
                    %restart_err,
                    "Infra retry could not restart automaton"
                );
                InfraRetryOutcome::RetryFailed {
                    task_reset_to_ready: true,
                }
            }
        },
        Err(reset_err) => {
            warn!(
                task_id = %task_id,
                %reset_err,
                "Infra retry classification matched, but task reset failed"
            );
            InfraRetryOutcome::RetryFailed {
                task_reset_to_ready: false,
            }
        }
    }
}

/// Forward automaton events from the harness WebSocket to the app's global
/// event broadcast, mapping `AutomatonEvent` types to the app's domain events.
/// Also accumulates task output in the in-memory cache and persists to storage
/// on task completion.
fn forward_automaton_events(params: ForwardParams) -> tokio::task::AbortHandle {
    let ForwardParams {
        automaton_events_tx,
        app_broadcast,
        automaton_registry,
        project_id,
        agent_instance_id,
        task_id,
        task_service,
        task_output_cache,
        storage_client,
        jwt,
        session_id,
        session_service,
        agent_instance_service,
        usage_reporting,
        router_url,
        http_client,
        retry,
        alive,
        loop_log,
    } = params;

    let rx = automaton_events_tx.subscribe();
    let pid = project_id.to_string();
    let aiid = agent_instance_id.to_string();
    let current_session_id = session_id;
    let current_session_id_string = current_session_id.map(|id| id.to_string());
    alive.store(true, std::sync::atomic::Ordering::SeqCst);

    let handle = tokio::spawn(async move {
        // Clears the shared `alive` flag on every exit path (normal
        // `break`, stream close, abort, or panic-induced drop) so
        // `start_loop` never sees a stale "alive" marker for a dead
        // forwarder.
        let _alive_guard = ForwarderAliveGuard(alive);
        // Re-bind as mutable inside the async block so we can both
        // `rx.recv().await` (needs &mut self) and swap in a fresh
        // subscription on retry.
        let mut rx = rx;
        let mut first_work_seen = false;
        let mut current_task_id: Option<String> = task_id;
        // Last `current_task_id` mirrored into the registry. When the
        // forwarder-local value changes we push the update through
        // `sync_registry_task_id` so `GET /loop/status` stays in sync.
        let mut last_synced_task_id: Option<String> = current_task_id.clone();
        let mut session_status = "completed";
        // Tracks whether we've seen a terminal automaton event
        // (`task_completed`, `task_failed`, or `done`). If the broadcast
        // closes without one, we synthesise a `task_failed` with a real
        // reason so the UI and DB never get left in a limbo state.
        let mut terminal_seen = false;
        // Retry context is consumed according to its local restart budget.
        let mut retry = retry;
        // Last transient-looking failure observed during this turn (an
        // `error` event or `task_failed` whose reason classified as
        // `InfraFailureClass::*`). Captured so that if the harness later
        // emits a spurious `task_completed` for the same turn — which
        // happens after some provider 5xx / mid-stream aborts — the
        // completion-validation gate can recover the *real* infra
        // diagnosis instead of falling back on its own "no output, no
        // file changes" synthesis and terminating a retryable failure.
        // Cleared on `task_started` so each turn starts fresh.
        let mut last_transient_reason: Option<String> = None;
        // Phase 6 — Closed-loop heuristics. Lazily bound on the first
        // forwarded event so we can stamp the actual `run_id` into
        // every `heuristic_finding` payload instead of a placeholder.
        // Bundle dir is resolved once via `latest_run_dir_for` and
        // cached so each trigger doesn't re-scan the filesystem.
        let mut live_analyzer: Option<super::live_heuristics::LiveAnalyzer> = None;
        let mut live_bundle_dir: Option<std::path::PathBuf> = None;
        let clear_active_automaton =
            |registry: AutomatonRegistry,
             project_id: ProjectId,
             agent_instance_id: AgentInstanceId| async move {
                let mut reg = registry.lock().await;
                if reg
                    .get(&agent_instance_id)
                    .is_some_and(|entry| entry.project_id == project_id)
                {
                    reg.remove(&agent_instance_id);
                }
            };
        // Mirror the forwarder-local `current_task_id` into the registry
        // entry so `GET /loop/status` can report "which task is this
        // automaton working on right now". Without this the client has
        // no HTTP path to rediscover the live task after a page refresh
        // (`task_started` WS events are not replayed). Scoped to this
        // automaton's agent so we never overwrite a sibling entry.
        let sync_registry_task_id = |registry: AutomatonRegistry,
                                     agent_instance_id: AgentInstanceId,
                                     task_id: Option<String>| async move {
            let mut reg = registry.lock().await;
            if let Some(entry) = reg.get_mut(&agent_instance_id) {
                entry.current_task_id = task_id;
            }
        };

        loop {
            match rx.recv().await {
                Ok(mut event) => {
                    let event_type = event
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let is_work = is_work_event_type(event_type);

                    // Keep trying to discover the active task_id until it is known.
                    // Some harness streams emit deltas before task_started, and if
                    // we stop attempting resolution after first work we can forward
                    // all first-task output without task_id.
                    if current_task_id.is_none() {
                        if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                            current_task_id = Some(tid.to_owned());
                        } else if is_work {
                            current_task_id = resolve_active_task_id(
                                task_service.as_ref(),
                                &project_id,
                                &agent_instance_id,
                            )
                            .await;
                        }
                    }
                    // Mirror task_id discovery into the registry so
                    // `GET /loop/status` immediately surfaces the
                    // active task, even when `task_started` was
                    // emitted before our WS subscription.
                    if current_task_id != last_synced_task_id
                        && !matches!(event_type, "task_completed" | "task_failed")
                    {
                        sync_registry_task_id(
                            automaton_registry.clone(),
                            agent_instance_id,
                            current_task_id.clone(),
                        )
                        .await;
                        last_synced_task_id = current_task_id.clone();
                    }
                    // If we see any work event before a task_started, emit a
                    // synthetic task_started so the UI exits "Preparing" state.
                    // This handles the race where the real task_started was
                    // emitted before our WebSocket connected.
                    // Track the active task_id from lifecycle events so
                    // streaming events (text_delta, etc.) that don't carry
                    // task_id in their payload still get stamped correctly.
                    if event_type == "task_started" {
                        // New turn — any transient-diagnosis breadcrumb
                        // from a prior attempt must be dropped so it
                        // cannot leak into a later turn's completion-gate
                        // decision on a different task.
                        last_transient_reason = None;
                        if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                            current_task_id = Some(tid.to_owned());
                            if let (Some(session_id), Ok(task_id)) =
                                (current_session_id, tid.parse::<TaskId>())
                            {
                                let _ = agent_instance_service
                                    .start_working(
                                        &project_id,
                                        &agent_instance_id,
                                        &task_id,
                                        &session_id,
                                    )
                                    .await;
                                if let (Some(sc), Some(jwt)) =
                                    (storage_client.as_ref(), jwt.as_deref())
                                {
                                    // Persisting session_id is on the critical path for
                                    // reconstructing task output after a reload - if this
                                    // fails the frontend cannot look up historical events
                                    // for the task. A single failed attempt previously
                                    // produced `Task has no session_id in storage; cannot
                                    // fetch persisted output` rows forever. Retry with a
                                    // short backoff so transient storage hiccups (e.g.
                                    // contention on the task document, a flap in the
                                    // storage service) don't permanently orphan a run.
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        session_id: Some(session_id.to_string()),
                                        assigned_project_agent_id: Some(aiid.clone()),
                                        ..Default::default()
                                    };
                                    let mut attempt: u32 = 0;
                                    let max_attempts: u32 = 5;
                                    loop {
                                        match sc.update_task(tid, jwt, &req).await {
                                            Ok(_) => break,
                                            Err(e) => {
                                                attempt += 1;
                                                if attempt >= max_attempts {
                                                    warn!(task_id = %tid, error = %e, attempts = attempt, "Failed to persist session_id on task start after retries");
                                                    break;
                                                }
                                                let backoff_ms: u64 =
                                                    50u64.saturating_mul(1u64 << (attempt - 1));
                                                tokio::time::sleep(
                                                    std::time::Duration::from_millis(
                                                        backoff_ms.min(1000),
                                                    ),
                                                )
                                                .await;
                                            }
                                        }
                                    }
                                }
                            }
                            let mut cache = task_output_cache.lock().await;
                            cache.insert(
                                tid.to_owned(),
                                CachedTaskOutput {
                                    project_id: Some(pid.clone()),
                                    agent_instance_id: Some(aiid.clone()),
                                    session_id: current_session_id_string.clone(),
                                    ..Default::default()
                                },
                            );
                        }
                    }

                    if !first_work_seen {
                        let event_task_id = event
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let mut effective_task_id = current_task_id.clone().or(event_task_id);
                        if effective_task_id.is_none() {
                            effective_task_id = resolve_active_task_id(
                                task_service.as_ref(),
                                &project_id,
                                &agent_instance_id,
                            )
                            .await;
                            if let Some(ref tid) = effective_task_id {
                                current_task_id = Some(tid.clone());
                            }
                        }
                        if is_work {
                            if event_type == "task_started" || effective_task_id.is_some() {
                                first_work_seen = true;
                            }
                            if event_type != "task_started" && effective_task_id.is_some() {
                                let extra = match &effective_task_id {
                                    Some(tid) => serde_json::json!({"task_id": tid}),
                                    None => serde_json::json!({}),
                                };
                                emit_domain_event(
                                    &app_broadcast,
                                    "task_started",
                                    project_id,
                                    agent_instance_id,
                                    extra,
                                );
                            }
                        }
                    }

                    // Accumulate task output in the in-memory cache.
                    {
                        let event_task_id = event
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let eff_tid = current_task_id.clone().or(event_task_id);
                        if let Some(ref tid) = eff_tid {
                            let mut cache = task_output_cache.lock().await;
                            let entry = cache.entry(tid.clone()).or_default();
                            if entry.project_id.is_none() {
                                entry.project_id = Some(pid.clone());
                            }
                            if entry.agent_instance_id.is_none() {
                                entry.agent_instance_id = Some(aiid.clone());
                            }
                            if entry.session_id.is_none() {
                                entry.session_id = current_session_id_string.clone();
                            }
                            match event_type {
                                "text_delta" => {
                                    if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
                                        entry.live_output.push_str(text);
                                    }
                                }
                                "assistant_message_end" => {
                                    if !entry.live_output.is_empty()
                                        && !entry.live_output.ends_with("\n\n")
                                    {
                                        entry.live_output.push_str("\n\n");
                                    }
                                    if let Some(turn_usage) = extract_turn_usage(&event) {
                                        entry.saw_rich_usage = true;
                                        entry.input_tokens = turn_usage.input_tokens;
                                        entry.output_tokens = turn_usage.output_tokens;
                                        entry.total_input_tokens =
                                            turn_usage.cumulative_input_tokens.unwrap_or(
                                                entry.total_input_tokens + turn_usage.input_tokens,
                                            );
                                        entry.total_output_tokens =
                                            turn_usage.cumulative_output_tokens.unwrap_or(
                                                entry.total_output_tokens
                                                    + turn_usage.output_tokens,
                                            );
                                        entry.total_cache_creation_input_tokens = turn_usage
                                            .cumulative_cache_creation_input_tokens
                                            .unwrap_or(
                                                entry.total_cache_creation_input_tokens
                                                    + turn_usage.cache_creation_input_tokens,
                                            );
                                        entry.total_cache_read_input_tokens = turn_usage
                                            .cumulative_cache_read_input_tokens
                                            .unwrap_or(
                                                entry.total_cache_read_input_tokens
                                                    + turn_usage.cache_read_input_tokens,
                                            );
                                        if let Some(estimated_context_tokens) =
                                            turn_usage.estimated_context_tokens
                                        {
                                            entry.estimated_context_tokens =
                                                estimated_context_tokens;
                                        }
                                        entry.context_usage_estimate =
                                            turn_usage.context_utilization;
                                        if let Some(model) = turn_usage.model {
                                            entry.model = Some(model);
                                        }
                                        if let Some(provider) = turn_usage.provider {
                                            entry.provider = Some(provider);
                                        }
                                    }
                                    let files_changed = extract_files_changed(&event);
                                    if !files_changed.is_empty() {
                                        entry.files_changed = files_changed;
                                    }
                                }
                                "build_verification_skipped"
                                | "build_verification_started"
                                | "build_verification_passed"
                                | "build_verification_failed"
                                | "build_fix_attempt" => {
                                    entry.build_steps.push(event.clone());
                                }
                                "test_verification_started"
                                | "test_verification_passed"
                                | "test_verification_failed"
                                | "test_fix_attempt" => {
                                    entry.test_steps.push(event.clone());
                                }
                                "git_committed" | "git_commit_failed"
                                | "git_commit_rolled_back" | "git_pushed"
                                | "git_push_failed" => {
                                    entry.git_steps.push(event.clone());
                                }
                                "format_verification_skipped"
                                | "format_verification_started"
                                | "format_verification_passed"
                                | "format_verification_failed"
                                | "format_fix_attempt" => {
                                    entry.format_steps.push(event.clone());
                                }
                                "lint_verification_skipped"
                                | "lint_verification_started"
                                | "lint_verification_passed"
                                | "lint_verification_failed"
                                | "lint_fix_attempt" => {
                                    entry.lint_steps.push(event.clone());
                                }
                                "token_usage" => {
                                    if !entry.saw_rich_usage {
                                        if let Some((input_tokens, output_tokens)) =
                                            extract_token_usage(&event)
                                        {
                                            entry.input_tokens = input_tokens;
                                            entry.output_tokens = output_tokens;
                                            entry.total_input_tokens += input_tokens;
                                            entry.total_output_tokens += output_tokens;
                                        }
                                    }
                                }
                                _ => {
                                    for kind in classify_run_command_steps(event_type, &event) {
                                        match kind {
                                            VerificationStepKind::Build => {
                                                entry.build_steps.push(event.clone())
                                            }
                                            VerificationStepKind::Test => {
                                                entry.test_steps.push(event.clone())
                                            }
                                            VerificationStepKind::Format => {
                                                entry.format_steps.push(event.clone())
                                            }
                                            VerificationStepKind::Lint => {
                                                entry.lint_steps.push(event.clone())
                                            }
                                        }
                                    }
                                    if is_empty_path_write_event(event_type, &event) {
                                        entry.empty_path_writes =
                                            entry.empty_path_writes.saturating_add(1);
                                    }
                                }
                            }
                        }
                    }

                    if event_type == "assistant_message_end" {
                        if let (Some(session_id), Some(turn_usage)) =
                            (current_session_id, extract_turn_usage(&event))
                        {
                            if let Err(error) = session_service
                                .update_context_usage(UpdateContextUsageParams {
                                    project_id,
                                    agent_instance_id,
                                    session_id,
                                    input_tokens: turn_usage.input_tokens,
                                    output_tokens: turn_usage.output_tokens,
                                    total_input_tokens: turn_usage.cumulative_input_tokens,
                                    total_output_tokens: turn_usage.cumulative_output_tokens,
                                    context_usage_estimate: turn_usage.context_utilization,
                                })
                                .await
                            {
                                warn!(%session_id, %error, "Failed to persist automaton session usage");
                            }
                        }
                        if let (Some(usage_reporting), Some(turn_usage)) =
                            (usage_reporting.as_ref(), extract_turn_usage(&event))
                        {
                            report_automaton_usage(usage_reporting, project_id, &turn_usage).await;
                        }
                    } else if event_type == "token_usage" {
                        if let (Some(session_id), Some(turn_usage)) =
                            (current_session_id, extract_turn_usage(&event))
                        {
                            if let Err(error) = session_service
                                .update_context_usage(UpdateContextUsageParams {
                                    project_id,
                                    agent_instance_id,
                                    session_id,
                                    input_tokens: turn_usage.input_tokens,
                                    output_tokens: turn_usage.output_tokens,
                                    total_input_tokens: None,
                                    total_output_tokens: None,
                                    context_usage_estimate: None,
                                })
                                .await
                            {
                                warn!(%session_id, %error, "Failed to persist fallback automaton token usage");
                            }
                        }
                        if let (Some(usage_reporting), Some(turn_usage)) =
                            (usage_reporting.as_ref(), extract_turn_usage(&event))
                        {
                            report_automaton_usage(usage_reporting, project_id, &turn_usage).await;
                        }
                    }

                    let mapped_type = match event_type {
                        "task_completed" => {
                            terminal_seen = true;
                            // Axis 5: a successful completion ends the retry
                            // ladder for this task, so the in-memory counter
                            // must be dropped. A future manual re-run of the
                            // same task id (operator pressing "retry") will
                            // then start the ladder over from attempt 1
                            // instead of inheriting this run's count.
                            if let Some(ref tid) = current_task_id {
                                clear_retry_attempt(tid);
                            }
                            // Clear the registry's active task pointer so
                            // `GET /loop/status` stops reporting the task
                            // as "live" immediately after completion.
                            sync_registry_task_id(
                                automaton_registry.clone(),
                                agent_instance_id,
                                None,
                            )
                            .await;
                            last_synced_task_id = None;
                            // Persist accumulated output to storage.
                            let event_tid = event
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(str::to_owned);
                            let tid = current_task_id.clone().or(event_tid);
                            let mut completion_mapped = Some("task_completed");
                            if let Some(ref tid) = tid {
                                let session_id = event
                                    .get("session_id")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_owned);
                                let cached = {
                                    let mut cache = task_output_cache.lock().await;
                                    if let Some(entry) = cache.get_mut(tid) {
                                        if session_id.is_some() {
                                            entry.session_id = session_id;
                                        }
                                        entry.clone()
                                    } else {
                                        CachedTaskOutput::default()
                                    }
                                };
                                if let (Some(storage_client), Some(jwt), Some(session_id)) = (
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    cached.session_id.clone(),
                                ) {
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        title: None,
                                        description: None,
                                        order_index: None,
                                        dependency_ids: None,
                                        execution_notes: None,
                                        files_changed: (!cached.files_changed.is_empty())
                                            .then_some(cached.files_changed.clone()),
                                        model: cached.model.clone(),
                                        total_input_tokens: Some(cached.total_input_tokens),
                                        total_output_tokens: Some(cached.total_output_tokens),
                                        session_id: Some(session_id),
                                        assigned_project_agent_id: Some(aiid.clone()),
                                    };
                                    if let Err(error) =
                                        storage_client.update_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to persist task usage metadata");
                                    }
                                }
                                persistence::persist_task_output(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    tid,
                                    &cached,
                                )
                                .await;
                                let gate_reason = completion_validation_failure_reason(&cached);
                                let mut gate_report = CompletionGateReport::from_cached(&cached);
                                gate_report.failure_reason = gate_reason.map(|r| r.to_string());
                                if let Ok(payload) = serde_json::to_value(&gate_report) {
                                    let mut payload = payload;
                                    if let Some(obj) = payload.as_object_mut() {
                                        obj.insert(
                                            "task_id".into(),
                                            serde_json::Value::String(tid.clone()),
                                        );
                                        obj.insert(
                                            "passed".into(),
                                            serde_json::Value::Bool(gate_reason.is_none()),
                                        );
                                    }
                                    emit_domain_event(
                                        &app_broadcast,
                                        "task_completion_gate",
                                        project_id,
                                        agent_instance_id,
                                        payload,
                                    );
                                }
                                if let Some(reason) = gate_reason {
                                    // Phase 7b — route completion-gate
                                    // failures through the same infra
                                    // retry ladder as a real `task_failed`
                                    // event. The gate's own reason ("no
                                    // output, no file changes, no
                                    // verification evidence") never
                                    // classifies as an infra transient on
                                    // its own, so we first consult any
                                    // `last_transient_reason` captured
                                    // from a preceding `error` event —
                                    // that's the real diagnosis (e.g.
                                    // "LLM error: stream terminated with
                                    // error: Internal server error") and
                                    // is what `classify_infra_failure`
                                    // will recognise as
                                    // `ProviderInternalError`. Falls back
                                    // to the gate reason so a non-infra
                                    // gate failure still follows the
                                    // classifier's normal `NotClassified`
                                    // path into terminal handling.
                                    let retry_reason = last_transient_reason
                                        .clone()
                                        .unwrap_or_else(|| reason.to_string());
                                    let mut gate_retry_reset = false;
                                    let outcome = attempt_infra_retry(
                                        &app_broadcast,
                                        &automaton_registry,
                                        task_service.as_ref(),
                                        loop_log.as_ref(),
                                        &mut retry,
                                        project_id,
                                        agent_instance_id,
                                        tid,
                                        &retry_reason,
                                        None,
                                    )
                                    .await;
                                    match outcome {
                                        InfraRetryOutcome::Retried { new_rx } => {
                                            // Retry ladder owns the
                                            // terminal state now: swap
                                            // the receiver, clear
                                            // per-turn state, and
                                            // restart the outer event
                                            // loop without emitting a
                                            // rollback, persisting
                                            // failure metadata, or
                                            // transitioning the task.
                                            rx = new_rx;
                                            terminal_seen = false;
                                            session_status = "completed";
                                            current_task_id = None;
                                            last_synced_task_id = None;
                                            last_transient_reason = None;
                                            sync_registry_task_id(
                                                automaton_registry.clone(),
                                                agent_instance_id,
                                                None,
                                            )
                                            .await;
                                            continue;
                                        }
                                        InfraRetryOutcome::NotClassified => {
                                            // Non-infra gate failure —
                                            // fall through to the
                                            // existing terminal handling
                                            // below.
                                        }
                                        InfraRetryOutcome::RetryFailed {
                                            task_reset_to_ready,
                                        } => {
                                            gate_retry_reset = task_reset_to_ready;
                                        }
                                    }
                                    session_status = "failed";
                                    // Surface the rollback on the task
                                    // card so users never see a
                                    // "Committed <sha>" row that
                                    // refers to a SHA unreachable
                                    // from `git log`. We emit this
                                    // before transitioning task
                                    // state so the UI has a chance
                                    // to observe the rollback before
                                    // the `task_failed` terminal.
                                    if let Some(sha) = latest_git_commit_sha(&cached.git_steps) {
                                        emit_domain_event(
                                            &app_broadcast,
                                            "git_commit_rolled_back",
                                            project_id,
                                            agent_instance_id,
                                            serde_json::json!({
                                                "task_id": tid,
                                                "commit_sha": sha,
                                                "reason": reason,
                                            }),
                                        );
                                    }
                                    if let (Some(storage_client), Some(jwt)) =
                                        (storage_client.as_ref(), jwt.as_deref())
                                    {
                                        let update = aura_os_storage::UpdateTaskRequest {
                                            execution_notes: Some(reason.to_string()),
                                            files_changed: (!cached.files_changed.is_empty())
                                                .then_some(cached.files_changed.clone()),
                                            model: cached.model.clone(),
                                            total_input_tokens: Some(cached.total_input_tokens),
                                            total_output_tokens: Some(cached.total_output_tokens),
                                            session_id: cached.session_id.clone(),
                                            assigned_project_agent_id: Some(aiid.clone()),
                                            ..Default::default()
                                        };
                                        if let Err(error) =
                                            storage_client.update_task(tid, jwt, &update).await
                                        {
                                            warn!(
                                                task_id = %tid,
                                                %error,
                                                "Failed to persist completion-validation failure metadata"
                                            );
                                        }
                                        // When the retry ladder moved the
                                        // task to `ready` before the
                                        // restart failed, aura-storage
                                        // rejects a direct `ready →
                                        // failed` transition. Bridge
                                        // through `in_progress` first so
                                        // the row actually lands in
                                        // `failed` instead of getting
                                        // stuck in `ready` with no
                                        // terminal badge.
                                        if gate_retry_reset {
                                            let bridge = aura_os_storage::TransitionTaskRequest {
                                                status: "in_progress".to_string(),
                                            };
                                            if let Err(error) = storage_client
                                                .transition_task(tid, jwt, &bridge)
                                                .await
                                            {
                                                warn!(task_id = %tid, %error, "Failed to bridge ready->in_progress before completion-gate terminal failure");
                                            }
                                        }
                                        let req = aura_os_storage::TransitionTaskRequest {
                                            status: "failed".to_string(),
                                        };
                                        if let Err(error) =
                                            storage_client.transition_task(tid, jwt, &req).await
                                        {
                                            warn!(task_id = %tid, %error, "Failed to transition invalid completion to Failed (may already be terminal)");
                                        }
                                    }
                                    if let Some(obj) = event.as_object_mut() {
                                        obj.insert(
                                            "type".into(),
                                            serde_json::Value::String("task_failed".into()),
                                        );
                                        obj.insert(
                                            "reason".into(),
                                            serde_json::Value::String(reason.to_string()),
                                        );
                                    }
                                    completion_mapped = Some("task_failed");
                                } else if let (Some(storage_client), Some(jwt)) =
                                    (storage_client.as_ref(), jwt.as_deref())
                                {
                                    let req = aura_os_storage::TransitionTaskRequest {
                                        status: "done".to_string(),
                                    };
                                    if let Err(error) =
                                        storage_client.transition_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to transition task to Done (may already be terminal)");
                                    }
                                }
                            }
                            completion_mapped
                        }
                        "task_failed" => {
                            let event_tid = event
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(str::to_owned);
                            let tid = current_task_id.clone().or(event_tid);
                            // Extract a user-facing reason from the event so
                            // we can both persist it to the task record (for
                            // page reloads) and surface it on the live
                            // `task_failed` broadcast below.
                            let failure_reason = extract_failure_reason(&event);
                            // Pull structured provider context out of the
                            // event (sibling fields once the harness
                            // forwards them from `DebugEvent::LlmCall`)
                            // and, as a fallback, parse the fragments
                            // embedded in the reason string by
                            // `StreamAccumulator::into_response`. Merged
                            // onto the forwarded broadcast payload below
                            // so the UI can render a compact
                            // `req=req_01 · claude-sonnet-4 · api_error`
                            // label next to the reason.
                            let failure_context = extract_task_failure_context(
                                &event,
                                failure_reason.as_deref(),
                            );

                            // Post-commit `git push` timeout: the task's
                            // work is already committed in the workspace
                            // repo, so the task itself is done. The push
                            // is infrastructure and is retried separately
                            // by the harness. Do NOT fail the task, do
                            // NOT reset it to `ready`, and do NOT pause
                            // the loop. Transition to `done` and surface
                            // a `git_push_failed` event to the UI.
                            if let (Some(tid), Some(reason)) =
                                (tid.as_ref(), failure_reason.as_ref())
                            {
                                if classify_infra_failure(reason)
                                    == Some(InfraFailureClass::GitPushTimeout)
                                {
                                    let cached = {
                                        let mut cache = task_output_cache.lock().await;
                                        let entry = cache.entry(tid.clone()).or_default();
                                        if entry.project_id.is_none() {
                                            entry.project_id = Some(pid.clone());
                                        }
                                        if entry.agent_instance_id.is_none() {
                                            entry.agent_instance_id = Some(aiid.clone());
                                        }
                                        if entry.session_id.is_none() {
                                            entry.session_id = current_session_id_string.clone();
                                        }
                                        entry.git_steps.push(serde_json::json!({
                                            "type": "git_push_failed",
                                            "task_id": tid,
                                            "reason": reason,
                                        }));
                                        entry.clone()
                                    };
                                    persistence::persist_task_output(
                                        storage_client.as_ref(),
                                        jwt.as_deref(),
                                        tid,
                                        &cached,
                                    )
                                    .await;
                                    if let (Some(storage_client), Some(jwt)) =
                                        (storage_client.as_ref(), jwt.as_deref())
                                    {
                                        let req = aura_os_storage::TransitionTaskRequest {
                                            status: "done".to_string(),
                                        };
                                        if let Err(error) =
                                            storage_client.transition_task(tid, jwt, &req).await
                                        {
                                            warn!(
                                                task_id = %tid,
                                                %error,
                                                "Failed to transition task to Done after push timeout (may already be terminal)"
                                            );
                                        }
                                    }
                                    emit_domain_event(
                                        &app_broadcast,
                                        "git_push_failed",
                                        project_id,
                                        agent_instance_id,
                                        serde_json::json!({
                                            "task_id": tid,
                                            "reason": reason,
                                            "commit_sha": latest_git_commit_sha(&cached.git_steps),
                                            "recovery_checkpoint": recovery_checkpoint_label(recovery_checkpoint(&cached)),
                                        }),
                                    );
                                    session_status = "completed";
                                    terminal_seen = true;
                                    continue;
                                }
                            }

                            // Tracks whether `reset_task_for_infra_retry`
                            // flipped the task from `in_progress` → `ready`
                            // but the subsequent restart failed. When true,
                            // the terminal-failure transition below must
                            // bridge `ready → in_progress → failed` because
                            // aura-storage rejects a direct `ready → failed`
                            // (producing the `Invalid status transition`
                            // warnings seen in the logs).
                            let mut task_reset_to_ready = false;
                            let classified_infra = failure_reason
                                .as_deref()
                                .and_then(classify_infra_failure);
                            // `debug.retry_miss` fires when the reason
                            // text looks transient (per
                            // `looks_like_unclassified_transient`) but
                            // the classifier didn't pick it up. The
                            // event goes into `retries.jsonl` inside
                            // the run bundle so `aura-run-heuristics`
                            // can surface "we might be missing a
                            // classifier pattern" reports without the
                            // server having to decide policy up-front.
                            // Deliberately does NOT trigger a retry —
                            // this is pure observability.
                            if classified_infra.is_none() {
                                if let (Some(tid), Some(reason)) =
                                    (tid.as_ref(), failure_reason.as_ref())
                                {
                                    if looks_like_unclassified_transient(reason) {
                                        loop_log
                                            .on_json_event(
                                                project_id,
                                                agent_instance_id,
                                                &serde_json::json!({
                                                    "type": "debug.retry_miss",
                                                    "task_id": tid,
                                                    "reason": reason,
                                                    "hint": "looks_like_unclassified_transient",
                                                }),
                                            )
                                            .await;
                                        warn!(
                                            task_id = %tid,
                                            %reason,
                                            "Unclassified but transient-looking task_failed; emitted debug.retry_miss"
                                        );
                                    }
                                }
                            }
                            if let (Some(tid), Some(reason), Some(infra_failure)) = (
                                tid.as_ref(),
                                failure_reason.as_ref(),
                                classified_infra,
                            ) {
                                if let Some(ctx) = take_retry_context(&mut retry) {
                                    // Provider-supplied Retry-After hint,
                                    // when present, takes precedence over
                                    // the class-default cooldown (clamped
                                    // to `PROVIDER_BACKOFF_MAX_SECS`).
                                    // Also record the retry in
                                    // `retries.jsonl` so the run bundle
                                    // surfaces the backoff.
                                    let retry_after_hint = extract_retry_after(&event);
                                    let hint_ms = retry_after_hint.map(|d| d.as_millis() as u64);
                                    loop_log
                                        .on_json_event(
                                            project_id,
                                            agent_instance_id,
                                            &serde_json::json!({
                                                "type": "debug.retry",
                                                "task_id": tid,
                                                "reason": reason,
                                                "class": infra_failure_label(infra_failure),
                                                "retry_after_ms": hint_ms,
                                            }),
                                        )
                                        .await;
                                    match reset_task_for_infra_retry(
                                        task_service.as_ref(),
                                        project_id,
                                        tid,
                                    )
                                    .await
                                    {
                                        Ok(()) => {
                                            task_reset_to_ready = true;
                                            current_task_id = None;
                                            sync_registry_task_id(
                                                automaton_registry.clone(),
                                                agent_instance_id,
                                                None,
                                            )
                                            .await;
                                            last_synced_task_id = None;
                                            match restart_with_infra_backoff(
                                                &app_broadcast,
                                                &automaton_registry,
                                                project_id,
                                                agent_instance_id,
                                                tid,
                                                reason,
                                                Some(infra_failure),
                                                retry_after_hint,
                                                &ctx,
                                            )
                                            .await
                                            {
                                                Ok(new_tx) => {
                                                    rx = new_tx.subscribe();
                                                    terminal_seen = false;
                                                    session_status = "completed";
                                                    // `task_reset_to_ready` intentionally stays
                                                    // true here only so future maintainers see
                                                    // the bridge exists; we `continue` before
                                                    // any failure transition runs.
                                                    continue;
                                                }
                                                Err(restart_err) => {
                                                    warn!(
                                                        task_id = %tid,
                                                        %restart_err,
                                                        "Infra retry after task_failed could not restart automaton"
                                                    );
                                                }
                                            }
                                        }
                                        Err(reset_err) => {
                                            warn!(
                                                task_id = %tid,
                                                %reset_err,
                                                "Infra retry classification matched, but task reset failed"
                                            );
                                        }
                                    }
                                }
                            }
                            session_status = "failed";
                            terminal_seen = true;
                            // Axis 5: this task_failed reached the terminal
                            // branch — either the failure wasn't classified
                            // as transient, or the restart itself errored
                            // (see the `Err(restart_err)` arms above). Either
                            // way the task is no longer being retried by
                            // aura-os, so clear the attempt counter to avoid
                            // inflating the attempt number on a future
                            // manual retry of the same task id.
                            if let Some(ref tid) = tid {
                                clear_retry_attempt(tid);
                            }
                            // Clear the registry's active task pointer so
                            // `GET /loop/status` stops reporting the task
                            // as "live" immediately after failure.
                            sync_registry_task_id(
                                automaton_registry.clone(),
                                agent_instance_id,
                                None,
                            )
                            .await;
                            last_synced_task_id = None;
                            if let Some(ref tid) = tid {
                                let session_id = event
                                    .get("session_id")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_owned);
                                let cached = {
                                    let mut cache = task_output_cache.lock().await;
                                    if let Some(entry) = cache.get_mut(tid) {
                                        if session_id.is_some() {
                                            entry.session_id = session_id;
                                        }
                                        entry.clone()
                                    } else {
                                        CachedTaskOutput::default()
                                    }
                                };
                                // Always persist the failure reason to
                                // `execution_notes` (even without a
                                // `session_id`) so the UI can render a
                                // reason on page reload via the
                                // `TaskMetaSection` → `execution_notes`
                                // fallback. The usage-metadata write
                                // below still requires `session_id`
                                // because the write also pins a session
                                // reference onto the task row.
                                if let (Some(storage_client), Some(jwt), Some(reason)) = (
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    failure_reason.clone(),
                                ) {
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        execution_notes: Some(reason),
                                        ..Default::default()
                                    };
                                    if let Err(error) =
                                        storage_client.update_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to persist failed-task execution_notes");
                                    }
                                }
                                if let (Some(storage_client), Some(jwt), Some(session_id)) = (
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    cached.session_id.clone(),
                                ) {
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        title: None,
                                        description: None,
                                        order_index: None,
                                        dependency_ids: None,
                                        execution_notes: failure_reason.clone(),
                                        files_changed: (!cached.files_changed.is_empty())
                                            .then_some(cached.files_changed.clone()),
                                        model: cached.model.clone(),
                                        total_input_tokens: Some(cached.total_input_tokens),
                                        total_output_tokens: Some(cached.total_output_tokens),
                                        session_id: Some(session_id),
                                        assigned_project_agent_id: Some(aiid.clone()),
                                    };
                                    if let Err(error) =
                                        storage_client.update_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to persist failed-task usage metadata");
                                    }
                                }
                                // Skip the persist call entirely when we
                                // have nothing to persist: the infra-retry
                                // reset path can fail before any harness
                                // events are seen, leaving `cached` empty
                                // and `session_id` unset. Calling
                                // `persist_task_output` on that state just
                                // produces a `session_id missing` warning
                                // for a row that legitimately has no
                                // output to save.
                                if cached.session_id.is_some()
                                    || !cached.live_output.is_empty()
                                    || !cached.build_steps.is_empty()
                                    || !cached.test_steps.is_empty()
                                {
                                    persistence::persist_task_output(
                                        storage_client.as_ref(),
                                        jwt.as_deref(),
                                        tid,
                                        &cached,
                                    )
                                    .await;
                                }
                                if let (Some(storage_client), Some(jwt)) =
                                    (storage_client.as_ref(), jwt.as_deref())
                                {
                                    // When a prior `reset_task_for_infra_retry`
                                    // already flipped this task to `ready`
                                    // and the subsequent restart failed,
                                    // aura-storage will reject a direct
                                    // `ready → failed` transition. Bridge
                                    // through `in_progress` first so the
                                    // task actually lands in `failed` and
                                    // the UI reflects the terminal state
                                    // instead of leaving the row stuck in
                                    // `ready` with no explanatory badge.
                                    if task_reset_to_ready {
                                        let bridge = aura_os_storage::TransitionTaskRequest {
                                            status: "in_progress".to_string(),
                                        };
                                        if let Err(error) =
                                            storage_client.transition_task(tid, jwt, &bridge).await
                                        {
                                            warn!(task_id = %tid, %error, "Failed to bridge ready->in_progress before terminal failure");
                                        }
                                    }
                                    let req = aura_os_storage::TransitionTaskRequest {
                                        status: "failed".to_string(),
                                    };
                                    if let Err(error) =
                                        storage_client.transition_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to transition task to Failed (may already be terminal)");
                                    }
                                }
                            }
                            // Normalize the broadcast payload: ensure
                            // `reason` is always populated so the UI's
                            // `useTaskStatus` hook can display it, and
                            // merge the structured provider context
                            // (`provider_request_id`, `model`,
                            // `sse_error_type`, `message_id`) onto the
                            // event as sibling fields. The UI renders
                            // these as a compact mono label next to the
                            // reason; consumers that don't know about the
                            // new fields keep seeing the same `reason`
                            // shape as before.
                            if let Some(obj) = event.as_object_mut() {
                                if let Some(ref reason) = failure_reason {
                                    if obj
                                        .get("reason")
                                        .and_then(|v| v.as_str())
                                        .map(str::trim)
                                        .map(str::is_empty)
                                        .unwrap_or(true)
                                    {
                                        obj.insert(
                                            "reason".into(),
                                            serde_json::Value::String(reason.clone()),
                                        );
                                    }
                                }
                                if failure_context.has_any() {
                                    failure_context.merge_into(obj);
                                }
                            }
                            // Phase 3 — Autonomous recovery. If the
                            // failure reason looks like a truncation /
                            // no-file-ops event, run the heuristic
                            // pipeline over the just-written run bundle
                            // and, on an actionable `RemediationHint`,
                            // persist follow-up tasks (skeleton + fill,
                            // or a single shaped retry) and broadcast
                            // `task_auto_remediated`. Silently falls
                            // through on any short-circuit — the
                            // `task_failed` broadcast below still goes
                            // out either way so UI telemetry is
                            // unaffected.
                            if let (Some(tid), Some(reason)) =
                                (tid.as_ref(), failure_reason.as_ref())
                            {
                                let _ = try_remediate_task_failure(
                                    task_service.as_ref(),
                                    loop_log.as_ref(),
                                    &app_broadcast,
                                    project_id,
                                    agent_instance_id,
                                    tid,
                                    reason,
                                )
                                .await;
                            }
                            Some("task_failed")
                        }
                        "done" => {
                            // If the stream emits `done` without a
                            // preceding `task_completed`/`task_failed`
                            // (e.g. the harness loop stopped for any
                            // other reason mid-task), surface that to the
                            // UI so the task is not left stuck in
                            // `in_progress` with a live
                            // "Putting it all together..." indicator.
                            if !terminal_seen {
                                if let Some(tid) = current_task_id.clone() {
                                    synthesize_task_failed(
                                        &app_broadcast,
                                        storage_client.as_ref(),
                                        jwt.as_deref(),
                                        project_id,
                                        agent_instance_id,
                                        &tid,
                                        "Automaton finished without emitting task_completed",
                                    )
                                    .await;
                                    session_status = "failed";
                                }
                            }
                            terminal_seen = true;
                            // `terminal_seen` is not observed after this
                            // `break`, but we leave the assignment for
                            // future-proofing in case the post-break
                            // cleanup ever reads it.
                            let _ = terminal_seen;
                            clear_active_automaton(
                                automaton_registry.clone(),
                                project_id,
                                agent_instance_id,
                            )
                            .await;
                            let _ = agent_instance_service
                                .finish_working(&project_id, &agent_instance_id)
                                .await;
                            if let Some(session_id) = current_session_id {
                                close_automaton_session(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    session_id,
                                    session_status,
                                )
                                .await;

                                if let (Some(sc), Some(j)) = (storage_client.clone(), jwt.clone()) {
                                    let sid = session_id.to_string();
                                    let rurl = router_url.clone();
                                    let hclient = http_client.clone();
                                    tokio::spawn(async move {
                                        if let Err(e) = super::agents::generate_session_summary(
                                            &sc, &hclient, &rurl, &j, &sid,
                                        )
                                        .await
                                        {
                                            warn!(session_id = %sid, error = %e, "Background session summary generation failed");
                                        }
                                    });
                                }
                            }
                            emit_domain_event(
                                &app_broadcast,
                                "loop_finished",
                                project_id,
                                agent_instance_id,
                                serde_json::json!({}),
                            );
                            break;
                        }
                        "error" => {
                            // Harness-level error event. If no `task_failed`
                            // follows, this would otherwise vanish into the
                            // UI without any explanation. Either retry once
                            // (for run_single_task) or synthesise a
                            // `task_failed` with the error text as the
                            // reason.
                            let reason = extract_failure_reason(&event)
                                .unwrap_or_else(|| "Automaton reported an error".to_string());
                            let retry_after_hint = extract_retry_after(&event);
                            // Breadcrumb for the completion-gate path: if
                            // this error looks like an infra transient and
                            // the harness later emits a spurious
                            // `task_completed`, we want to recover this
                            // reason rather than classify the gate's
                            // "no output, no file changes" synthesis.
                            if classify_infra_failure(&reason).is_some() {
                                last_transient_reason = Some(reason.clone());
                            }
                            session_status = "failed";
                            if let Some(tid) = current_task_id.clone() {
                                if let Some(ctx) = take_retry_context(&mut retry) {
                                    match restart_with_infra_backoff(
                                        &app_broadcast,
                                        &automaton_registry,
                                        project_id,
                                        agent_instance_id,
                                        &tid,
                                        &reason,
                                        classify_infra_failure(&reason),
                                        retry_after_hint,
                                        &ctx,
                                    )
                                    .await
                                    {
                                        Ok(new_tx) => {
                                            rx = new_tx.subscribe();
                                            // Retry cleared the terminal
                                            // state for the next attempt.
                                            terminal_seen = false;
                                            session_status = "completed";
                                            continue;
                                        }
                                        Err(restart_err) => {
                                            warn!(
                                                task_id = %tid, %restart_err,
                                                "Automaton restart after error failed; marking task failed"
                                            );
                                            let combined =
                                                format!("{reason} (retry failed: {restart_err})");
                                            terminal_seen = true;
                                            synthesize_task_failed(
                                                &app_broadcast,
                                                storage_client.as_ref(),
                                                jwt.as_deref(),
                                                project_id,
                                                agent_instance_id,
                                                &tid,
                                                &combined,
                                            )
                                            .await;
                                        }
                                    }
                                } else {
                                    terminal_seen = true;
                                    synthesize_task_failed(
                                        &app_broadcast,
                                        storage_client.as_ref(),
                                        jwt.as_deref(),
                                        project_id,
                                        agent_instance_id,
                                        &tid,
                                        &reason,
                                    )
                                    .await;
                                }
                            }
                            // Skip the default forwarding — we've already
                            // broadcast a well-formed `task_failed` (or are
                            // retrying silently).
                            continue;
                        }
                        "paused" => {
                            let mut reg = automaton_registry.lock().await;
                            if let Some(entry) = reg.get_mut(&agent_instance_id) {
                                entry.paused = true;
                            }
                            Some("loop_paused")
                        }
                        "resumed" => {
                            let mut reg = automaton_registry.lock().await;
                            if let Some(entry) = reg.get_mut(&agent_instance_id) {
                                entry.paused = false;
                            }
                            Some("loop_resumed")
                        }
                        _ => map_passthrough_event_type(event_type),
                    };

                    let mut forwarded = event.clone();
                    if let Some(obj) = forwarded.as_object_mut() {
                        let event_task_id = obj
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let effective_task_id = current_task_id.clone().or(event_task_id);
                        obj.insert("project_id".into(), serde_json::Value::String(pid.clone()));
                        obj.insert(
                            "agent_instance_id".into(),
                            serde_json::Value::String(aiid.clone()),
                        );
                        if let Some(ref tid) = effective_task_id {
                            obj.insert("task_id".into(), serde_json::Value::String(tid.clone()));
                        }
                        if let Some(mapped) = mapped_type {
                            obj.insert("type".into(), serde_json::Value::String(mapped.into()));
                        }
                    }

                    let sync_progress = if let Some(tid) = forwarded
                        .get("task_id")
                        .and_then(|v| v.as_str())
                        .map(str::to_owned)
                    {
                        let mut cache = task_output_cache.lock().await;
                        let entry = cache.entry(tid.clone()).or_default();
                        if entry.project_id.is_none() {
                            entry.project_id = Some(pid.clone());
                        }
                        if entry.agent_instance_id.is_none() {
                            entry.agent_instance_id = Some(aiid.clone());
                        }
                        if entry.session_id.is_none() {
                            entry.session_id = current_session_id_string.clone();
                        }
                        update_task_sync_progress(entry, &forwarded)
                            .map(|(checkpoint, state)| (tid, checkpoint, state))
                    } else {
                        None
                    };

                    let _ = app_broadcast.send(forwarded.clone());

                    if let (Some(session_id), Some((task_id, checkpoint, sync_state))) =
                        (current_session_id_string.as_deref(), sync_progress)
                    {
                        let sc = storage_client.clone();
                        let j = jwt.clone();
                        let sid = session_id.to_string();
                        tokio::spawn(async move {
                            persistence::persist_task_sync_progress(
                                sc.as_ref(),
                                j.as_deref(),
                                &sid,
                                &task_id,
                                &checkpoint,
                                &sync_state,
                            )
                            .await;
                        });
                    }

                    if let Some(session_id) = current_session_id_string.as_deref() {
                        let event_type =
                            forwarded.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if persistence::is_session_event_worthy(event_type) {
                            let sc = storage_client.clone();
                            let j = jwt.clone();
                            let sid = session_id.to_string();
                            let ev = forwarded.clone();
                            tokio::spawn(async move {
                                persistence::persist_session_event(
                                    sc.as_ref(),
                                    j.as_deref(),
                                    &sid,
                                    &ev,
                                )
                                .await;
                            });
                        }
                    }

                    if persistence::is_log_worthy(
                        forwarded.get("type").and_then(|t| t.as_str()).unwrap_or(""),
                    ) {
                        let sc = storage_client.clone();
                        let j = jwt.clone();
                        let p = pid.clone();
                        let forwarded_clone = forwarded.clone();
                        tokio::spawn(async move {
                            persistence::persist_log_event(
                                sc.as_ref(),
                                j.as_deref(),
                                &p,
                                &forwarded_clone,
                            )
                            .await;
                        });
                    }

                    // Debug-bundle persistence (always-on). The writer
                    // routes recognised `debug.*` frames into their
                    // dedicated JSONL channels and copies everything
                    // into the run-scoped `events.jsonl`. We re-read
                    // the event type from `forwarded` rather than the
                    // outer `event_type` binding because `event` was
                    // mutably borrowed above and the forwarder may
                    // have rewritten `type` via `mapped_type`.
                    let forwarded_type = forwarded
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_owned();
                    loop_log
                        .on_json_event(project_id, agent_instance_id, &forwarded)
                        .await;

                    // Phase 6 — re-run heuristics against the still-
                    // growing bundle and surface new Warn/Error
                    // findings as `heuristic_finding` domain events.
                    // The analyzer is strictly observational; Phase 3
                    // (post-failure) and Phase 5 (pre-flight) remain
                    // the authoritative actors on RemediationHint.
                    // The analyzer is constructed lazily and the
                    // bundle dir is resolved only when a trigger is
                    // imminent, so the hot path never pays the
                    // `list_runs` filesystem cost.
                    let analyzer =
                        live_analyzer.get_or_insert_with(super::live_heuristics::LiveAnalyzer::new);
                    analyzer.note_event(&forwarded_type);
                    if analyzer.should_run() {
                        if live_bundle_dir.is_none() {
                            live_bundle_dir = latest_run_dir_for(
                                loop_log.as_ref(),
                                project_id,
                                agent_instance_id,
                            )
                            .await;
                        }
                        if let Some(ref dir) = live_bundle_dir {
                            let run_id = dir
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("")
                                .to_string();
                            if let Some(new_findings) = analyzer.maybe_analyze(dir) {
                                for finding in new_findings {
                                    super::live_heuristics::emit_live_heuristic(
                                        &app_broadcast,
                                        &finding,
                                        project_id,
                                        agent_instance_id,
                                        &run_id,
                                    );
                                }
                            }
                        }
                    }

                    if forwarded_type == "task_started" {
                        if let Some(tid_uuid) = forwarded
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.parse::<TaskId>().ok())
                        {
                            let spec_id = resolve_task_spec_id(
                                storage_client.as_ref(),
                                jwt.as_deref(),
                                &tid_uuid,
                            )
                            .await;
                            loop_log
                                .on_task_started(project_id, agent_instance_id, tid_uuid, spec_id)
                                .await;
                        }
                    }
                    if matches!(forwarded_type.as_str(), "task_completed" | "task_failed") {
                        if let Some(tid_str) = current_task_id.clone().or_else(|| {
                            forwarded
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(str::to_owned)
                        }) {
                            if let Ok(tid_uuid) = tid_str.parse::<TaskId>() {
                                let cached_output = task_output_cache
                                    .lock()
                                    .await
                                    .get(&tid_str)
                                    .map(|entry| entry.live_output.clone())
                                    .unwrap_or_default();
                                loop_log.on_task_end(tid_uuid, &cached_output).await;
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    // The harness event stream disconnected. If we never
                    // saw a terminal event for the active task, that leaves
                    // the UI stuck on a live streaming indicator and the
                    // task in `in_progress` forever. Either retry once or
                    // synthesise a `task_failed` with a real reason.
                    if !terminal_seen {
                        if let Some(tid) = current_task_id.clone() {
                            if let Some(ctx) = take_retry_context(&mut retry) {
                                match restart_with_infra_backoff(
                                    &app_broadcast,
                                    &automaton_registry,
                                    project_id,
                                    agent_instance_id,
                                    &tid,
                                    "Automaton event stream closed before the task finished",
                                    None,
                                    None,
                                    &ctx,
                                )
                                .await
                                {
                                    Ok(new_tx) => {
                                        rx = new_tx.subscribe();
                                        session_status = "completed";
                                        continue;
                                    }
                                    Err(restart_err) => {
                                        warn!(
                                            task_id = %tid, %restart_err,
                                            "Automaton restart after stream close failed; marking task failed"
                                        );
                                        let reason = format!(
                                            "Automaton event stream closed before the task finished (retry failed: {restart_err})"
                                        );
                                        synthesize_task_failed(
                                            &app_broadcast,
                                            storage_client.as_ref(),
                                            jwt.as_deref(),
                                            project_id,
                                            agent_instance_id,
                                            &tid,
                                            &reason,
                                        )
                                        .await;
                                    }
                                }
                            } else {
                                synthesize_task_failed(
                                    &app_broadcast,
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    project_id,
                                    agent_instance_id,
                                    &tid,
                                    "Automaton event stream closed before the task finished",
                                )
                                .await;
                            }
                            session_status = "failed";
                        }
                    }
                    clear_active_automaton(
                        automaton_registry.clone(),
                        project_id,
                        agent_instance_id,
                    )
                    .await;
                    let _ = agent_instance_service
                        .finish_working(&project_id, &agent_instance_id)
                        .await;
                    if let Some(session_id) = current_session_id {
                        close_automaton_session(
                            storage_client.as_ref(),
                            jwt.as_deref(),
                            session_id,
                            session_status,
                        )
                        .await;

                        if let (Some(sc), Some(j)) = (storage_client.clone(), jwt.clone()) {
                            let sid = session_id.to_string();
                            let rurl = router_url.clone();
                            let hclient = http_client.clone();
                            tokio::spawn(async move {
                                if let Err(e) = super::agents::generate_session_summary(
                                    &sc, &hclient, &rurl, &j, &sid,
                                )
                                .await
                                {
                                    warn!(session_id = %sid, error = %e, "Background session summary generation failed");
                                }
                            });
                        }
                    }
                    emit_domain_event(
                        &app_broadcast,
                        "loop_finished",
                        project_id,
                        agent_instance_id,
                        serde_json::json!({}),
                    );
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }

        // Persist the final bundle metadata + summary. Status is
        // inferred from the last-seen session_status so the Debug UI
        // can filter "failed vs completed" without replaying events.
        let final_status = match session_status {
            "failed" => crate::loop_log::RunStatus::Failed,
            "paused" => crate::loop_log::RunStatus::Interrupted,
            _ => crate::loop_log::RunStatus::Completed,
        };
        loop_log
            .on_loop_ended(project_id, agent_instance_id, final_status)
            .await;
    });

    handle.abort_handle()
}

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    super::billing::require_credits(&state, &jwt).await?;

    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);

    let jwt = Some(jwt);
    let project = state.project_service.get_project(&project_id).ok();
    let project_name = project.as_ref().map(|p| p.name.as_str()).unwrap_or("");
    let agent_instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                ApiError::not_found(format!("agent instance {agent_instance_id} not found"))
            }
            other => ApiError::internal(format!(
                "looking up agent instance {agent_instance_id}: {other}"
            )),
        })?;
    let selected_model = requested_automaton_model(params.model.as_deref(), &agent_instance);
    info!(
        %project_id, %agent_instance_id,
        agent_id = %agent_instance.agent_id,
        machine_type = %agent_instance.machine_type,
        selected_model = selected_model.as_deref().unwrap_or("default"),
        "Resolved agent instance for loop start"
    );
    let machine_type = agent_instance.machine_type.clone();
    let swarm_agent_id = Some(agent_instance.agent_id.to_string());
    let harness_mode = HarnessMode::from_machine_type(&machine_type);
    let automaton_client = automaton_client_for_mode(
        &state,
        harness_mode,
        swarm_agent_id.as_deref(),
        jwt.as_deref(),
    )?;
    info!(
        %project_id, %agent_instance_id,
        base_url = %automaton_client.base_url(),
        ?harness_mode,
        "Automaton client configured for loop start"
    );
    let usage_reporting = build_usage_reporting_context(
        &state,
        project_id,
        agent_instance_id,
        project.as_ref().map(|project| project.org_id.to_string()),
        selected_model.clone(),
        jwt.as_deref(),
    )
    .await;
    let project_path = if harness_mode == HarnessMode::Swarm {
        match automaton_client.resolve_workspace(project_name).await {
            Ok(path) => path,
            Err(e) => {
                warn!(%project_id, error = %e, "Harness workspace resolve failed; using local computation");
                resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
                    .await
                    .unwrap_or_else(|| {
                        format!(
                            "/home/aura/{}",
                            super::projects_helpers::slugify(project_name)
                        )
                    })
            }
        }
    } else {
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
            .await
            .unwrap_or_default()
    };

    preflight_local_workspace(
        harness_mode,
        &project_path,
        resolve_git_repo_url(project.as_ref()).as_deref(),
    )?;

    let jwt_for_persist = jwt.clone();
    let installed_tools = match jwt
        .as_deref()
        .zip(project.as_ref().map(|project| &project.org_id))
    {
        Some((jwt, org_id)) => {
            let mut tools = installed_workspace_app_tools(&state, org_id, jwt).await;
            dedupe_and_log_installed_tools("dev_loop_start", &project_id.to_string(), &mut tools);
            (!tools.is_empty()).then_some(tools)
        }
        None => None,
    };
    let installed_integrations = match project.as_ref() {
        Some(project) => {
            let integrations = installed_workspace_integrations_for_org_with_token(
                &state,
                &project.org_id,
                jwt.as_deref().unwrap_or_default(),
            )
            .await;
            (!integrations.is_empty()).then_some(integrations)
        }
        None => None,
    };
    let start_params = AutomatonStartParams {
        project_id: project_id.to_string(),
        auth_token: jwt,
        model: selected_model.clone(),
        workspace_root: Some(project_path),
        task_id: None,
        git_repo_url: resolve_git_repo_url(project.as_ref()),
        git_branch: project.as_ref().and_then(|p| p.git_branch.clone()),
        installed_tools,
        installed_integrations,
        // Dev-loop mode: the harness derives its own retry-warm-up
        // context from `STATE_FAILURE_REASONS` and the in-loop work
        // log; the server side does not pre-populate these. Only
        // `run_single_task` plumbs real values here.
        prior_failure: None,
        work_log: Vec::new(),
    };

    let (automaton_id, adopted, event_stream_url) = match automaton_client
        .start(start_params.clone())
        .await
    {
        Ok(r) => {
            let esurl = r.event_stream_url.clone();
            (r.automaton_id, false, Some(esurl))
        }
        Err(AutomatonStartError::Conflict(existing_id)) => match existing_id {
            Some(aid) => {
                let stale_or_dead = match automaton_client.status(&aid).await {
                    Ok(status) => !automaton_is_active(&status),
                    Err(e) => {
                        warn!(
                            %aid,
                            %project_id,
                            error = %e,
                            "Failed to inspect conflicting automaton status; treating as stale"
                        );
                        true
                    }
                };

                if stale_or_dead {
                    info!(
                        %aid,
                        %project_id,
                        "Conflicting automaton appears stale; stopping and retrying start"
                    );
                    if let Err(e) = automaton_client.stop(&aid).await {
                        warn!(
                            %aid,
                            %project_id,
                            error = %e,
                            "Failed to stop stale conflicting automaton before retry"
                        );
                    }
                    match automaton_client.start(start_params.clone()).await {
                        Ok(r) => {
                            let esurl = r.event_stream_url.clone();
                            (r.automaton_id, false, Some(esurl))
                        }
                        Err(AutomatonStartError::Conflict(Some(retry_id))) => {
                            info!(
                                %retry_id,
                                %project_id,
                                "Retry still conflicts; adopting existing automaton"
                            );
                            (retry_id, true, None)
                        }
                        Err(AutomatonStartError::Conflict(None)) => {
                            return Err(ApiError::conflict(
                                "A dev loop is already running but its ID could not be determined",
                            ));
                        }
                        Err(e) => {
                            return Err(ApiError::internal(format!(
                                "starting dev loop after stale cleanup: {e}"
                            )));
                        }
                    }
                } else {
                    info!(%aid, %project_id, "Adopting existing automaton from harness");
                    (aid, true, None)
                }
            }
            None => {
                return Err(ApiError::conflict(
                    "A dev loop is already running but its ID could not be determined",
                ));
            }
        },
        Err(AutomatonStartError::Request {
            message,
            is_connect,
            is_timeout,
        }) => {
            warn!(
                %project_id, %agent_instance_id,
                base_url = %automaton_client.base_url(),
                %is_connect, %is_timeout,
                %message,
                "Automaton start request error"
            );
            if is_connect {
                crate::app_builder::ensure_local_harness_running();
                return Err(ApiError::service_unavailable(format!(
                    "Service unavailable: local aura-harness at {} could not be reached ({message}). \
                     Recovery spawn was attempted; if this keeps failing, check harness build/startup logs.",
                    automaton_client.base_url(),
                )));
            }
            if is_timeout {
                return Err(ApiError::service_unavailable(format!(
                    "Service unavailable: local aura-harness at {} timed out while handling start ({message}).",
                    automaton_client.base_url(),
                )));
            }
            return Err(ApiError::internal(format!("starting dev loop: {message}")));
        }
        Err(AutomatonStartError::Response { status, body }) => {
            warn!(
                %project_id, %agent_instance_id,
                base_url = %automaton_client.base_url(),
                %status,
                response_body = %body,
                "Automaton start response error"
            );
            if harness_mode == HarnessMode::Swarm && status == 404 {
                return Err(ApiError::service_unavailable(format!(
                    "Remote dev-loop start is unavailable: swarm gateway at {} does not expose /automaton/start (HTTP 404).",
                    automaton_client.base_url()
                )));
            }
            return Err(ApiError::bad_gateway(format!(
                "automaton start failed via {} (status {}): {}",
                automaton_client.base_url(),
                status,
                body
            )));
        }
        Err(e) => return Err(ApiError::internal(format!("starting dev loop: {e}"))),
    };

    info!(
        %project_id,
        %agent_instance_id,
        %automaton_id,
        adopted,
        event_stream_url = event_stream_url.as_deref().unwrap_or("<none>"),
        "Dev loop automaton ready"
    );

    // Single-flight the forwarder per agent instance.
    //
    // The adopt path fires whenever the harness reports a `Conflict` on
    // start — which happens on every legitimate idempotent re-click of the
    // Run button while the automaton is still running. Without this guard
    // each re-click spawns another `forward_automaton_events` task that
    // subscribes to the same harness broadcast, so a single `tool_use_start`
    // event ends up being forwarded N times to `state.event_broadcast` and
    // fans out N duplicate tool cards on the client.
    //
    // Reuse the existing forwarder iff we adopted the same automaton id and
    // its forwarder is still alive. Otherwise abort the stale handle below
    // and let the fresh spawn replace it.
    if adopted {
        let reuse = {
            let reg = state.automaton_registry.lock().await;
            reg.get(&agent_instance_id)
                .map(|entry| {
                    entry.automaton_id == automaton_id
                        && entry.alive.load(std::sync::atomic::Ordering::SeqCst)
                })
                .unwrap_or(false)
        };
        if reuse {
            info!(
                %project_id, %agent_instance_id, %automaton_id,
                "Reusing existing forwarder for adopted automaton; skipping duplicate spawn"
            );
            emit_domain_event(
                &state.event_broadcast,
                "loop_started",
                project_id,
                agent_instance_id,
                serde_json::json!({
                    "automaton_id": &automaton_id,
                    "adopted": true,
                    "reused": true,
                }),
            );
            let active_agent_instances = active_instances(&state, project_id).await;
            let active_tasks = active_tasks(&state, project_id).await;
            return Ok((
                StatusCode::OK,
                Json(LoopStatusResponse {
                    running: true,
                    paused: false,
                    loop_state: Some("running".to_string()),
                    project_id: Some(project_id),
                    agent_instance_id: Some(agent_instance_id),
                    active_agent_instances: Some(active_agent_instances),
                    cooldown_remaining_ms: None,
                    cooldown_reason: None,
                    cooldown_kind: None,
                    active_tasks: Some(active_tasks),
                }),
            ));
        }
    }

    // Replace any stale registry entry (e.g. forwarder terminated but
    // registry cleanup lost a race, or the adopted automaton id changed).
    // Aborting the old `AbortHandle` proactively is defensive: the `alive`
    // flag should already be false in practice, but cancelling the task
    // guarantees we can't leak a second subscriber against the broadcast.
    {
        let reg = state.automaton_registry.lock().await;
        if let Some(stale) = reg.get(&agent_instance_id) {
            if let Some(handle) = stale.forwarder.as_ref() {
                handle.abort();
            }
        }
    }
    // If the stale forwarder never reached its cleanup path, the on-disk
    // run bundle for the previous (project, agent_instance) is still
    // marked `status: running`. Flip it to `interrupted` before we start
    // a new run so the Debug app doesn't show two "running" rows for the
    // same instance. No-op when the previous loop exited cleanly
    // (the in-memory run_state entry is already gone).
    state
        .loop_log
        .on_loop_ended(
            project_id,
            agent_instance_id,
            crate::loop_log::RunStatus::Interrupted,
        )
        .await;

    let events_tx = match automaton_client
        .connect_event_stream(&automaton_id, event_stream_url.as_deref())
        .await
    {
        Ok(tx) => tx,
        Err(e) => {
            // If start succeeded but event-stream attach failed, proactively stop
            // the spawned automaton so we don't leak an untracked loop that
            // cannot be stopped via our registry.
            if !adopted {
                if let Err(stop_err) = automaton_client.stop(&automaton_id).await {
                    warn!(
                        %project_id,
                        %agent_instance_id,
                        %automaton_id,
                        error = %stop_err,
                        "Failed to stop newly started automaton after stream attach failure"
                    );
                } else {
                    info!(
                        %project_id,
                        %agent_instance_id,
                        %automaton_id,
                        "Stopped newly started automaton after stream attach failure"
                    );
                }
            }
            return Err(ApiError::internal(format!(
                "connecting event stream for dev loop (adopted={adopted}): {e}"
            )));
        }
    };

    // Resolve the first task the automaton will pick so that events
    // arriving before the real task_started get stamped with a task_id.
    // Without this, text_delta events have no task_id and the frontend
    // silently discards them.
    let first_task_id =
        resolve_active_task_id(state.task_service.as_ref(), &project_id, &agent_instance_id).await;
    let first_task_uuid = first_task_id
        .as_deref()
        .and_then(|task_id| task_id.parse::<TaskId>().ok());
    let current_session_id = if adopted {
        state
            .agent_instance_service
            .get_instance(&project_id, &agent_instance_id)
            .await
            .ok()
            .and_then(|instance| instance.current_session_id)
    } else {
        create_automaton_session(
            &state,
            project_id,
            agent_instance_id,
            first_task_uuid,
            selected_model.clone(),
            jwt_for_persist.as_deref(),
        )
        .await
    };

    if let Some(ref tid) = first_task_id {
        emit_domain_event(
            &state.event_broadcast,
            "task_started",
            project_id,
            agent_instance_id,
            serde_json::json!({"task_id": tid}),
        );
        let mut cache = state.task_output_cache.lock().await;
        cache.insert(
            tid.clone(),
            CachedTaskOutput {
                project_id: Some(project_id.to_string()),
                agent_instance_id: Some(agent_instance_id.to_string()),
                session_id: current_session_id.map(|id| id.to_string()),
                ..Default::default()
            },
        );
    }

    // Share one `Arc<AtomicBool>` between the forwarder task and the
    // registry entry so the `ForwarderAliveGuard` drop in the task
    // directly flips the flag that `start_loop`'s single-flight check
    // reads. Also capture the `AbortHandle` so `stop_loop` / a stale-
    // entry replacement in a later `start_loop` can proactively cancel
    // the forwarder instead of waiting for the harness broadcast to
    // close on its own.
    let forwarder_alive = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Always-on debug bundle: create the run directory before the
    // forwarder starts so the very first event lands in the right
    // place. See `crate::loop_log` for the on-disk schema.
    state
        .loop_log
        .on_loop_started(project_id, agent_instance_id)
        .await;
    if let Some(ref tid) = first_task_id {
        if let Ok(tid_uuid) = tid.parse::<TaskId>() {
            let spec_id = resolve_task_spec_id(
                state.storage_client.as_ref(),
                jwt_for_persist.as_deref(),
                &tid_uuid,
            )
            .await;
            state
                .loop_log
                .on_task_started(project_id, agent_instance_id, tid_uuid, spec_id)
                .await;
        }
    }

    let forwarder_handle = forward_automaton_events(ForwardParams {
        automaton_events_tx: events_tx,
        app_broadcast: state.event_broadcast.clone(),
        automaton_registry: state.automaton_registry.clone(),
        project_id,
        agent_instance_id,
        task_id: first_task_id.clone(),
        task_service: state.task_service.clone(),
        task_output_cache: state.task_output_cache.clone(),
        storage_client: state.storage_client.clone(),
        jwt: jwt_for_persist.clone(),
        session_id: current_session_id,
        session_service: state.session_service.clone(),
        agent_instance_service: state.agent_instance_service.clone(),
        usage_reporting,
        router_url: state.agent_runtime.router_url.clone(),
        http_client: state.agent_runtime.http_client.clone(),
        // Dev loop already handles retries via its own task scheduler; the
        // outer loop will pick the task up again if it was reset.
        retry: Some(TransientRetryContext {
            automaton_client: automaton_client.clone(),
            start_params: start_params.clone(),
            restart_budget: None,
        }),
        alive: forwarder_alive.clone(),
        loop_log: state.loop_log.clone(),
    });

    emit_domain_event(
        &state.event_broadcast,
        "loop_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"automaton_id": &automaton_id, "adopted": adopted}),
    );
    {
        let ev = serde_json::json!({"type": "loop_started", "project_id": project_id.to_string(), "agent_instance_id": agent_instance_id.to_string()});
        let sc = state.storage_client.clone();
        let j = jwt_for_persist.clone();
        let p = project_id.to_string();
        tokio::spawn(async move {
            persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
        });
    }

    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            agent_instance_id,
            ActiveAutomaton {
                automaton_id: automaton_id.clone(),
                project_id,
                harness_base_url: automaton_client.base_url().to_string(),
                paused: false,
                alive: forwarder_alive,
                forwarder: Some(forwarder_handle),
                current_task_id: first_task_id.clone(),
            },
        );
    }

    let active_agent_instances = active_instances(&state, project_id).await;
    let active_tasks = active_tasks(&state, project_id).await;
    let (loop_state, cooldown_remaining_ms, cooldown_reason, cooldown_kind) =
        loop_status_details(project_id, true, false);

    Ok((
        StatusCode::CREATED,
        Json(LoopStatusResponse {
            running: true,
            paused: false,
            loop_state: Some(loop_state),
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            active_agent_instances: Some(active_agent_instances),
            cooldown_remaining_ms,
            cooldown_reason,
            cooldown_kind,
            active_tasks: Some(active_tasks),
        }),
    ))
}

pub(crate) async fn pause_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let reg = state.automaton_registry.lock().await;
    let targets: Vec<(AgentInstanceId, String)> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone()))
        .collect();
    drop(reg);

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    let mut paused_count = 0usize;
    for (aiid, automaton_id) in &targets {
        let base_url = {
            let reg = state.automaton_registry.lock().await;
            reg.get(aiid)
                .map(|a| a.harness_base_url.clone())
                .unwrap_or_else(|| state.automaton_client.base_url().to_string())
        };
        let client = aura_os_link::AutomatonClient::new(&base_url);
        if let Err(e) = client.pause(automaton_id).await {
            warn!(automaton_id, error = %e, "Failed to pause automaton");
            continue;
        }
        paused_count += 1;
        {
            let mut reg = state.automaton_registry.lock().await;
            if let Some(entry) = reg.get_mut(aiid) {
                entry.paused = true;
            }
        }
        emit_domain_event(
            &state.event_broadcast,
            "loop_paused",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
        {
            let ev = serde_json::json!({"type": "loop_paused", "project_id": project_id.to_string(), "agent_instance_id": aiid.to_string()});
            let sc = state.storage_client.clone();
            let j: Option<String> = Some(jwt.clone());
            let p = project_id.to_string();
            tokio::spawn(async move {
                persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
            });
        }
    }

    if paused_count == 0 {
        return Err(ApiError::bad_gateway("failed to pause any automaton"));
    }

    let active_agent_instances = active_instances(&state, project_id).await;
    let active_tasks = active_tasks(&state, project_id).await;
    let (loop_state, cooldown_remaining_ms, cooldown_reason, cooldown_kind) =
        loop_status_details(project_id, true, true);

    Ok(Json(LoopStatusResponse {
        running: true,
        paused: true,
        loop_state: Some(loop_state),
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(active_agent_instances),
        cooldown_remaining_ms,
        cooldown_reason,
        cooldown_kind,
        active_tasks: Some(active_tasks),
    }))
}

pub(crate) async fn stop_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let reg = state.automaton_registry.lock().await;
    let targets: Vec<(AgentInstanceId, String, String)> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone(), a.harness_base_url.clone()))
        .collect();
    drop(reg);

    // Stop is idempotent: if nothing matches, the caller's goal ("no loop
    // running for this project/agent") is already satisfied, so return the
    // current status instead of a 4xx. This keeps the UI unstuck when the
    // harness self-terminated or a previous stop already cleared the entry.
    if targets.is_empty() {
        let remaining = active_instances(&state, project_id).await;
        let remaining_tasks = active_tasks(&state, project_id).await;
        let (loop_state, cooldown_remaining_ms, cooldown_reason, cooldown_kind) =
            loop_status_details(project_id, !remaining.is_empty(), false);
        return Ok(Json(LoopStatusResponse {
            running: !remaining.is_empty(),
            paused: false,
            loop_state: Some(loop_state),
            project_id: Some(project_id),
            agent_instance_id: params.agent_instance_id,
            active_agent_instances: Some(remaining),
            cooldown_remaining_ms,
            cooldown_reason,
            cooldown_kind,
            active_tasks: Some(remaining_tasks),
        }));
    }

    for (aiid, automaton_id, base_url) in &targets {
        let client = aura_os_link::AutomatonClient::new(base_url);
        // Best-effort: log harness-side failures but continue clearing local
        // state. A failed stop call usually means the harness is already gone
        // or unreachable; leaving the registry entry in place would block
        // future starts/stops and keep the UI stuck on Pause/Stop forever.
        if let Err(e) = client.stop(automaton_id).await {
            warn!(
                automaton_id,
                error = %e,
                "Failed to stop automaton at harness; clearing local registry anyway"
            );
        }
        {
            let mut reg = state.automaton_registry.lock().await;
            // Abort the forwarder task before dropping the registry entry
            // so we don't leak a subscriber against the harness broadcast
            // after the automaton has been told to stop.
            if let Some(entry) = reg.remove(aiid) {
                if let Some(handle) = entry.forwarder {
                    handle.abort();
                }
            }
        }
        // Finalise the on-disk run bundle so the Debug UI flips the run
        // from `running` to `interrupted` immediately. Without this the
        // forwarder task is aborted before it can reach its own
        // `on_loop_ended` call and the metadata stays stuck at
        // `status: running` until the next server restart's
        // `reconcile_orphan_runs` sweep — which surfaces as a ghost entry
        // in the Debug app's "Running now" list. Safe as a belt-and-
        // suspenders call: `on_loop_ended` is idempotent (no-op when the
        // in-memory run_state entry was already removed by the forwarder).
        state
            .loop_log
            .on_loop_ended(project_id, *aiid, crate::loop_log::RunStatus::Interrupted)
            .await;
        emit_domain_event(
            &state.event_broadcast,
            "loop_stopped",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
        {
            let ev = serde_json::json!({"type": "loop_stopped", "project_id": project_id.to_string(), "agent_instance_id": aiid.to_string()});
            let sc = state.storage_client.clone();
            let j: Option<String> = Some(jwt.clone());
            let p = project_id.to_string();
            tokio::spawn(async move {
                persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
            });
        }
    }

    let remaining = active_instances(&state, project_id).await;
    let remaining_tasks = active_tasks(&state, project_id).await;
    let (loop_state, cooldown_remaining_ms, cooldown_reason, cooldown_kind) =
        loop_status_details(project_id, !remaining.is_empty(), false);

    Ok(Json(LoopStatusResponse {
        running: !remaining.is_empty(),
        paused: false,
        loop_state: Some(loop_state),
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(remaining),
        cooldown_remaining_ms,
        cooldown_reason,
        cooldown_kind,
        active_tasks: Some(remaining_tasks),
    }))
}

pub(crate) async fn resume_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let reg = state.automaton_registry.lock().await;
    let targets: Vec<(AgentInstanceId, String, String)> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id && a.paused)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone(), a.harness_base_url.clone()))
        .collect();
    drop(reg);

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching paused dev loop found"));
    }

    let mut resumed_count = 0usize;
    for (aiid, automaton_id, base_url) in &targets {
        let client = aura_os_link::AutomatonClient::new(base_url);
        if let Err(e) = client.resume(automaton_id).await {
            warn!(automaton_id, error = %e, "Failed to resume automaton");
            continue;
        }
        resumed_count += 1;
        {
            let mut reg = state.automaton_registry.lock().await;
            if let Some(entry) = reg.get_mut(aiid) {
                entry.paused = false;
            }
        }
        emit_domain_event(
            &state.event_broadcast,
            "loop_resumed",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
        {
            let ev = serde_json::json!({"type": "loop_resumed", "project_id": project_id.to_string(), "agent_instance_id": aiid.to_string()});
            let sc = state.storage_client.clone();
            let j: Option<String> = Some(jwt.clone());
            let p = project_id.to_string();
            tokio::spawn(async move {
                persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
            });
        }
    }

    if resumed_count == 0 {
        return Err(ApiError::bad_gateway("failed to resume any automaton"));
    }

    let active_agent_instances = active_instances(&state, project_id).await;
    let active_tasks = active_tasks(&state, project_id).await;
    let (loop_state, cooldown_remaining_ms, cooldown_reason, cooldown_kind) =
        loop_status_details(project_id, true, false);

    Ok(Json(LoopStatusResponse {
        running: true,
        paused: false,
        loop_state: Some(loop_state),
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(active_agent_instances),
        cooldown_remaining_ms,
        cooldown_reason,
        cooldown_kind,
        active_tasks: Some(active_tasks),
    }))
}

pub(crate) async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let reg = state.automaton_registry.lock().await;
    let active: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .map(|(aiid, _)| *aiid)
        .collect();
    let any_paused = reg
        .iter()
        .any(|(_, a)| a.project_id == project_id && a.paused);
    let active_tasks: Vec<ActiveLoopTask> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .filter_map(|(aiid, a)| {
            a.current_task_id.as_ref().map(|tid| ActiveLoopTask {
                task_id: tid.clone(),
                agent_instance_id: *aiid,
            })
        })
        .collect();
    drop(reg);
    let running = !active.is_empty();
    let (loop_state, cooldown_remaining_ms, cooldown_reason, cooldown_kind) =
        loop_status_details(project_id, running, any_paused);

    Ok(Json(LoopStatusResponse {
        running,
        paused: any_paused,
        loop_state: Some(loop_state),
        project_id: Some(project_id),
        agent_instance_id: None,
        active_agent_instances: Some(active),
        cooldown_remaining_ms,
        cooldown_reason,
        cooldown_kind,
        active_tasks: Some(active_tasks),
    }))
}

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    super::billing::require_credits(&state, &jwt).await?;

    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);

    let jwt = Some(jwt);
    let project = state.project_service.get_project(&project_id).ok();
    let project_name = project.as_ref().map(|p| p.name.as_str()).unwrap_or("");
    let agent_instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                ApiError::not_found(format!("agent instance {agent_instance_id} not found"))
            }
            other => ApiError::internal(format!(
                "looking up agent instance {agent_instance_id}: {other}"
            )),
        })?;
    let selected_model = requested_automaton_model(params.model.as_deref(), &agent_instance);
    let machine_type = agent_instance.machine_type.clone();
    let swarm_agent_id = Some(agent_instance.agent_id.to_string());
    let harness_mode = HarnessMode::from_machine_type(&machine_type);
    let automaton_client = automaton_client_for_mode(
        &state,
        harness_mode,
        swarm_agent_id.as_deref(),
        jwt.as_deref(),
    )?;
    let project_path = if harness_mode == HarnessMode::Swarm {
        match automaton_client.resolve_workspace(project_name).await {
            Ok(path) => path,
            Err(e) => {
                warn!(%project_id, error = %e, "Harness workspace resolve failed; using local computation");
                resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
                    .await
                    .unwrap_or_else(|| {
                        format!(
                            "/home/aura/{}",
                            super::projects_helpers::slugify(project_name)
                        )
                    })
            }
        }
    } else {
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
            .await
            .unwrap_or_default()
    };
    preflight_local_workspace(
        harness_mode,
        &project_path,
        resolve_git_repo_url(project.as_ref()).as_deref(),
    )?;
    let usage_reporting = build_usage_reporting_context(
        &state,
        project_id,
        agent_instance_id,
        project.as_ref().map(|project| project.org_id.to_string()),
        selected_model.clone(),
        jwt.as_deref(),
    )
    .await;

    let jwt_for_persist = jwt.clone();
    let installed_tools = match jwt
        .as_deref()
        .zip(project.as_ref().map(|project| &project.org_id))
    {
        Some((jwt, org_id)) => {
            let mut tools = installed_workspace_app_tools(&state, org_id, jwt).await;
            dedupe_and_log_installed_tools("dev_loop_task", &task_id.to_string(), &mut tools);
            (!tools.is_empty()).then_some(tools)
        }
        None => None,
    };
    let installed_integrations = match project.as_ref() {
        Some(project) => {
            let integrations = installed_workspace_integrations_for_org_with_token(
                &state,
                &project.org_id,
                jwt.as_deref().unwrap_or_default(),
            )
            .await;
            (!integrations.is_empty()).then_some(integrations)
        }
        None => None,
    };
    // Warm-up context for single-task retries: read the reason
    // persisted on the previous attempt's `task_failed` (stored in
    // `execution_notes` by `persist_task_failure_reason`) and forward
    // it to the harness as `prior_failure`. The `task-run` automaton
    // (Commit C1) folds it into `TaskInfo::execution_notes` so the
    // retry prompt differs from the initial one.
    //
    // First attempts typically have empty `execution_notes`; we treat
    // that as "no warm-up needed" so the field is dropped on the wire
    // (`AutomatonStartParams` skips `None`). Storage errors are
    // logged and ignored — failing to warm up is worse than failing
    // the retry outright.
    //
    // `work_log` is not persisted server-side today; we leave it
    // empty so the wire shape stays compatible and older harnesses
    // (pre-C1) simply ignore both fields.
    let prior_failure = match (state.storage_client.as_ref(), jwt.as_deref()) {
        (Some(storage_client), Some(jwt)) => {
            match storage_client.get_task(&task_id.to_string(), jwt).await {
                Ok(task) => task.execution_notes.filter(|s| !s.trim().is_empty()),
                Err(error) => {
                    warn!(
                        %task_id, %error,
                        "Failed to fetch task for prior_failure warm-up; retry will use a cold prompt"
                    );
                    None
                }
            }
        }
        _ => None,
    };
    let start_params = AutomatonStartParams {
        project_id: project_id.to_string(),
        auth_token: jwt,
        model: selected_model.clone(),
        workspace_root: Some(project_path),
        task_id: Some(task_id.to_string()),
        git_repo_url: resolve_git_repo_url(project.as_ref()),
        git_branch: project.as_ref().and_then(|p| p.git_branch.clone()),
        installed_tools,
        installed_integrations,
        prior_failure,
        work_log: Vec::new(),
    };
    let result = automaton_client
        .start(start_params.clone())
        .await
        .map_err(|e| {
            // Log the harness-side failure details server-side — the body is
            // otherwise only visible in the HTTP response to the frontend, so
            // tailing the desktop log during a `/automaton/start` 4xx/5xx
            // previously required opening DevTools to see the actual reason.
            match &e {
                AutomatonStartError::Response { status, body } => warn!(
                    harness_base_url = %automaton_client.base_url(),
                    status = %status,
                    body = %body,
                    %task_id,
                    %project_id,
                    %agent_instance_id,
                    "harness /automaton/start returned non-success status"
                ),
                AutomatonStartError::Request {
                    message,
                    is_connect,
                    is_timeout,
                } => warn!(
                    harness_base_url = %automaton_client.base_url(),
                    is_connect,
                    is_timeout,
                    error = %message,
                    %task_id,
                    %project_id,
                    %agent_instance_id,
                    "harness /automaton/start transport error"
                ),
                _ => {}
            }
            match e {
                AutomatonStartError::Conflict(_) => {
                    ApiError::conflict(format!("starting task runner: {e}"))
                }
                AutomatonStartError::Response { status, body } => ApiError::bad_gateway(format!(
                    "starting task runner via {} failed (status {}): {}",
                    automaton_client.base_url(),
                    status,
                    body
                )),
                _ => ApiError::internal(format!("starting task runner: {e}")),
            }
        })?;

    let automaton_id = result.automaton_id;
    let event_stream_url = result.event_stream_url;
    info!(%project_id, %task_id, %automaton_id, %event_stream_url, "Single task automaton started");

    // Connect to the event stream as early as possible to minimise the window
    // between automaton start and WS attach.  Retry a few times because the
    // harness may reset the connection if the automaton isn't ready yet.
    let events_tx =
        connect_with_retries(&automaton_client, &automaton_id, Some(&event_stream_url), 2)
            .await
            .ok();

    // Emit task_started immediately so the frontend gets the signal even if
    // early automaton events are lost in the race between start and WS connect.
    emit_domain_event(
        &state.event_broadcast,
        "task_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"task_id": task_id.to_string()}),
    );

    // Pre-seed the output cache so the REST endpoint can serve partial output.
    let session_id = create_automaton_session(
        &state,
        project_id,
        agent_instance_id,
        Some(task_id),
        selected_model.clone(),
        jwt_for_persist.as_deref(),
    )
    .await;
    {
        let mut cache = state.task_output_cache.lock().await;
        cache.insert(
            task_id.to_string(),
            CachedTaskOutput {
                project_id: Some(project_id.to_string()),
                agent_instance_id: Some(agent_instance_id.to_string()),
                session_id: session_id.map(|id| id.to_string()),
                ..Default::default()
            },
        );
    }
    if let Some(session_id) = session_id {
        let _ = state
            .agent_instance_service
            .start_working(&project_id, &agent_instance_id, &task_id, &session_id)
            .await;
    }

    if let Some(events_tx) = events_tx {
        // Start a debug bundle for single-task runs too so the Debug
        // UI can replay them alongside dev-loop runs.
        state
            .loop_log
            .on_loop_started(project_id, agent_instance_id)
            .await;
        let spec_id = resolve_task_spec_id(
            state.storage_client.as_ref(),
            jwt_for_persist.as_deref(),
            &task_id,
        )
        .await;
        state
            .loop_log
            .on_task_started(project_id, agent_instance_id, task_id, spec_id)
            .await;
        // `run_single_task` does not insert into `state.automaton_registry`
        // (single-task runs use unique agent instance ids and manage their
        // own lifecycle). The returned `AbortHandle` is intentionally
        // dropped — the forwarder self-terminates on `task_completed` /
        // `task_failed` / stream close, and there is no corresponding
        // stop-loop path that needs to cancel it externally.
        let _ = forward_automaton_events(ForwardParams {
            automaton_events_tx: events_tx,
            app_broadcast: state.event_broadcast.clone(),
            automaton_registry: state.automaton_registry.clone(),
            project_id,
            agent_instance_id,
            task_id: Some(task_id.to_string()),
            task_service: state.task_service.clone(),
            task_output_cache: state.task_output_cache.clone(),
            storage_client: state.storage_client.clone(),
            jwt: jwt_for_persist.clone(),
            session_id,
            session_service: state.session_service.clone(),
            agent_instance_service: state.agent_instance_service.clone(),
            usage_reporting,
            router_url: state.agent_runtime.router_url.clone(),
            http_client: state.agent_runtime.http_client.clone(),
            // Allow a small number of automatic restarts of the automaton
            // on infra-transient failures (stream closed without terminal
            // event, `error` event with no accompanying `task_failed`, and
            // upstream provider 500s classified as
            // `InfraFailureClass::ProviderInternalError`). The budget is
            // `SINGLE_TASK_RESTART_BUDGET`; see its docs for rationale.
            //
            // We intentionally do not retry harness-reported `task_failed`
            // with a non-infra reason, since the harness already runs
            // its own build/test fix loop inside the task.
            retry: Some(TransientRetryContext {
                automaton_client: automaton_client.clone(),
                start_params,
                restart_budget: Some(SINGLE_TASK_RESTART_BUDGET),
            }),
            alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            loop_log: state.loop_log.clone(),
        });
    } else {
        warn!(
            %project_id, %task_id, %automaton_id,
            "All event stream connection attempts failed; cleaning up"
        );
        let _ = state
            .agent_instance_service
            .finish_working(&project_id, &agent_instance_id)
            .await;
        if let Some(session_id) = session_id {
            close_automaton_session(
                state.storage_client.as_ref(),
                jwt_for_persist.as_deref(),
                session_id,
                "failed",
            )
            .await;
        }
        let reason = "Failed to connect to automaton event stream";
        // Persist the reason so it survives a page reload. We intentionally
        // persist before broadcasting so the UI sees consistent state if it
        // refetches the task in response to the event.
        persist_task_failure_reason(
            state.storage_client.as_ref(),
            jwt_for_persist.as_deref(),
            &task_id.to_string(),
            reason,
        )
        .await;
        emit_domain_event(
            &state.event_broadcast,
            "task_failed",
            project_id,
            agent_instance_id,
            serde_json::json!({
                "task_id": task_id.to_string(),
                "reason": reason,
            }),
        );
    }

    Ok(StatusCode::ACCEPTED)
}

/// Persist a failure reason on the task so it survives page reloads.
///
/// Writes the reason into `execution_notes` and then transitions the task
/// to `failed`. Both writes are best-effort: storage errors are logged but
/// do not propagate, matching the behaviour of the event-loop handler.
async fn persist_task_failure_reason(
    storage_client: Option<&std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<&str>,
    task_id: &str,
    reason: &str,
) {
    let (Some(storage_client), Some(jwt)) = (storage_client, jwt) else {
        return;
    };
    let update = aura_os_storage::UpdateTaskRequest {
        execution_notes: Some(reason.to_string()),
        ..Default::default()
    };
    if let Err(error) = storage_client.update_task(task_id, jwt, &update).await {
        warn!(%task_id, %error, "Failed to persist task failure reason");
    }
    let transition = aura_os_storage::TransitionTaskRequest {
        status: "failed".to_string(),
    };
    if let Err(error) = storage_client
        .transition_task(task_id, jwt, &transition)
        .await
    {
        warn!(
            %task_id, %error,
            "Failed to transition task to Failed after connect failure (may already be terminal)"
        );
    }
}

async fn active_instances(state: &AppState, project_id: ProjectId) -> Vec<AgentInstanceId> {
    let reg = state.automaton_registry.lock().await;
    reg.iter()
        .filter(|(_, a)| a.project_id == project_id)
        .map(|(aiid, _)| *aiid)
        .collect()
}

/// Snapshot per-agent "currently streaming" task ids for a project from
/// the in-memory automaton registry. Used by the loop status endpoints
/// to let the UI rehydrate the Run panel / per-task "live" indicators
/// after a page refresh (WS `task_started` events are not replayed).
async fn active_tasks(state: &AppState, project_id: ProjectId) -> Vec<ActiveLoopTask> {
    let reg = state.automaton_registry.lock().await;
    reg.iter()
        .filter(|(_, a)| a.project_id == project_id)
        .filter_map(|(aiid, a)| {
            a.current_task_id.as_ref().map(|tid| ActiveLoopTask {
                task_id: tid.clone(),
                agent_instance_id: *aiid,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentInstance, AgentPermissions, AgentStatus};
    use chrono::Utc;

    fn make_agent_instance(name: &str) -> AgentInstance {
        let now = Utc::now();
        AgentInstance {
            agent_instance_id: aura_os_core::AgentInstanceId::new(),
            project_id: aura_os_core::ProjectId::new(),
            agent_id: aura_os_core::AgentId::new(),
            org_id: None,
            name: name.to_string(),
            role: String::new(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: vec![],
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: "local_host".into(),
            auth_source: "aura_managed".into(),
            integration_id: None,
            default_model: None,
            workspace_path: None,
            status: AgentStatus::Idle,
            current_task_id: None,
            current_session_id: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            model: None,
            permissions: AgentPermissions::empty(),
            intent_classifier: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn extract_task_failure_context_parses_fragments_from_reason() {
        // Matches the wire format produced by
        // `StreamAccumulator::into_response` in aura-harness once all
        // three fragments are known.
        let event = serde_json::json!({
            "type": "task_failed",
            "reason":
                "stream terminated with error \
                 (model=claude-sonnet-4, msg_id=msg_01ABC, request_id=req_01XYZ): \
                 api_error: Internal server error",
        });
        let reason = extract_failure_reason(&event);
        assert!(reason.is_some());
        let ctx = extract_task_failure_context(&event, reason.as_deref());
        assert_eq!(ctx.provider_request_id.as_deref(), Some("req_01XYZ"));
        assert_eq!(ctx.model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(ctx.message_id.as_deref(), Some("msg_01ABC"));
        assert_eq!(ctx.sse_error_type.as_deref(), Some("api_error"));
        assert!(ctx.has_any());
    }

    #[test]
    fn extract_task_failure_context_prefers_structured_event_fields() {
        // Once the harness forwards `DebugEvent::LlmCall` bits on the
        // outgoing `task_failed` event, sibling fields should win over
        // any fragments we might be able to re-parse from the reason
        // string (the reason may have been amended by an infra-retry
        // wrapper like `"reset: …"`).
        let event = serde_json::json!({
            "type": "task_failed",
            "provider_request_id": "req_header_01",
            "model": "claude-opus-4",
            "sse_error_type": "overloaded_error",
            "message_id": "msg_header_01",
            "reason": "stream terminated with error \
                (model=claude-sonnet-4, msg_id=msg_ignored, request_id=req_ignored): \
                api_error: ignored",
        });
        let ctx = extract_task_failure_context(&event, Some("unused"));
        assert_eq!(ctx.provider_request_id.as_deref(), Some("req_header_01"));
        assert_eq!(ctx.model.as_deref(), Some("claude-opus-4"));
        assert_eq!(ctx.sse_error_type.as_deref(), Some("overloaded_error"));
        assert_eq!(ctx.message_id.as_deref(), Some("msg_header_01"));
    }

    #[test]
    fn extract_task_failure_context_empty_on_vanilla_reason() {
        // A garden-variety synthesized failure (e.g. "Automaton finished
        // without emitting task_completed") should yield an empty
        // context so the forwarded payload keeps its existing shape.
        let event = serde_json::json!({
            "type": "task_failed",
            "reason": "Automaton finished without emitting task_completed",
        });
        let ctx = extract_task_failure_context(&event, Some(&event["reason"].as_str().unwrap()));
        assert!(!ctx.has_any());
        assert_eq!(ctx, TaskFailureContext::default());
    }

    #[test]
    fn extract_task_failure_context_parses_partial_fragments() {
        // `StreamAccumulator::into_response` only emits the fragments it
        // actually has. A streaming error that arrived before
        // `message_start` (and therefore has no `msg_id=`) must still
        // surface `request_id=` / `model=` when present.
        let event = serde_json::json!({
            "type": "task_failed",
            "reason":
                "stream terminated with error \
                 (model=claude-sonnet-4, request_id=req_01NOMSG): \
                 api_error: upstream hung up",
        });
        let ctx = extract_task_failure_context(&event, event["reason"].as_str());
        assert_eq!(ctx.provider_request_id.as_deref(), Some("req_01NOMSG"));
        assert_eq!(ctx.model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(ctx.message_id, None);
        assert_eq!(ctx.sse_error_type.as_deref(), Some("api_error"));
    }

    #[test]
    fn extract_task_failure_context_ignores_non_snake_case_error_type() {
        // Anthropic error types are snake_case identifiers; anything
        // else (e.g. "HTTP 500", "stream timed out") must be rejected so
        // we don't persist it as `sse_error_type`.
        let event = serde_json::json!({
            "type": "task_failed",
            "reason":
                "stream terminated with error \
                 (model=claude-sonnet-4): \
                 HTTP 500: Internal Server Error",
        });
        let ctx = extract_task_failure_context(&event, event["reason"].as_str());
        assert_eq!(ctx.model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(ctx.sse_error_type, None);
    }

    #[test]
    fn task_failure_context_merge_into_only_writes_populated_fields() {
        let mut obj = serde_json::Map::new();
        let ctx = TaskFailureContext {
            provider_request_id: Some("req_01".into()),
            model: None,
            sse_error_type: Some("api_error".into()),
            message_id: None,
        };
        ctx.merge_into(&mut obj);
        assert_eq!(
            obj.get("provider_request_id").and_then(|v| v.as_str()),
            Some("req_01")
        );
        assert_eq!(
            obj.get("sse_error_type").and_then(|v| v.as_str()),
            Some("api_error")
        );
        assert!(!obj.contains_key("model"));
        assert!(!obj.contains_key("message_id"));
    }

    #[test]
    fn extracts_run_command_shell_string() {
        let event = serde_json::json!({
            "name": "run_command",
            "input": {
                "command": "npm run build"
            }
        });

        assert_eq!(
            extract_run_command(&event).as_deref(),
            Some("npm run build")
        );
    }

    #[test]
    fn extracts_run_command_program_and_args() {
        let event = serde_json::json!({
            "name": "run_command",
            "input": {
                "program": "npm",
                "args": ["run", "test"]
            }
        });

        assert_eq!(extract_run_command(&event).as_deref(), Some("npm run test"));
    }

    #[test]
    fn classifies_build_and_test_commands_from_tool_snapshots() {
        let build_event = serde_json::json!({
            "name": "run_command",
            "input": {
                "command": "npm run build"
            }
        });
        let test_event = serde_json::json!({
            "name": "run_command",
            "input": {
                "program": "npm",
                "args": ["run", "test"]
            }
        });

        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &build_event),
            vec![VerificationStepKind::Build]
        );
        assert_eq!(
            classify_run_command_steps("tool_call_completed", &test_event),
            vec![VerificationStepKind::Test]
        );
    }

    #[test]
    fn classifies_cargo_fmt_and_clippy_as_format_and_lint() {
        let fmt_event = serde_json::json!({
            "name": "run_command",
            "input": { "command": "cargo fmt --all -- --check" }
        });
        let clippy_event = serde_json::json!({
            "name": "run_command",
            "input": {
                "program": "cargo",
                "args": ["clippy", "--all-targets", "--", "-D", "warnings"]
            }
        });

        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &fmt_event),
            vec![VerificationStepKind::Format]
        );
        assert_eq!(
            classify_run_command_steps("tool_call_completed", &clippy_event),
            vec![VerificationStepKind::Lint]
        );
    }

    #[test]
    fn classifies_js_lint_and_prettier_check() {
        let eslint_event = serde_json::json!({
            "name": "run_command",
            "input": { "command": "npx eslint src --max-warnings=0" }
        });
        let prettier_event = serde_json::json!({
            "name": "run_command",
            "input": { "command": "npx prettier --check src" }
        });

        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &eslint_event),
            vec![VerificationStepKind::Lint]
        );
        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &prettier_event),
            vec![VerificationStepKind::Format]
        );
    }

    #[test]
    fn cargo_check_does_not_collide_with_clippy() {
        // `cargo check` should be Build; `cargo clippy` should be Lint.
        // The substring matcher must not confuse them because they share
        // the `cargo c` prefix.
        let check_event = serde_json::json!({
            "name": "run_command",
            "input": { "command": "cargo check --workspace" }
        });
        let clippy_event = serde_json::json!({
            "name": "run_command",
            "input": { "command": "cargo clippy --workspace" }
        });

        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &check_event),
            vec![VerificationStepKind::Build]
        );
        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &clippy_event),
            vec![VerificationStepKind::Lint]
        );
    }

    #[test]
    fn ignores_non_command_events_for_verification_steps() {
        let event = serde_json::json!({
            "name": "run_command",
            "input": {
                "command": "npm run build"
            }
        });

        assert!(classify_run_command_steps("tool_result", &event).is_empty());
        assert!(classify_run_command_steps(
            "tool_call_snapshot",
            &serde_json::json!({
                "name": "read_file",
                "input": {
                    "path": "package.json"
                }
            })
        )
        .is_empty());
    }

    #[test]
    fn treats_tool_call_snapshot_as_work() {
        assert!(is_work_event_type("tool_call_snapshot"));
    }

    #[test]
    fn maps_tool_call_snapshot_for_forwarding() {
        assert_eq!(
            map_passthrough_event_type("tool_call_snapshot"),
            Some("tool_call_snapshot")
        );
    }

    #[test]
    fn extracts_rich_turn_usage_from_assistant_message_end() {
        let event = serde_json::json!({
            "type": "assistant_message_end",
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 800,
                "estimated_context_tokens": 42000,
                "cache_creation_input_tokens": 300,
                "cache_read_input_tokens": 900,
                "cumulative_input_tokens": 5000,
                "cumulative_output_tokens": 2200,
                "cumulative_cache_creation_input_tokens": 700,
                "cumulative_cache_read_input_tokens": 1400,
                "context_utilization": 0.42,
                "model": "claude-sonnet-4-5",
                "provider": "anthropic"
            }
        });

        let usage = extract_turn_usage(&event).expect("usage should parse");
        assert_eq!(usage.input_tokens, 1200);
        assert_eq!(usage.output_tokens, 800);
        assert_eq!(usage.estimated_context_tokens, Some(42_000));
        assert_eq!(usage.cumulative_input_tokens, Some(5_000));
        assert_eq!(usage.cumulative_output_tokens, Some(2_200));
        assert_eq!(usage.context_utilization, Some(0.42));
        assert_eq!(usage.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(usage.provider.as_deref(), Some("anthropic"));
    }

    #[test]
    fn extracts_files_changed_from_assistant_message_end() {
        let event = serde_json::json!({
            "type": "assistant_message_end",
            "files_changed": {
                "created": ["src/new.rs"],
                "modified": ["src/lib.rs"],
                "deleted": ["src/old.rs"]
            }
        });

        let files = extract_files_changed(&event);
        assert_eq!(files.len(), 3);
        assert!(files
            .iter()
            .any(|file| file.op == "create" && file.path == "src/new.rs"));
        assert!(files
            .iter()
            .any(|file| file.op == "modify" && file.path == "src/lib.rs"));
        assert!(files
            .iter()
            .any(|file| file.op == "delete" && file.path == "src/old.rs"));
    }

    #[test]
    fn estimate_usage_cost_includes_cache_tokens() {
        let cost_without_cache =
            estimate_usage_cost_usd("claude-sonnet-4-5", 1_000_000, 500_000, 0, 0);
        let cost_with_cache =
            estimate_usage_cost_usd("claude-sonnet-4-5", 1_000_000, 500_000, 500_000, 1_000_000);

        assert!(cost_with_cache > cost_without_cache);
        assert!((cost_with_cache - 12.675).abs() < 1e-9);
    }

    #[test]
    fn estimate_usage_cost_matches_versioned_model_ids() {
        let exact = estimate_usage_cost_usd("claude-sonnet-4-5", 1_000_000, 0, 0, 0);
        let versioned = estimate_usage_cost_usd("claude-sonnet-4-5-20250220", 1_000_000, 0, 0, 0);

        assert!((exact - versioned).abs() < 1e-9);
        assert!((exact - 3.0).abs() < 1e-9);
    }

    #[test]
    fn prefers_agent_default_model_for_automaton_runs() {
        let mut instance = make_agent_instance("Builder");
        instance.default_model = Some("aura-gpt-4.1".to_string());
        instance.model = Some("aura-claude-sonnet-4-6".to_string());

        assert_eq!(
            preferred_automaton_model(&instance).as_deref(),
            Some("aura-gpt-4.1")
        );
    }

    #[test]
    fn falls_back_to_last_used_model_when_no_default_is_set() {
        let mut instance = make_agent_instance("Builder");
        instance.model = Some("aura-o4-mini".to_string());

        assert_eq!(
            preferred_automaton_model(&instance).as_deref(),
            Some("aura-o4-mini")
        );
    }

    #[test]
    fn requested_model_override_beats_agent_defaults() {
        let mut instance = make_agent_instance("Builder");
        instance.default_model = Some("aura-gpt-4.1".to_string());
        instance.model = Some("aura-o4-mini".to_string());

        assert_eq!(
            requested_automaton_model(Some("aura-claude-sonnet-4-6"), &instance).as_deref(),
            Some("aura-claude-sonnet-4-6")
        );
    }

    #[test]
    fn forwarder_alive_guard_clears_flag_on_drop() {
        // `start_loop`'s single-flight check depends on the `alive` flag
        // flipping to `false` as soon as the forwarder task exits, so we
        // guard it with `ForwarderAliveGuard`. Regressing the guard would
        // leave the flag `true` after the task ends and cause the next
        // start to short-circuit even though no forwarder is actually
        // running — the exact condition the registry entry is meant to
        // detect.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let alive = Arc::new(AtomicBool::new(true));
        {
            let _guard = ForwarderAliveGuard(alive.clone());
            assert!(alive.load(Ordering::SeqCst));
        }
        assert!(!alive.load(Ordering::SeqCst));
    }

    #[test]
    fn forwarder_alive_guard_clears_flag_on_panic_unwind() {
        // A panic inside the forwarder task must still clear the flag;
        // otherwise a panicked forwarder would stay "alive" forever and
        // block future start-loop calls. RAII drop covers the unwind
        // path, but exercise it explicitly so future refactors can't
        // silently regress to a manual `store(false)` at the end.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let alive = Arc::new(AtomicBool::new(true));
        let alive_inner = alive.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = ForwarderAliveGuard(alive_inner);
            panic!("simulated forwarder panic");
        }));

        assert!(result.is_err());
        assert!(!alive.load(Ordering::SeqCst));
    }

    // -------------------------------------------------------------------
    // Phase 3 — Autonomous recovery
    // -------------------------------------------------------------------

    #[test]
    fn classify_failure_detects_truncation_phrases() {
        // Phase 2b's `AutomatonError::NeedsDecomposition` `thiserror`
        // Display impl formats roughly as shown below; the classifier
        // has to recognise it both in the raw form and after the
        // harness has wrapped the reason into a longer sentence.
        let truncation_reasons = [
            "Response was truncated at the max_tokens limit",
            "Agent reached implementing stage but produced no file operations",
            "NeedsDecomposition: failed_paths=[crates/foo.rs], last_pending_tool=write_file",
            "needs_decomposition: last pending tool input was 12345 bytes",
            "Turn ended with reason max_tokens and no file ops",
            "the model was TRUNCATED mid-generation",
        ];
        for reason in truncation_reasons {
            assert_eq!(
                classify_failure(reason),
                FailureClass::Truncation,
                "expected truncation class for: {reason}"
            );
        }

        let rate_limited_reasons = [
            "rate limit exceeded (429)",
            "upstream provider returned 529",
            "Anthropic returned overloaded_error",
            "HTTP 429 Too Many Requests",
            "RateLimit reached",
        ];
        for reason in rate_limited_reasons {
            assert_eq!(
                classify_failure(reason),
                FailureClass::RateLimited,
                "expected RateLimited class for: {reason}"
            );
        }

        let other_reasons = [
            "authentication required: missing jwt",
            "agent exited unexpectedly",
            "unknown tool error",
        ];
        for reason in other_reasons {
            assert_eq!(
                classify_failure(reason),
                FailureClass::Other,
                "expected Other class for: {reason}"
            );
        }
    }

    #[test]
    fn classify_failure_is_case_insensitive() {
        assert_eq!(classify_failure("TRUNCATED"), FailureClass::Truncation);
        assert_eq!(
            classify_failure("No File Operations"),
            FailureClass::Truncation
        );
        assert_eq!(
            classify_failure("HTTP 429 TOO MANY REQUESTS"),
            FailureClass::RateLimited
        );
        assert_eq!(
            classify_failure("Provider OVERLOADED"),
            FailureClass::RateLimited
        );
    }

    #[test]
    fn rate_limit_takes_precedence_over_truncation() {
        // A 429 response body that happens to include the word
        // "truncated" should still route to the rate-limit backoff
        // path — retrying the truncation heuristic in the middle of a
        // provider rate-limit window is wasted budget.
        let reason = "Response was truncated: received HTTP 429 from upstream";
        assert_eq!(classify_failure(reason), FailureClass::RateLimited);
    }

    #[test]
    fn parse_retry_after_seconds_recognises_common_phrasings() {
        assert_eq!(
            parse_retry_after_seconds("retry after 30 seconds"),
            Some(30)
        );
        assert_eq!(parse_retry_after_seconds("retry in 45s"), Some(45));
        assert_eq!(
            parse_retry_after_seconds("try again in 12 seconds please"),
            Some(12)
        );
        assert_eq!(
            parse_retry_after_seconds("Please try again in 5 seconds"),
            Some(5)
        );
        assert_eq!(parse_retry_after_seconds("no hint here"), None);
        assert_eq!(parse_retry_after_seconds("retry after 0"), None);
    }

    #[test]
    fn extract_retry_after_prefers_structured_fields() {
        let event = serde_json::json!({
            "type": "task_failed",
            "retry_after_ms": 2500u64,
            "reason": "429 Too Many Requests (retry after 30 seconds)",
        });
        assert_eq!(
            extract_retry_after(&event),
            Some(Duration::from_millis(2500))
        );

        let event = serde_json::json!({
            "type": "task_failed",
            "retry_after": 42u64,
            "reason": "retry after 5 seconds",
        });
        assert_eq!(extract_retry_after(&event), Some(Duration::from_secs(42)));

        let event = serde_json::json!({
            "type": "task_failed",
            "headers": { "Retry-After": "17" },
            "reason": "HTTP 429",
        });
        assert_eq!(extract_retry_after(&event), Some(Duration::from_secs(17)));

        let event = serde_json::json!({
            "type": "task_failed",
            "reason": "rate limit exceeded, retry in 9 seconds",
        });
        assert_eq!(extract_retry_after(&event), Some(Duration::from_secs(9)));

        let event = serde_json::json!({
            "type": "task_failed",
            "reason": "just a generic 429",
        });
        assert_eq!(extract_retry_after(&event), None);
    }

    #[test]
    fn extract_retry_after_clamps_to_ceiling() {
        let event = serde_json::json!({
            "type": "task_failed",
            "retry_after": 10_000u64,
            "reason": "HTTP 429",
        });
        assert_eq!(
            extract_retry_after(&event),
            Some(Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS))
        );
    }

    #[test]
    fn project_cooldown_hint_raises_but_never_lowers_default() {
        // Apply a ±`JITTER_PCT`% tolerance to every comparison — the
        // cooldown path applies jitter post-escalation to de-correlate
        // retries, so exact equality no longer holds.
        fn within_jitter(actual: Duration, target: Duration) -> bool {
            let target_ms = target.as_millis() as i64;
            let actual_ms = actual.as_millis() as i64;
            let tolerance_ms = target_ms * i64::from(JITTER_PCT) / 100 + 2;
            (actual_ms - target_ms).abs() <= tolerance_ms
        }

        // Use a fresh `ProjectId` per subtest — `clear_project_cooldown`
        // only evicts an entry whose window has already expired (its
        // production contract), so reusing one id across the three
        // subtests would let the consecutive-failure counter carry
        // over and escalate every subsequent registration. Each
        // subtest below is conceptually independent.

        // Hint shorter than the class default is floored to the default
        // (minus jitter). Allow a 20% margin on the base so a
        // downward-jittered result still passes.
        let project_id = ProjectId::new();
        let short = register_project_cooldown_with_hint(
            project_id,
            InfraFailureClass::ProviderRateLimited,
            "short hint",
            Some(Duration::from_secs(1)),
        );
        let base = infra_cooldown_for(InfraFailureClass::ProviderRateLimited);
        let min_allowed =
            base.saturating_sub(Duration::from_millis(base.as_millis() as u64 * 20 / 100));
        assert!(
            short >= min_allowed,
            "expected short ≥ {min_allowed:?} (base minus jitter), got {short:?}"
        );
        clear_project_cooldown(project_id);

        // Hint longer than the class default wins, up to the cap, within
        // the ±JITTER_PCT tolerance.
        let project_id = ProjectId::new();
        let long = register_project_cooldown_with_hint(
            project_id,
            InfraFailureClass::ProviderRateLimited,
            "long hint",
            Some(Duration::from_secs(90)),
        );
        assert!(
            within_jitter(long, Duration::from_secs(90)),
            "expected ~90s ±20%, got {long:?}"
        );
        clear_project_cooldown(project_id);

        // Hint above the ceiling is clamped. The cap is enforced AFTER
        // jitter so results can never exceed it; the lower bound allows
        // for the downward jitter half of the window.
        let project_id = ProjectId::new();
        let capped = register_project_cooldown_with_hint(
            project_id,
            InfraFailureClass::ProviderRateLimited,
            "huge hint",
            Some(Duration::from_secs(10_000)),
        );
        assert!(
            capped <= Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS),
            "cooldown {capped:?} exceeded cap"
        );
        assert!(
            capped
                >= Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS)
                    .saturating_sub(Duration::from_secs(
                        PROVIDER_BACKOFF_MAX_SECS * u64::from(JITTER_PCT) / 100 + 1,
                    )),
            "cooldown {capped:?} too far below cap"
        );
        clear_project_cooldown(project_id);
    }

    #[test]
    fn classify_infra_failure_detects_provider_and_git_issues() {
        assert_eq!(
            classify_infra_failure("Anthropic 429 Too Many Requests"),
            Some(InfraFailureClass::ProviderRateLimited)
        );
        assert_eq!(
            classify_infra_failure("upstream provider returned 529 overloaded"),
            Some(InfraFailureClass::ProviderOverloaded)
        );
        assert_eq!(
            classify_infra_failure("git add -A timed out after 30s"),
            Some(InfraFailureClass::GitTimeout)
        );
        assert_eq!(
            classify_infra_failure("event stream connect timeout"),
            Some(InfraFailureClass::TransportTimeout)
        );
        assert_eq!(
            classify_infra_failure("syntax error in generated code"),
            None
        );
    }

    #[test]
    fn classify_infra_failure_detects_provider_internal_errors() {
        // The exact string this user saw: the harness wraps the
        // aura-reasoner stream-terminator as `LLM error: …`, so the
        // dev loop observes it verbatim inside the `task_failed`
        // event's reason field. Must classify as
        // `ProviderInternalError` so the auto-retry path fires.
        assert_eq!(
            classify_infra_failure(
                "LLM error: stream terminated with error: Internal server error"
            ),
            Some(InfraFailureClass::ProviderInternalError)
        );
        // Status-only variants cover the case where the classifier
        // is fed the raw HTTP error without prose.
        for reason in [
            "HTTP 500 from upstream",
            "upstream returned 502 Bad Gateway",
            "Received 503 Service Unavailable",
            "504 Gateway Timeout from Anthropic proxy",
        ] {
            assert_eq!(
                classify_infra_failure(reason),
                Some(InfraFailureClass::ProviderInternalError),
                "expected ProviderInternalError for: {reason}"
            );
        }
        // Prose-only variants (no status code) must classify too —
        // some proxies elide the numeric status.
        for reason in [
            "Internal Server Error",
            "bad gateway",
            "service unavailable, try again",
            "gateway timeout while reading response",
        ] {
            assert_eq!(
                classify_infra_failure(reason),
                Some(InfraFailureClass::ProviderInternalError),
                "expected ProviderInternalError for: {reason}"
            );
        }
        // Stream-abort variants — reasoner can surface the
        // underlying socket error without a status code when the
        // response body closes mid-flight.
        for reason in [
            "stream terminated unexpectedly",
            "stream closed prematurely",
            "connection reset by peer",
            "broken pipe while reading SSE body",
            "connection closed unexpectedly",
        ] {
            assert_eq!(
                classify_infra_failure(reason),
                Some(InfraFailureClass::ProviderInternalError),
                "expected ProviderInternalError for: {reason}"
            );
        }
    }

    #[test]
    fn classify_infra_failure_provider_internal_is_case_insensitive() {
        assert_eq!(
            classify_infra_failure("LLM ERROR: STREAM TERMINATED WITH ERROR: INTERNAL SERVER ERROR"),
            Some(InfraFailureClass::ProviderInternalError)
        );
        assert_eq!(
            classify_infra_failure("Connection Reset"),
            Some(InfraFailureClass::ProviderInternalError)
        );
    }

    #[test]
    fn classify_infra_failure_rate_limit_takes_precedence_over_5xx() {
        // When a reason happens to contain both a rate-limit marker
        // and a 5xx-like status (unusual but possible if a proxy
        // stuffs the 429 into a 502 envelope), the rate-limit class
        // must win — its cooldown is longer and the retry hint is
        // where the useful `Retry-After` lives.
        assert_eq!(
            classify_infra_failure("HTTP 502 but upstream says 429 Too Many Requests"),
            Some(InfraFailureClass::ProviderRateLimited)
        );
    }

    /// Regression for the `1.1 Create zero-core crate with newtype IDs`
    /// failure: when the harness emits a spurious `task_completed`
    /// after a provider 5xx / mid-stream abort, the completion
    /// validation gate rejects it with a synthesized "no output, no
    /// file changes, no verification evidence" reason that does NOT
    /// classify as an infra transient. Without the
    /// `last_transient_reason` breadcrumb the retry ladder would then
    /// be skipped entirely and the task would go terminal even though
    /// `classify_infra_failure` correctly recognises the underlying
    /// 5xx. This test pins the selection rule used by the gate-failure
    /// branch: prefer the tracked transient reason over the gate's
    /// own text.
    #[test]
    fn completion_gate_retry_prefers_tracked_transient_reason() {
        let gate_reason =
            "Automaton reported task_completed without output, file changes, or verification evidence";
        // No breadcrumb → classifier has nothing infra to grab onto
        // and the gate's own reason stays `None` (non-transient).
        assert_eq!(classify_infra_failure(gate_reason), None);

        // Exact reason string surfaced by aura-reasoner when an LLM
        // stream aborts mid-frame. This is what a preceding `error`
        // event captures into `last_transient_reason`.
        let transient_reason = "LLM error: stream terminated with error: Internal server error";
        assert_eq!(
            classify_infra_failure(transient_reason),
            Some(InfraFailureClass::ProviderInternalError),
        );

        // Gate-failure branch's selection: prefer tracked breadcrumb,
        // fall back to the gate reason. Mirrors the inline `match` in
        // `forward_automaton_events`' completion-gate arm.
        fn select<'a>(gate_reason: &'a str, last_transient_reason: Option<&'a str>) -> &'a str {
            last_transient_reason.unwrap_or(gate_reason)
        }
        assert_eq!(
            classify_infra_failure(select(gate_reason, Some(transient_reason))),
            Some(InfraFailureClass::ProviderInternalError),
            "with breadcrumb, gate-failure must route through ProviderInternalError retry path",
        );
        assert_eq!(
            classify_infra_failure(select(gate_reason, None)),
            None,
            "without breadcrumb, gate-failure falls through to NotClassified terminal path",
        );
    }

    #[test]
    fn provider_internal_error_has_short_cooldown() {
        // 5xx / stream aborts typically clear within seconds, so the
        // base cooldown stays short — much shorter than rate-limit
        // windows. Regression test for tuning.
        assert_eq!(
            infra_cooldown_for(InfraFailureClass::ProviderInternalError),
            Duration::from_secs(10)
        );
        assert!(
            infra_cooldown_for(InfraFailureClass::ProviderInternalError)
                < infra_cooldown_for(InfraFailureClass::ProviderRateLimited)
        );
    }

    #[test]
    fn provider_internal_error_has_stable_label() {
        // The label is written verbatim into `retries.jsonl` and
        // `loop_paused` events; keep the snake_case form stable so
        // downstream consumers can match on it.
        assert_eq!(
            infra_failure_label(InfraFailureClass::ProviderInternalError),
            "provider_internal_error"
        );
    }

    #[test]
    fn classify_infra_failure_routes_push_timeouts_separately() {
        // The exact string surfaced by the harness when `git push`
        // itself times out. Must route to `GitPushTimeout`, not
        // `GitTimeout`, because the commit already landed and the
        // task's work is done — we do not want the server to reset
        // the task to `ready` and re-run the LLM.
        assert_eq!(
            classify_infra_failure("git push orbit HEAD:main: timed out after 60s"),
            Some(InfraFailureClass::GitPushTimeout)
        );
        // Pre-commit operations keep the retry semantics.
        assert_eq!(
            classify_infra_failure("git add -A timed out after 30s"),
            Some(InfraFailureClass::GitTimeout)
        );
        assert_eq!(
            classify_infra_failure("git commit timed out"),
            Some(InfraFailureClass::GitTimeout)
        );
        // Harness-side push wrappers also classify as push timeouts
        // so their failure strings are handled the same way.
        assert_eq!(
            classify_infra_failure("Commit+push failed: git push timed out after 60s"),
            Some(InfraFailureClass::GitPushTimeout)
        );
        assert_eq!(
            classify_infra_failure("orbit_push timed out after 120s"),
            Some(InfraFailureClass::GitPushTimeout)
        );
    }

    #[test]
    fn retry_context_budget_counts_down() {
        let start_params = AutomatonStartParams {
            project_id: ProjectId::new().to_string(),
            auth_token: None,
            model: None,
            workspace_root: None,
            task_id: None,
            git_repo_url: None,
            git_branch: None,
            installed_tools: None,
            installed_integrations: None,
            prior_failure: None,
            work_log: Vec::new(),
        };
        let client = std::sync::Arc::new(aura_os_link::AutomatonClient::new("http://127.0.0.1:1"));
        let mut retry = Some(TransientRetryContext {
            automaton_client: client,
            start_params,
            restart_budget: Some(2),
        });
        assert!(take_retry_context(&mut retry).is_some());
        assert!(take_retry_context(&mut retry).is_some());
        assert!(take_retry_context(&mut retry).is_none());
    }

    /// The single-task retry flow pins its restart budget to a value
    /// greater than 1 so a single transient provider 500 (classified
    /// as `ProviderInternalError`) does not terminally fail a user's
    /// "Retry" click. See `SINGLE_TASK_RESTART_BUDGET` for rationale.
    #[test]
    fn single_task_restart_budget_allows_more_than_one_retry() {
        assert!(
            SINGLE_TASK_RESTART_BUDGET >= 2,
            "single-task retry must survive at least one mid-stream provider blip; got {}",
            SINGLE_TASK_RESTART_BUDGET
        );
        let start_params = AutomatonStartParams {
            project_id: ProjectId::new().to_string(),
            auth_token: None,
            model: None,
            workspace_root: None,
            task_id: None,
            git_repo_url: None,
            git_branch: None,
            installed_tools: None,
            installed_integrations: None,
            prior_failure: None,
            work_log: Vec::new(),
        };
        let client = std::sync::Arc::new(aura_os_link::AutomatonClient::new("http://127.0.0.1:1"));
        let mut retry = Some(TransientRetryContext {
            automaton_client: client,
            start_params,
            restart_budget: Some(SINGLE_TASK_RESTART_BUDGET),
        });
        for _ in 0..SINGLE_TASK_RESTART_BUDGET {
            assert!(
                take_retry_context(&mut retry).is_some(),
                "restart budget exhausted before allowance"
            );
        }
        assert!(
            take_retry_context(&mut retry).is_none(),
            "restart budget must be bounded"
        );
    }

    #[test]
    fn project_cooldown_prefers_longer_existing_window() {
        let project_id = ProjectId::new();
        let first =
            register_project_cooldown(project_id, InfraFailureClass::ProviderRateLimited, "429");
        let second = register_project_cooldown(project_id, InfraFailureClass::GitTimeout, "git");
        assert!(second >= first.saturating_sub(Duration::from_secs(1)));
        let active = active_project_cooldown(project_id).expect("cooldown should be active");
        assert_eq!(active.1, InfraFailureClass::GitTimeout);
        clear_project_cooldown(project_id);
    }

    /// `apply_jitter` keeps results inside the declared ±JITTER_PCT band
    /// across many samples. The PRNG source is the system clock's
    /// subsecond nanos — good enough to de-synchronize retries across
    /// a fleet but not cryptographically random — so we verify the
    /// *bounds*, not a uniform distribution.
    #[test]
    fn apply_jitter_stays_within_declared_band() {
        let base = Duration::from_secs(30);
        let band_ms = base.as_millis() as u64 * u64::from(JITTER_PCT) / 100;
        let lo = base.as_millis() as u64 - band_ms;
        let hi = base.as_millis() as u64 + band_ms;
        for _ in 0..256 {
            let jittered = apply_jitter(base).as_millis() as u64;
            assert!(
                jittered >= lo,
                "jittered {jittered}ms fell below {lo}ms for base {base:?}"
            );
            assert!(
                jittered <= hi,
                "jittered {jittered}ms exceeded {hi}ms for base {base:?}"
            );
        }
    }

    /// Edge cases — zero in, zero out (no escalation of nothing), and
    /// very small bases don't underflow to 0ms.
    #[test]
    fn apply_jitter_handles_zero_and_tiny_bases() {
        assert_eq!(apply_jitter(Duration::ZERO), Duration::ZERO);
        for _ in 0..32 {
            let j = apply_jitter(Duration::from_millis(1));
            assert!(!j.is_zero(), "1ms base must never jitter down to zero");
        }
    }

    /// `escalate` doubles with each consecutive hit up to
    /// `ESCALATION_CAP`, then flattens. Counts of 0 and 1 are identity.
    #[test]
    fn escalate_doubles_up_to_cap() {
        let base = Duration::from_secs(10);
        assert_eq!(escalate(base, 0), base);
        assert_eq!(escalate(base, 1), base);
        assert_eq!(escalate(base, 2), Duration::from_secs(20));
        assert_eq!(escalate(base, 3), Duration::from_secs(40));
        assert_eq!(escalate(base, 4), Duration::from_secs(80));
        // Count=5 would give 16x = 160s but ESCALATION_CAP (8) caps it
        // at 80s, and then PROVIDER_BACKOFF_MAX_SECS caps that below
        // the ceiling. Both invariants checked.
        let capped = escalate(base, 5);
        assert!(capped <= Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS));
        assert!(capped >= Duration::from_secs(80));
        // Count high enough to saturate never panics.
        let _ = escalate(base, u32::MAX);
    }

    /// The cooldown registration path escalates in real time: each
    /// consecutive hit of the same class produces a strictly longer
    /// (pre-jitter) window than the prior one, up to the cap. We check
    /// monotonicity with a generous tolerance because jitter can push
    /// a later sample slightly below an earlier one in rare cases.
    #[test]
    fn register_project_cooldown_escalates_on_consecutive_failures() {
        let project_id = ProjectId::new();
        let base = infra_cooldown_for(InfraFailureClass::ProviderInternalError);
        let tolerance = Duration::from_millis(base.as_millis() as u64 * 40 / 100);

        let first = register_project_cooldown(
            project_id,
            InfraFailureClass::ProviderInternalError,
            "first 5xx",
        );
        // Force the existing entry to expire so the next registration
        // doesn't see `remaining >= requested` and return the old
        // window. Without this the longest-window-wins path hides the
        // escalation effect in a quick test.
        {
            let mut g = project_cooldowns().lock().unwrap();
            if let Some(c) = g.get_mut(&project_id.to_string()) {
                c.until = Instant::now();
            }
        }
        let second = register_project_cooldown(
            project_id,
            InfraFailureClass::ProviderInternalError,
            "second 5xx",
        );
        // Second registration should be at least 2x base minus jitter.
        let expected_second = escalate(base, 2);
        assert!(
            second + tolerance >= expected_second,
            "second {second:?} should be near {expected_second:?}"
        );
        assert!(
            second + tolerance >= first,
            "escalation never decreases (second {second:?} vs first {first:?})"
        );
        clear_project_cooldown(project_id);
    }

    /// A different failure class resets the consecutive counter — the
    /// underlying assumption is that classes are independent problems,
    /// so four 5xx's shouldn't punish a subsequent git timeout.
    #[test]
    fn consecutive_counter_resets_when_class_changes() {
        let project_id = ProjectId::new();
        // Build up a short streak of internal errors.
        for _ in 0..3 {
            register_project_cooldown(
                project_id,
                InfraFailureClass::ProviderInternalError,
                "5xx",
            );
            // Expire the window so the next call doesn't short-circuit
            // on the longer-remaining-wins branch.
            let mut g = project_cooldowns().lock().unwrap();
            if let Some(c) = g.get_mut(&project_id.to_string()) {
                c.until = Instant::now();
            }
        }
        // Now a DIFFERENT class fires. Its cooldown should sit near
        // that class's base (not escalated from the prior streak).
        let git = register_project_cooldown(project_id, InfraFailureClass::GitTimeout, "git");
        let git_base = infra_cooldown_for(InfraFailureClass::GitTimeout);
        // +20% jitter allowed + 1 unit escalation (count starts at 1).
        let max_allowed =
            git_base + Duration::from_millis(git_base.as_millis() as u64 * 25 / 100);
        assert!(
            git <= max_allowed,
            "git cooldown {git:?} was higher than single-hit bound {max_allowed:?}; counter did not reset on class change"
        );
        clear_project_cooldown(project_id);
    }

    #[test]
    fn completion_validation_requires_some_execution_evidence() {
        let empty = CachedTaskOutput::default();
        assert_eq!(
            completion_validation_failure_reason(&empty),
            Some(
                "Automaton reported task_completed without output, file changes, or verification evidence"
            )
        );

        let with_output = CachedTaskOutput {
            live_output: "done".to_string(),
            ..Default::default()
        };
        assert_eq!(completion_validation_failure_reason(&with_output), None);
    }

    #[test]
    fn latest_git_commit_sha_extracts_sha_after_push_failure() {
        // Regression: when the completion gate emits a rollback event
        // it needs the SHA of whichever commit was reported last, even
        // if a later step (e.g. `git_push_failed`) didn't carry one.
        let steps = vec![
            serde_json::json!({"type": "git_committed", "commit_sha": "deadbeef"}),
            serde_json::json!({"type": "git_push_failed", "reason": "net down"}),
        ];
        assert_eq!(latest_git_commit_sha(&steps).as_deref(), Some("deadbeef"));
    }

    #[test]
    fn completion_validation_rejects_any_empty_path_write() {
        let mut cached = CachedTaskOutput {
            live_output: "looked busy".to_string(),
            files_changed: vec![modify_summary("src/lib.rs")],
            build_steps: vec![serde_json::json!({"type": "build_verification_passed"})],
            test_steps: vec![serde_json::json!({"type": "test_verification_passed"})],
            format_steps: vec![serde_json::json!({"type": "format_verification_passed"})],
            lint_steps: vec![serde_json::json!({"type": "lint_verification_passed"})],
            empty_path_writes: 1,
            ..Default::default()
        };
        let reason =
            completion_validation_failure_reason(&cached).expect("gate should fire on empty paths");
        assert!(
            reason.contains("empty or missing \"path\""),
            "expected empty-path reason, got: {reason}"
        );
        cached.empty_path_writes = 0;
        assert_eq!(completion_validation_failure_reason(&cached), None);
    }

    #[test]
    fn is_empty_path_write_event_detects_missing_and_whitespace_paths() {
        let missing_path = serde_json::json!({
            "name": "write_file",
            "input": {"content": "hi"},
        });
        assert!(is_empty_path_write_event("tool_call_snapshot", &missing_path));

        let empty_path = serde_json::json!({
            "name": "edit_file",
            "input": {"path": ""},
        });
        assert!(is_empty_path_write_event("tool_call_started", &empty_path));

        let whitespace_path = serde_json::json!({
            "name": "write_file",
            "input": {"path": "   \t"},
        });
        assert!(is_empty_path_write_event(
            "tool_call_completed",
            &whitespace_path
        ));

        let good_path = serde_json::json!({
            "name": "write_file",
            "input": {"path": "src/lib.rs"},
        });
        assert!(!is_empty_path_write_event("tool_call_snapshot", &good_path));

        let unrelated_tool = serde_json::json!({
            "name": "read_file",
            "input": {"path": ""},
        });
        assert!(!is_empty_path_write_event(
            "tool_call_snapshot",
            &unrelated_tool
        ));

        let unrelated_event = serde_json::json!({
            "name": "write_file",
            "input": {"path": ""},
        });
        assert!(!is_empty_path_write_event("text_delta", &unrelated_event));
    }

    #[test]
    fn extract_files_changed_skips_empty_paths() {
        let event = serde_json::json!({
            "files_changed": {
                "created": ["src/lib.rs", "", "   "],
                "modified": ["\t"],
                "deleted": ["docs/old.md"],
            }
        });
        let summaries = extract_files_changed(&event);
        let paths: Vec<&str> = summaries.iter().map(|s| s.path.as_str()).collect();
        assert_eq!(paths, vec!["src/lib.rs", "docs/old.md"]);
    }

    fn preflight_error_message(err: (axum::http::StatusCode, axum::Json<ApiError>)) -> String {
        err.1 .0.error.clone()
    }

    #[test]
    fn preflight_local_workspace_rejects_empty_dir_without_git_url() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().to_string_lossy().into_owned();
        let err = preflight_local_workspace(HarnessMode::Local, &path, None)
            .expect_err("empty workspace without git_repo_url should be rejected");
        let msg = preflight_error_message(err);
        assert!(
            msg.contains("not a git repository"),
            "expected not-a-git-repo message, got: {msg}"
        );
    }

    #[test]
    fn preflight_local_workspace_tolerates_empty_dir_with_git_url() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().to_string_lossy().into_owned();
        preflight_local_workspace(
            HarnessMode::Local,
            &path,
            Some("https://example.com/org/repo.git"),
        )
        .expect("empty workspace with git_repo_url should be tolerated; automaton clones on first run");
    }

    #[test]
    fn preflight_local_workspace_rejects_missing_path_even_with_git_url() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing = temp_dir
            .path()
            .join("never-created")
            .to_string_lossy()
            .into_owned();
        let err = preflight_local_workspace(
            HarnessMode::Local,
            &missing,
            Some("https://example.com/org/repo.git"),
        )
        .expect_err("a non-existent workspace path cannot be rescued by git_repo_url");
        let msg = preflight_error_message(err);
        assert!(
            msg.contains("does not exist"),
            "expected missing-path message, got: {msg}"
        );
    }

    #[test]
    fn preflight_local_workspace_skipped_in_swarm_mode() {
        preflight_local_workspace(HarnessMode::Swarm, "/nonexistent/remote/path", None)
            .expect("swarm mode should skip local preflight");
    }

    #[test]
    fn preflight_local_workspace_rejects_empty_path_string() {
        let err = preflight_local_workspace(HarnessMode::Local, "", None)
            .expect_err("empty string should be rejected");
        let msg = preflight_error_message(err);
        assert!(msg.contains("workspace path is empty"));
    }

    fn modify_summary(path: &str) -> StorageTaskFileChangeSummary {
        StorageTaskFileChangeSummary {
            op: "modify".into(),
            path: path.into(),
            lines_added: 0,
            lines_removed: 0,
        }
    }

    #[test]
    fn latest_git_commit_sha_reads_most_recent_commit_event() {
        let steps = vec![
            serde_json::json!({"type": "git_committed", "commit_sha": "11111111"}),
            serde_json::json!({"type": "git_push_failed", "reason": "timeout"}),
            serde_json::json!({"type": "git_committed", "commit_sha": "22222222"}),
        ];
        assert_eq!(latest_git_commit_sha(&steps).as_deref(), Some("22222222"));
    }

    #[test]
    fn derive_task_sync_state_marks_push_failures_for_reconciliation() {
        let checkpoints = vec![
            TaskSyncCheckpoint {
                kind: "task_started".into(),
                phase: Some("executing".into()),
                ..Default::default()
            },
            TaskSyncCheckpoint {
                kind: "git_committed".into(),
                phase: Some("committed".into()),
                commit_sha: Some("abc123".into()),
                branch: Some("main".into()),
                ..Default::default()
            },
            TaskSyncCheckpoint {
                kind: "git_push_failed".into(),
                phase: Some("push_failed".into()),
                reason: Some("timed out".into()),
                ..Default::default()
            },
        ];

        let state =
            derive_sync_state_from_checkpoints(&checkpoints).expect("state should be derived");
        assert_eq!(state.phase.as_deref(), Some("push_failed"));
        assert_eq!(state.last_commit_sha.as_deref(), Some("abc123"));
        assert_eq!(state.orphaned_commits, vec!["abc123".to_string()]);
        assert!(state.needs_reconciliation);
    }

    #[test]
    fn derive_task_sync_state_clears_orphan_after_push() {
        let checkpoints = vec![
            TaskSyncCheckpoint {
                kind: "git_committed".into(),
                phase: Some("committed".into()),
                commit_sha: Some("abc123".into()),
                ..Default::default()
            },
            TaskSyncCheckpoint {
                kind: "git_pushed".into(),
                phase: Some("pushed".into()),
                commit_sha: Some("abc123".into()),
                branch: Some("main".into()),
                repo: Some("origin".into()),
                ..Default::default()
            },
        ];

        let state =
            derive_sync_state_from_checkpoints(&checkpoints).expect("state should be derived");
        assert_eq!(state.phase.as_deref(), Some("pushed"));
        assert!(state.orphaned_commits.is_empty());
        assert!(!state.needs_reconciliation);
        assert_eq!(state.repo.as_deref(), Some("origin"));
    }

    #[test]
    fn classify_infra_failure_prefers_git_push_timeout_over_git_timeout() {
        let reason = "git_commit_push timed out while waiting for git push to origin";
        assert_eq!(
            classify_infra_failure(reason),
            Some(InfraFailureClass::GitPushTimeout)
        );
        assert_ne!(classify_failure(reason), FailureClass::Truncation);
    }

    #[test]
    fn completion_validation_blocks_code_changes_without_build() {
        // Modifying code without any build/compile step violates the
        // Definition of Done: the agent cannot prove the change
        // compiles.
        let cached = CachedTaskOutput {
            live_output: "edited files".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            ..Default::default()
        };
        let reason = completion_validation_failure_reason(&cached).expect("gate should fire");
        assert!(
            reason.contains("no build/compile step"),
            "expected build-step reason, got: {reason}"
        );
    }

    #[test]
    fn completion_validation_blocks_code_changes_without_tests() {
        // Build evidence is present but no test step — still must fail
        // per Definition of Done.
        let cached = CachedTaskOutput {
            live_output: "compiled".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            build_steps: vec![serde_json::json!({"type": "build_verification_passed"})],
            ..Default::default()
        };
        let reason = completion_validation_failure_reason(&cached).expect("gate should fire");
        assert!(
            reason.contains("no test step"),
            "expected test-step reason, got: {reason}"
        );
    }

    #[test]
    fn completion_validation_blocks_rust_changes_without_format() {
        // Rust change with build + test but no `cargo fmt --check` must
        // fail the Rust-strict tier of the Definition of Done.
        let cached = CachedTaskOutput {
            live_output: "ran build+test but skipped formatter".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            build_steps: vec![serde_json::json!({"type": "build_verification_passed"})],
            test_steps: vec![serde_json::json!({"type": "test_verification_passed"})],
            ..Default::default()
        };
        let reason = completion_validation_failure_reason(&cached).expect("gate should fire");
        assert!(
            reason.contains("no format check"),
            "expected format-step reason, got: {reason}"
        );
    }

    #[test]
    fn completion_validation_blocks_rust_changes_without_lint() {
        // Rust change with build + test + fmt but no clippy must still
        // fail: the four-gate DoD requires lint evidence for Rust.
        let cached = CachedTaskOutput {
            live_output: "ran build+test+fmt but skipped clippy".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            build_steps: vec![serde_json::json!({"type": "build_verification_passed"})],
            test_steps: vec![serde_json::json!({"type": "test_verification_passed"})],
            format_steps: vec![serde_json::json!({"type": "format_verification_passed"})],
            ..Default::default()
        };
        let reason = completion_validation_failure_reason(&cached).expect("gate should fire");
        assert!(
            reason.contains("no lint check"),
            "expected lint-step reason, got: {reason}"
        );
    }

    #[test]
    fn completion_validation_passes_rust_changes_with_full_four_gate() {
        // build + test + fmt + clippy evidence for a Rust change is
        // exactly what the Definition of Done asks for.
        let cached = CachedTaskOutput {
            live_output: "all green".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            build_steps: vec![serde_json::json!({"type": "build_verification_passed"})],
            test_steps: vec![serde_json::json!({"type": "test_verification_passed"})],
            format_steps: vec![serde_json::json!({"type": "format_verification_passed"})],
            lint_steps: vec![serde_json::json!({"type": "lint_verification_passed"})],
            ..Default::default()
        };
        assert_eq!(completion_validation_failure_reason(&cached), None);
    }

    #[test]
    fn completion_validation_passes_non_rust_source_with_build_and_test() {
        // Non-Rust source (TypeScript here) currently only needs
        // build + test evidence. We'll tighten this once the harness
        // reliably emits fmt/lint evidence for JS/TS tasks; for now
        // the looser rule prevents legitimate pnpm-only projects from
        // false-failing the gate.
        let cached = CachedTaskOutput {
            live_output: "tsc + vitest green".into(),
            files_changed: vec![modify_summary("apps/web/src/app.ts")],
            build_steps: vec![serde_json::json!({"type": "build_verification_passed"})],
            test_steps: vec![serde_json::json!({"type": "test_verification_passed"})],
            ..Default::default()
        };
        assert_eq!(completion_validation_failure_reason(&cached), None);
    }

    #[test]
    fn completion_validation_allows_docs_only_changes_without_verification() {
        // Editing a README should not require `cargo build` / `cargo
        // test` to pass the gate — there's no source to build.
        let cached = CachedTaskOutput {
            live_output: "updated README".into(),
            files_changed: vec![
                modify_summary("README.md"),
                modify_summary("docs/spec.md"),
                modify_summary(".gitignore"),
            ],
            ..Default::default()
        };
        assert_eq!(completion_validation_failure_reason(&cached), None);
    }

    #[test]
    fn completion_validation_allows_output_only_tasks() {
        // Analysis / status / review tasks that produce no code change
        // still complete on the loose baseline check. We deliberately
        // do not block them for lacking build/test evidence.
        let cached = CachedTaskOutput {
            live_output: "Summary: nothing to change.".into(),
            ..Default::default()
        };
        assert_eq!(completion_validation_failure_reason(&cached), None);
    }

    #[test]
    fn classify_changed_paths_distinguishes_rust_from_docs() {
        let only_docs = vec![modify_summary("README.md"), modify_summary("CHANGELOG.md")];
        let c = classify_changed_paths(&only_docs);
        assert!(
            !c.has_source && !c.has_rust,
            "docs-only must not be classified as source"
        );

        let rust = vec![modify_summary("crates/aura-os-core/src/lib.rs")];
        let c = classify_changed_paths(&rust);
        assert!(c.has_rust && c.has_source, "*.rs must be Rust source");

        let ts = vec![modify_summary("apps/web/src/main.tsx")];
        let c = classify_changed_paths(&ts);
        assert!(
            c.has_source && !c.has_rust,
            "*.tsx must be source but not Rust"
        );

        let mixed = vec![
            modify_summary("README.md"),
            modify_summary("crates/foo/src/lib.rs"),
        ];
        let c = classify_changed_paths(&mixed);
        assert!(
            c.has_rust && c.has_source,
            "mixed set must see the Rust file"
        );

        let cargo_lock = vec![modify_summary("Cargo.lock")];
        let c = classify_changed_paths(&cargo_lock);
        assert!(
            !c.has_rust && !c.has_source,
            "Cargo.lock alone must not force the Rust gate"
        );
    }

    #[test]
    fn completion_gate_report_snapshots_all_inputs() {
        let cached = CachedTaskOutput {
            live_output: "hello".into(),
            files_changed: vec![modify_summary("src/lib.rs"), modify_summary("README.md")],
            build_steps: vec![serde_json::json!({"ok": true})],
            test_steps: vec![serde_json::json!({"ok": true})],
            format_steps: vec![],
            lint_steps: vec![],
            ..Default::default()
        };
        let report = CompletionGateReport::from_cached(&cached);
        assert!(report.had_live_output);
        assert_eq!(report.n_files_changed, 2);
        assert!(report.has_source_change);
        assert!(report.has_rust_change);
        assert_eq!(report.n_build_steps, 1);
        assert_eq!(report.n_test_steps, 1);
        assert_eq!(report.n_format_steps, 0);
        assert_eq!(report.n_lint_steps, 0);
        assert_eq!(report.recovery_checkpoint, "workspace_changed");
        // The report itself doesn't run the gate — failure_reason is
        // populated by the caller using
        // `completion_validation_failure_reason`.
        assert!(report.failure_reason.is_none());
    }

    #[test]
    fn recovery_checkpoint_distinguishes_workspace_commit_and_remote_sync() {
        let output_only = CachedTaskOutput {
            live_output: "looked into it".into(),
            ..Default::default()
        };
        assert_eq!(
            recovery_checkpoint(&output_only),
            RecoveryCheckpoint::OutputObserved
        );

        let workspace = CachedTaskOutput {
            live_output: "edited files".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            ..Default::default()
        };
        assert_eq!(
            recovery_checkpoint(&workspace),
            RecoveryCheckpoint::WorkspaceChanged
        );

        let committed = CachedTaskOutput {
            live_output: "committed".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            git_steps: vec![
                serde_json::json!({"type": "git_committed", "commit_sha": "abc123"}),
                serde_json::json!({"type": "git_push_failed", "reason": "timeout"}),
            ],
            ..Default::default()
        };
        assert_eq!(
            recovery_checkpoint(&committed),
            RecoveryCheckpoint::CommitCreated
        );

        let pushed = CachedTaskOutput {
            live_output: "pushed".into(),
            files_changed: vec![modify_summary("src/lib.rs")],
            git_steps: vec![
                serde_json::json!({"type": "git_committed", "commit_sha": "abc123"}),
                serde_json::json!({"type": "git_pushed", "remote": "origin"}),
            ],
            ..Default::default()
        };
        assert_eq!(
            recovery_checkpoint(&pushed),
            RecoveryCheckpoint::RemoteSynced
        );
    }

    #[test]
    fn auto_decompose_env_flag_parses_truthy_values() {
        use super::auto_decompose_disabled;
        // Serialise env-var mutation behind a local mutex: `std::env`
        // is process-wide so two tests touching the same key in
        // parallel would clobber each other and flake.
        use std::sync::Mutex;
        static ENV_LOCK: Mutex<()> = Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

        std::env::remove_var("AURA_AUTO_DECOMPOSE_DISABLED");
        assert!(!auto_decompose_disabled(), "unset should return false");

        for value in ["1", "true", "TRUE", "Yes", "on"] {
            std::env::set_var("AURA_AUTO_DECOMPOSE_DISABLED", value);
            assert!(
                auto_decompose_disabled(),
                "value {value} should disable auto-decompose"
            );
        }

        for value in ["0", "false", "no", "", "off"] {
            std::env::set_var("AURA_AUTO_DECOMPOSE_DISABLED", value);
            assert!(
                !auto_decompose_disabled(),
                "value {value:?} should not disable auto-decompose"
            );
        }

        std::env::remove_var("AURA_AUTO_DECOMPOSE_DISABLED");
    }

    #[test]
    fn remediation_retry_counter_respects_budget() {
        use super::{bump_remediation_count, current_remediation_count, MAX_RETRIES_PER_TASK};
        // Unique task id so the shared in-process counter doesn't clash
        // with other tests running in parallel.
        let tid = format!("test-task-{}", aura_os_core::TaskId::new());

        assert_eq!(current_remediation_count(&tid), 0);
        for expected in 1..=MAX_RETRIES_PER_TASK {
            let after = bump_remediation_count(&tid);
            assert_eq!(after, expected);
        }
        // The budget check in `try_remediate_task_failure` compares
        // `current >= MAX`, which is already true here — a real caller
        // would short-circuit before bumping again. Verify the reader
        // reflects the final value.
        assert_eq!(current_remediation_count(&tid), MAX_RETRIES_PER_TASK);
    }

    #[test]
    fn retry_attempt_counter_bumps_and_clears() {
        use super::{bump_retry_attempt, clear_retry_attempt};
        // Unique id so the shared counter doesn't collide with
        // parallel tests.
        let tid = format!("test-retry-{}", aura_os_core::TaskId::new());
        assert_eq!(bump_retry_attempt(&tid), 1);
        assert_eq!(bump_retry_attempt(&tid), 2);
        assert_eq!(bump_retry_attempt(&tid), 3);
        clear_retry_attempt(&tid);
        // After clearing, the next bump resets to 1 so a fresh
        // manual retry of the same task id starts the ladder over
        // instead of inheriting the stale count.
        assert_eq!(bump_retry_attempt(&tid), 1);
        clear_retry_attempt(&tid);
    }

    #[test]
    fn retry_preamble_fixed_shape_and_attempt_number() {
        use super::build_retry_preamble;
        let p = build_retry_preamble(2, "LLM error: stream terminated with error: 500");
        assert!(p.starts_with("[aura-retry attempt=2]"), "got {p:?}");
        assert!(p.contains("stream terminated"), "got {p:?}");
        assert!(
            p.contains("Continue from where you left off"),
            "preamble must carry the resume instruction: {p:?}"
        );
    }

    #[test]
    fn retry_preamble_truncates_long_reasons_with_ellipsis() {
        use super::{build_retry_preamble, RETRY_PREAMBLE_REASON_BUDGET};
        let long = "a".repeat(RETRY_PREAMBLE_REASON_BUDGET + 500);
        let p = build_retry_preamble(3, &long);
        assert!(
            p.contains('…'),
            "long reason must be marked with ellipsis: {p:?}"
        );
        // Ensure we never carry the whole oversized blob forward —
        // the budget exists specifically so the preamble can't blow
        // up the next turn's prompt.
        let body = p.split(": ").nth(2).unwrap_or("");
        assert!(
            body.len() <= RETRY_PREAMBLE_REASON_BUDGET + "…".len() + 100,
            "preamble body ({} bytes) should be bounded by the budget: {p:?}",
            body.len(),
        );
    }

    #[test]
    fn retry_preamble_collapses_control_chars() {
        use super::build_retry_preamble;
        let raw = "line one\nline two\r\nline three";
        let p = build_retry_preamble(2, raw);
        assert!(
            !p.contains('\n') && !p.contains('\r'),
            "preamble must flatten newlines so the two-line shape stays stable: {p:?}"
        );
        assert!(p.contains("line one"), "got {p:?}");
        assert!(p.contains("line three"), "got {p:?}");
    }

    #[test]
    fn retry_preamble_clamps_zero_attempt_to_one() {
        use super::build_retry_preamble;
        // Callers must not pass 0 but the function must still produce
        // parseable output — regressing this would break UI parsing
        // that expects a numeric attempt.
        let p = build_retry_preamble(0, "boom");
        assert!(p.starts_with("[aura-retry attempt=1]"), "got {p:?}");
    }

    /// `resolve_start_conflict` decides whether to stop-and-retry or adopt
    /// based solely on `automaton_is_active`, so its correctness for
    /// infra-retry recovery reduces to these cases: schemas we know are
    /// terminal must be reported as inactive (so we stop and retry), and
    /// anything unknown or explicitly running must be reported as active
    /// (so we adopt instead of starting a second automaton). These
    /// expectations match the stale/adopt branches in `start_loop`.
    #[test]
    fn automaton_is_active_recognises_terminal_states() {
        for state in [
            "done",
            "stopped",
            "finished",
            "failed",
            "cancelled",
            "terminated",
            "completed",
        ] {
            let v = serde_json::json!({ "state": state });
            assert!(
                !automaton_is_active(&v),
                "{state} must be treated as terminal so conflict recovery stops-and-retries"
            );
        }
    }

    #[test]
    fn automaton_is_active_treats_live_and_unknown_as_active() {
        for state in ["running", "active", "started", "paused"] {
            let v = serde_json::json!({ "state": state });
            assert!(automaton_is_active(&v), "{state} must be treated as live");
        }
        // Unknown schema keeps us on the safe side: adopt rather than
        // accidentally stopping a still-running automaton.
        let unknown = serde_json::json!({ "state": "bootstrapping" });
        assert!(automaton_is_active(&unknown));
        let running_bool = serde_json::json!({ "running": true });
        assert!(automaton_is_active(&running_bool));
        let not_running = serde_json::json!({ "running": false });
        assert!(!automaton_is_active(&not_running));
    }

    /// When `reset_task_for_infra_retry` has already flipped the task
    /// from `in_progress` → `ready` but the subsequent restart failed,
    /// transitioning directly to `failed` is illegal in aura-storage.
    /// The terminal-failure handler bridges through `in_progress`; the
    /// transition matrix below is what makes that bridge valid.
    #[test]
    fn ready_to_failed_requires_bridging_via_in_progress() {
        use aura_os_core::TaskStatus;
        use aura_os_tasks::TaskService;

        assert!(
            TaskService::validate_transition(TaskStatus::Ready, TaskStatus::Failed).is_err(),
            "ready -> failed must remain illegal so the bridge code path keeps being exercised"
        );
        assert!(
            TaskService::validate_transition(TaskStatus::Ready, TaskStatus::InProgress).is_ok(),
            "bridge step 1 (ready -> in_progress) must be legal"
        );
        assert!(
            TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Failed).is_ok(),
            "bridge step 2 (in_progress -> failed) must be legal"
        );
    }
}
