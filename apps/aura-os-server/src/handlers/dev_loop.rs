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

use super::projects_helpers::resolve_agent_instance_workspace_path;
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
    if lower.contains("timed out") || lower.contains("timeout") {
        return Some(InfraFailureClass::TransportTimeout);
    }
    None
}

fn infra_cooldown_for(class: InfraFailureClass) -> Duration {
    match class {
        InfraFailureClass::ProviderRateLimited => Duration::from_secs(60),
        InfraFailureClass::ProviderOverloaded => Duration::from_secs(30),
        InfraFailureClass::TransportTimeout => Duration::from_secs(20),
        InfraFailureClass::GitTimeout => Duration::from_secs(15),
        // `GitPushTimeout` never takes the pause-and-restart path, so
        // the cooldown is unused. Keep a small sentinel here so the
        // match remains exhaustive without implying a real backoff.
        InfraFailureClass::GitPushTimeout => Duration::from_secs(0),
    }
}

fn infra_failure_label(class: InfraFailureClass) -> &'static str {
    match class {
        InfraFailureClass::ProviderRateLimited => "provider_rate_limited",
        InfraFailureClass::ProviderOverloaded => "provider_overloaded",
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
    let requested = hint.map(|h| h.min(cap).max(default)).unwrap_or(default);
    let mut guard = match project_cooldowns().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(existing) = guard.get_mut(&key) {
        let remaining = existing.until.saturating_duration_since(Instant::now());
        if remaining >= requested {
            existing.reason = reason.to_string();
            existing.class = class;
            return remaining;
        }
    }
    guard.insert(
        key,
        ProjectCooldown {
            until: Instant::now() + requested,
            class,
            reason: reason.to_string(),
        },
    );
    requested
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
/// 1. **Baseline activity** — rejects runs with no live output, no file
///    changes, and no verification steps. Catches automatons that claim
///    success after doing nothing.
/// 2. **Source-change evidence** — if the task modified a file with a
///    recognised source extension (`*.rs`, `*.ts`, `*.py`, etc.), the
///    run must include at least one build step and one test step. Docs
///    or config-only changes (`*.md`, `*.toml`, `*.yaml`, etc.) skip
///    this check since `cargo build` / `cargo test` would be nonsense
///    for them.
/// 3. **Rust-strict evidence** — if the task modified any `*.rs` file,
///    the run must additionally include a format step and a lint step
///    (e.g. `cargo fmt --check` and `cargo clippy`). This is the full
///    four-gate Definition of Done. Non-Rust source languages don't
///    currently get this treatment; we'll add them once the harness
///    reliably emits format/lint evidence for them.
fn completion_validation_failure_reason(cached: &CachedTaskOutput) -> Option<&'static str> {
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

    // Build a path -> (lines_added, lines_removed) lookup from the protocol's
    // optional `diffs` array. Older harness builds emit no diffs, so the
    // lookup is empty and counts default to 0 — same behaviour as before.
    let line_counts: std::collections::HashMap<String, (u32, u32)> = files_changed
        .get("diffs")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    let path = entry.get("path")?.as_str()?.to_string();
                    let added = entry
                        .get("lines_added")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0) as u32;
                    let removed = entry
                        .get("lines_removed")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0) as u32;
                    Some((path, (added, removed)))
                })
                .collect()
        })
        .unwrap_or_default();

    [
        ("create", "created"),
        ("modify", "modified"),
        ("delete", "deleted"),
    ]
    .into_iter()
    .flat_map(|(op, key)| {
        let line_counts = &line_counts;
        files_changed
            .get(key)
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(move |value| {
                value.as_str().map(|path| {
                    let (lines_added, lines_removed) =
                        line_counts.get(path).copied().unwrap_or((0, 0));
                    StorageTaskFileChangeSummary {
                        op: op.to_string(),
                        path: path.to_string(),
                        lines_added,
                        lines_removed,
                    }
                })
            })
    })
    .collect()
}

#[derive(Clone, Copy, Debug)]
struct ModelRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

fn default_fee_schedule() -> [(&'static str, ModelRates); 7] {
    [
        (
            "gpt-5.5",
            ModelRates {
                input: 5.0,
                output: 30.0,
                cache_write: 5.0,
                cache_read: 0.5,
            },
        ),
        (
            "gpt-5.4",
            ModelRates {
                input: 2.5,
                output: 15.0,
                cache_write: 2.5,
                cache_read: 0.25,
            },
        ),
        (
            "gpt-5.4-mini",
            ModelRates {
                input: 0.75,
                output: 4.5,
                cache_write: 0.75,
                cache_read: 0.075,
            },
        ),
        (
            "gpt-5.4-nano",
            ModelRates {
                input: 0.20,
                output: 1.25,
                cache_write: 0.20,
                cache_read: 0.02,
            },
        ),
        (
            "claude-opus-4-6",
            ModelRates {
                input: 5.0,
                output: 25.0,
                cache_write: 6.25,
                cache_read: 0.5,
            },
        ),
        (
            "claude-sonnet-4-5",
            ModelRates {
                input: 3.0,
                output: 15.0,
                cache_write: 3.75,
                cache_read: 0.3,
            },
        ),
        (
            "claude-haiku-4-5",
            ModelRates {
                input: 0.80,
                output: 4.00,
                cache_write: 1.0,
                cache_read: 0.08,
            },
        ),
    ]
}

fn lookup_model_rates(model: &str) -> ModelRates {
    let normalized_model = normalize_pricing_model_id(model);
    let mut exact: Vec<_> = default_fee_schedule()
        .into_iter()
        .filter(|(candidate, _)| *candidate == normalized_model)
        .collect();
    if let Some((_, rates)) = exact.pop() {
        return rates;
    }

    let mut partial: Vec<_> = default_fee_schedule()
        .into_iter()
        .filter(|(candidate, _)| {
            normalized_model.starts_with(candidate) || candidate.starts_with(&normalized_model)
        })
        .collect();
    if let Some((_, rates)) = partial.pop() {
        return rates;
    }

    ModelRates {
        input: 5.0,
        output: 25.0,
        cache_write: 6.25,
        cache_read: 0.5,
    }
}

fn normalize_pricing_model_id(model: &str) -> String {
    let normalized = model.trim().to_ascii_lowercase();
    if let Some(rest) = normalized.strip_prefix("openai/") {
        return rest.to_string();
    }

    for (aura_id, model_id) in [
        ("aura-gpt-5-5", "gpt-5.5"),
        ("aura-gpt-5-4", "gpt-5.4"),
        ("aura-gpt-5-4-mini", "gpt-5.4-mini"),
        ("aura-gpt-5-4-nano", "gpt-5.4-nano"),
    ] {
        if normalized == aura_id {
            return model_id.to_string();
        }
    }

    normalized
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
    zero_pro_user: bool,
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
        zero_pro_user: usage.zero_pro_user,
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
        zero_pro_user: cached.session.is_zero_pro,
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
    persist_task_failure_reason(storage_client, jwt, task_id, reason).await;
    emit_domain_event(
        app_broadcast,
        "task_failed",
        project_id,
        agent_instance_id,
        serde_json::json!({
            "task_id": task_id.to_string(),
            "reason": reason,
        }),
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
    emit_domain_event(
        app_broadcast,
        "task_retrying",
        project_id,
        agent_instance_id,
        serde_json::json!({
            "task_id": task_id.to_string(),
            "reason": reason,
        }),
    );
    let (automaton_id, event_stream_url) = match ctx
        .automaton_client
        .start(ctx.start_params.clone())
        .await
    {
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
                                }
                            }
                        }
                    }

                    if event_type == "assistant_message_end" {
                        if let (Some(session_id), Some(turn_usage)) =
                            (current_session_id, extract_turn_usage(&event))
                        {
                            // Don't pass cumulative token totals here — the
                            // router atomically increments sessions tokens on
                            // every successful LLM round-trip via aura-storage's
                            // /internal/sessions/:id/tokens endpoint, so a
                            // SET-based write here would race with those
                            // increments. Per-turn input/output deltas + the
                            // context-utilization estimate still flow through
                            // for event-stream consumers that watch them.
                            if let Err(error) = session_service
                                .update_context_usage(UpdateContextUsageParams {
                                    project_id,
                                    agent_instance_id,
                                    session_id,
                                    input_tokens: turn_usage.input_tokens,
                                    output_tokens: turn_usage.output_tokens,
                                    total_input_tokens: None,
                                    total_output_tokens: None,
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
                                let gate_reason =
                                    completion_validation_failure_reason(&cached);
                                let mut gate_report = CompletionGateReport::from_cached(&cached);
                                gate_report.failure_reason =
                                    gate_reason.map(|r| r.to_string());
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
                                    session_status = "failed";
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

                            // Post-commit `git push` timeout: the task's
                            // work is already committed in the workspace
                            // repo, so the task itself is done. The push
                            // is infrastructure and is retried separately
                            // by the harness. Do NOT fail the task, do
                            // NOT reset it to `ready`, and do NOT pause
                            // the loop. Transition to `done` and surface
                            // a `git_push_failed` event to the UI.
                            if let (Some(tid), Some(reason)) = (
                                tid.as_ref(),
                                failure_reason.as_ref(),
                            ) {
                                if classify_infra_failure(reason)
                                    == Some(InfraFailureClass::GitPushTimeout)
                                {
                                    if let (Some(storage_client), Some(jwt)) =
                                        (storage_client.as_ref(), jwt.as_deref())
                                    {
                                        let req = aura_os_storage::TransitionTaskRequest {
                                            status: "done".to_string(),
                                        };
                                        if let Err(error) = storage_client
                                            .transition_task(tid, jwt, &req)
                                            .await
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
                            if let (Some(tid), Some(reason), Some(infra_failure)) = (
                                tid.as_ref(),
                                failure_reason.as_ref(),
                                failure_reason.as_deref().and_then(classify_infra_failure),
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
                                        if let Err(error) = storage_client
                                            .transition_task(tid, jwt, &bridge)
                                            .await
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
                            // `useTaskStatus` hook can display it.
                            if let (Some(reason), Some(obj)) =
                                (failure_reason.as_ref(), event.as_object_mut())
                            {
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
                                    let pid = project_id.to_string();
                                    let aid = agent_instance_id.to_string();
                                    let rurl = router_url.clone();
                                    let hclient = http_client.clone();
                                    tokio::spawn(async move {
                                        if let Err(e) = super::agents::generate_session_summary(
                                            &sc, &hclient, &rurl, &j, &sid, &pid, &aid,
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
                    let _ = app_broadcast.send(forwarded.clone());

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
                            let pid = project_id.to_string();
                            let aid = agent_instance_id.to_string();
                            let rurl = router_url.clone();
                            let hclient = http_client.clone();
                            tokio::spawn(async move {
                                if let Err(e) = super::agents::generate_session_summary(
                                    &sc, &hclient, &rurl, &j, &sid, &pid, &aid,
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
            // Allow one automatic restart of the automaton on infra-transient
            // failures (stream closed without terminal event, or `error`
            // event with no accompanying `task_failed`). We intentionally do
            // not retry harness-reported `task_failed`, since the harness
            // already runs its own build/test fix loop inside the task.
            retry: Some(TransientRetryContext {
                automaton_client: automaton_client.clone(),
                start_params,
                restart_budget: Some(1),
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

        // Without diffs, line counts default to 0 (older harness builds).
        assert!(files.iter().all(|f| f.lines_added == 0 && f.lines_removed == 0));
    }

    #[test]
    fn extracts_line_counts_from_diffs() {
        // New harness builds emit per-file diffs alongside the path lists.
        // extract_files_changed must merge them so the dashboard "Lines"
        // stat receives non-zero values.
        let event = serde_json::json!({
            "type": "assistant_message_end",
            "files_changed": {
                "created": ["src/new.rs"],
                "modified": ["src/lib.rs"],
                "deleted": ["src/old.rs"],
                "diffs": [
                    { "path": "src/new.rs", "lines_added": 12, "lines_removed": 0 },
                    { "path": "src/lib.rs", "lines_added": 3,  "lines_removed": 1 }
                ]
            }
        });

        let files = extract_files_changed(&event);
        let new_rs = files.iter().find(|f| f.path == "src/new.rs").unwrap();
        assert_eq!(new_rs.lines_added, 12);
        assert_eq!(new_rs.lines_removed, 0);
        let lib_rs = files.iter().find(|f| f.path == "src/lib.rs").unwrap();
        assert_eq!(lib_rs.lines_added, 3);
        assert_eq!(lib_rs.lines_removed, 1);
        // Path missing from diffs (old.rs) keeps zero counts.
        let old_rs = files.iter().find(|f| f.path == "src/old.rs").unwrap();
        assert_eq!(old_rs.lines_added, 0);
        assert_eq!(old_rs.lines_removed, 0);
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
    fn estimate_usage_cost_matches_gpt_5_5_rates() {
        let cost = estimate_usage_cost_usd("aura-gpt-5-5", 1_000_000, 500_000, 0, 1_000_000);

        assert!((cost - 20.5).abs() < 1e-9);
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
        let project_id = ProjectId::new();
        // Hint shorter than the class default is floored to the default.
        let short = register_project_cooldown_with_hint(
            project_id,
            InfraFailureClass::ProviderRateLimited,
            "short hint",
            Some(Duration::from_secs(1)),
        );
        assert!(short >= infra_cooldown_for(InfraFailureClass::ProviderRateLimited));
        clear_project_cooldown(project_id);

        // Hint longer than the class default wins, up to the cap.
        let long = register_project_cooldown_with_hint(
            project_id,
            InfraFailureClass::ProviderRateLimited,
            "long hint",
            Some(Duration::from_secs(90)),
        );
        assert_eq!(long, Duration::from_secs(90));
        clear_project_cooldown(project_id);

        // Hint above the ceiling is clamped.
        let capped = register_project_cooldown_with_hint(
            project_id,
            InfraFailureClass::ProviderRateLimited,
            "huge hint",
            Some(Duration::from_secs(10_000)),
        );
        assert_eq!(capped, Duration::from_secs(PROVIDER_BACKOFF_MAX_SECS));
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

    fn modify_summary(path: &str) -> StorageTaskFileChangeSummary {
        StorageTaskFileChangeSummary {
            op: "modify".into(),
            path: path.into(),
            lines_added: 0,
            lines_removed: 0,
        }
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
        assert!(c.has_rust && c.has_source, "mixed set must see the Rust file");

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
            files_changed: vec![
                modify_summary("src/lib.rs"),
                modify_summary("README.md"),
            ],
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
        // The report itself doesn't run the gate — failure_reason is
        // populated by the caller using
        // `completion_validation_failure_reason`.
        assert!(report.failure_reason.is_none());
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
