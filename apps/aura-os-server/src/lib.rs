pub mod agent_events;
mod app_builder;
mod auth_guard;
mod billing_bridge;
pub(crate) mod billing_rollup;
pub(crate) mod channel_ext;
pub(crate) mod dto;
pub(crate) mod error;
pub mod handlers;
pub mod harness_client;
pub(crate) mod harness_gateway;
mod network_bridge;
pub mod orbit_guard;

mod loop_events_bridge;
pub mod loop_log;

pub(crate) mod orchestration_store;
#[allow(dead_code)]
pub(crate) mod persistence;
pub(crate) mod process_automaton;
pub(crate) mod reconciler;
pub(crate) mod router;
pub(crate) mod state;
pub(crate) mod sync_state;

pub use app_builder::build_app_state;
pub use harness_client::{
    bearer_headers, GetHeadResponse, HarnessClient, HarnessClientError, HarnessProbeResult,
    HarnessTxKind, SubmitTxResponse,
};
pub use harness_gateway::HarnessHttpGateway;
pub use router::{build_local_api_cors_layer, create_router_with_interface};
pub use state::{ActiveAutomaton, AppState, CachedSession};

/// Discover common user-level binary directories (pip `--user` scripts, `~/.local/bin`,
/// etc.) and append any that exist but are missing from `PATH`.  Call once at startup
/// so child processes (the harness, terminals) inherit the augmented `PATH` and can
/// find CLI tools installed via `pip install --user` or `uv tool install`.
pub fn ensure_user_bins_on_path() {
    use std::path::PathBuf;

    let mut extra: Vec<PathBuf> = Vec::new();

    // ~/.local/bin  (uv tool install, pipx, pip --user on Linux/macOS)
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".local").join("bin");
        if p.is_dir() {
            extra.push(p);
        }
    }

    #[cfg(windows)]
    {
        // Microsoft Store Python: %LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.*\…\Scripts
        if let Some(local) = dirs::data_local_dir() {
            let packages = local.join("Packages");
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    if !entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("PythonSoftwareFoundation.Python.3")
                    {
                        continue;
                    }
                    let base = entry.path().join("LocalCache").join("local-packages");
                    if let Ok(inner) = std::fs::read_dir(&base) {
                        for ie in inner.flatten() {
                            if ie.file_name().to_string_lossy().starts_with("Python3") {
                                let s = ie.path().join("Scripts");
                                if s.is_dir() {
                                    extra.push(s);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Standard pip --user: %APPDATA%\Python\Python3*\Scripts
        if let Some(roaming) = dirs::config_dir() {
            let python_dir = roaming.join("Python");
            if let Ok(entries) = std::fs::read_dir(&python_dir) {
                for entry in entries.flatten() {
                    let s = entry.path().join("Scripts");
                    if s.is_dir() {
                        extra.push(s);
                    }
                }
            }
        }
    }

    if extra.is_empty() {
        return;
    }

    let current = std::env::var_os("PATH").unwrap_or_default();
    let existing: std::collections::HashSet<PathBuf> = std::env::split_paths(&current).collect();

    let new_dirs: Vec<&PathBuf> = extra.iter().filter(|d| !existing.contains(*d)).collect();
    if new_dirs.is_empty() {
        return;
    }

    let mut all: Vec<PathBuf> = std::env::split_paths(&current).collect();
    for d in &new_dirs {
        tracing::debug!(path = %d.display(), "Appending user binary directory to PATH");
        all.push(d.to_path_buf());
    }
    if let Ok(joined) = std::env::join_paths(&all) {
        std::env::set_var("PATH", &joined);
    }
}

/// Thin re-exports of internal helpers that Phase 7 integration tests
/// exercise directly. Kept in its own module so the production call
/// sites don't have to widen visibility of the underlying private
/// functions or types. Not a stable public API — hidden from docs to
/// make it clear this is test plumbing, not a contract.
#[doc(hidden)]
pub mod phase7_test_support {
    /// True when `reason` is classified as a truncation-style failure
    /// by Phase 3's `classify_failure`. Anything else — auth errors,
    /// crashes, rate limits — returns `false`.
    pub fn is_truncation_failure(reason: &str) -> bool {
        crate::handlers::dev_loop::is_truncation_failure_for_tests(reason)
    }

    /// True when the harness/task tool rejected `task_done` because an
    /// implementation task completed without write/edit/delete evidence and
    /// without the explicit `no_changes_needed` escape hatch.
    pub fn is_completion_contract_failure(reason: &str) -> bool {
        crate::handlers::dev_loop::is_completion_contract_failure_for_tests(reason)
    }

    /// True when `reason` looks like a provider rate-limit or overload
    /// (HTTP 429 / 529 / `overloaded_error`). The orchestrator routes
    /// these through the infra-retry path rather than Phase 3's
    /// truncation remediation so a provider cooldown isn't wasted on
    /// heuristic follow-up tasks.
    pub fn is_rate_limited_failure(reason: &str) -> bool {
        crate::handlers::dev_loop::is_rate_limited_failure_for_tests(reason)
    }

    /// True when `reason` indicates the provider rejected work because the
    /// account has no remaining credits. This is terminal for dev loops:
    /// retrying or moving to the next task only burns build/setup time.
    pub fn is_insufficient_credits_failure(reason: &str) -> bool {
        crate::handlers::dev_loop::is_insufficient_credits_failure_for_tests(reason)
    }

    /// True when `reason` is recognized as a post-commit `git push`
    /// timeout. This is the non-fatal infra path: the task can still be
    /// marked done because the commit already exists locally.
    pub fn is_git_push_timeout_failure(reason: &str) -> bool {
        crate::handlers::dev_loop::is_git_push_timeout_failure_for_tests(reason)
    }

    /// True when `reason` is classified as a transient provider
    /// internal error (5xx / stream aborted) — the class added in
    /// Axis 1 so the `LLM error: stream terminated with error:
    /// Internal server error` pattern routes through the retry path
    /// instead of being treated as terminal.
    pub fn is_provider_internal_error(reason: &str) -> bool {
        crate::handlers::dev_loop::is_provider_internal_error_for_tests(reason)
    }

    /// True when `reason` text *looks* transient but the classifier
    /// didn't match it — the `debug.retry_miss` trigger condition from
    /// Axis 4. Used by integration tests to pin the exact coverage
    /// surface of `looks_like_unclassified_transient`.
    pub fn looks_like_unclassified_transient(reason: &str) -> bool {
        crate::handlers::dev_loop::looks_like_unclassified_transient_for_tests(reason)
    }

    /// True when `reason` is a terminal agent-side anti-waste signal
    /// from the harness (consecutive-error guard, "appears stuck",
    /// "stopping to prevent waste"). The error-event handler uses this
    /// to skip the restart path because restarting a harness that has
    /// already decided to stop just tight-loops on a WS reconnect.
    pub fn is_agent_stuck_terminal_signal(reason: &str) -> bool {
        crate::handlers::dev_loop::is_agent_stuck_terminal_signal_for_tests(reason)
    }

    /// True when an `error`-event reason from the harness should
    /// trigger an automaton restart. Restart iff the reason is
    /// actually transient (classified or unclassified-transient
    /// heuristic) **and** is not a terminal agent-stuck signal.
    pub fn should_restart_on_error_event(reason: &str) -> bool {
        crate::handlers::dev_loop::should_restart_on_error_event_for_tests(reason)
    }

    /// Compatibility shim for the former server-side Definition-of-Done
    /// gate. The harness is now authoritative for completion semantics,
    /// so aura-os always accepts harness terminal events and only records
    /// verification evidence for display.
    pub fn completion_validation_reason(
        live_output: &str,
        files_changed: &[&str],
        n_build_steps: usize,
        n_test_steps: usize,
        n_format_steps: usize,
        n_lint_steps: usize,
    ) -> Option<String> {
        crate::handlers::dev_loop::completion_validation_failure_reason_for_tests(
            live_output,
            files_changed,
            n_build_steps,
            n_test_steps,
            n_format_steps,
            n_lint_steps,
        )
    }

    /// Compatibility shim for callers that still pass empty-path-write
    /// counters. The harness owns task completion, so these counters are
    /// diagnostic history only.
    pub fn completion_validation_reason_with_empty_path_writes(
        live_output: &str,
        files_changed: &[&str],
        n_build_steps: usize,
        n_test_steps: usize,
        n_format_steps: usize,
        n_lint_steps: usize,
        n_empty_path_writes: u32,
    ) -> Option<String> {
        crate::handlers::dev_loop::completion_validation_failure_reason_with_empty_path_writes_for_tests(
            live_output,
            files_changed,
            n_build_steps,
            n_test_steps,
            n_format_steps,
            n_lint_steps,
            n_empty_path_writes,
        )
    }

    /// Compatibility shim for callers that still pass tool-call failures.
    /// Harness policy failures remain harness-owned task failures; aura-os
    /// should not reinterpret them as server-side DoD failures.
    #[allow(clippy::too_many_arguments)]
    pub fn completion_validation_reason_with_tool_call_failures(
        live_output: &str,
        files_changed: &[&str],
        n_build_steps: usize,
        n_test_steps: usize,
        n_format_steps: usize,
        n_lint_steps: usize,
        n_empty_path_writes: u32,
        tool_call_failures: &[(&str, &str)],
    ) -> Option<String> {
        crate::handlers::dev_loop::completion_validation_failure_reason_with_tool_call_failures_for_tests(
            live_output,
            files_changed,
            n_build_steps,
            n_test_steps,
            n_format_steps,
            n_lint_steps,
            n_empty_path_writes,
            tool_call_failures,
        )
    }

    /// True when a harness-emitted `tool_call_failed` with this
    /// `reason` should trigger another server-side infra retry given
    /// the number of retries already consumed for the task.
    ///
    /// Mirrors the gate used inside the forwarder's per-tool-call
    /// retry dispatch so a regression in the classifier wiring or
    /// the [`tool_call_retry_budget`] cap is caught without having
    /// to stand up a real automaton. Two axes tested here:
    /// * classifier must recognise the reason as infra-transient
    ///   (`classify_infra_failure` non-None)
    /// * counter must be strictly below the budget
    pub fn tool_call_failed_should_retry(reason: &str, prior_count: u32) -> bool {
        crate::handlers::dev_loop::tool_call_failed_should_retry_for_tests(reason, prior_count)
    }

    /// The per-task upper bound on server-side infra-retry attempts
    /// driven by `tool_call_failed` events. Returned as a plain `u32`
    /// so test assertions stay a single comparison.
    #[must_use]
    pub const fn tool_call_retry_budget() -> u32 {
        crate::handlers::dev_loop::tool_call_retry_budget_for_tests()
    }

    /// True when the harness streamed a `write_file` / `edit_file`
    /// `tool_call_completed` event with a missing or empty `path`.
    /// Those events cannot land on disk and are retained as diagnostic
    /// history; the harness owns any resulting completion decision.
    ///
    /// Started/snapshot events are intentionally ignored so a single
    /// malformed call is only counted once.
    pub fn is_empty_path_write_event(event_type: &str, event: &serde_json::Value) -> bool {
        crate::handlers::dev_loop::is_empty_path_write_event_for_tests(event_type, event)
    }

    /// Extracts `(path, op)` for a successful
    /// `tool_call_completed` representing a `write_file`,
    /// `edit_file`, or `delete_file` with a real path. The returned
    /// `op` is one of `"create" | "modify" | "delete"` (aligned with
    /// `StorageTaskFileChangeSummary::op`).
    ///
    /// This is the fallback signal aura-os uses to populate
    /// `files_changed` when the upstream `assistant_message_end` did
    /// not carry a `files_changed` payload.
    pub fn successful_write_event_path(
        event_type: &str,
        event: &serde_json::Value,
    ) -> Option<(String, &'static str)> {
        crate::handlers::dev_loop::successful_write_event_path_for_tests(event_type, event)
    }

    /// True when a successful `task_done` tool completion explicitly declares
    /// that no file edits were required for the task.
    pub fn task_done_declares_no_changes_needed(
        event_type: &str,
        event: &serde_json::Value,
    ) -> bool {
        crate::handlers::dev_loop::task_done_declares_no_changes_needed_for_tests(event_type, event)
    }

    /// Returns a stable diagnostic label when a successful `task_done` call
    /// lacks both file-change evidence and `no_changes_needed: true`.
    pub fn task_done_missing_file_changes_reason(
        event_type: &str,
        event: &serde_json::Value,
        files_changed: &[&str],
    ) -> Option<&'static str> {
        crate::handlers::dev_loop::task_done_missing_file_changes_reason_for_tests(
            event_type,
            event,
            files_changed,
        )
    }

    /// Preflight a local workspace directory the way the dev-loop would
    /// when starting a task. Returns `Ok(())` if the workspace is
    /// usable (or eligible for auto-clone via `git_repo_url`), and the
    /// remediation hint string otherwise.
    pub fn preflight_local_workspace(
        project_path: &str,
        git_repo_url: Option<&str>,
    ) -> Result<(), String> {
        crate::handlers::dev_loop::preflight_local_workspace_for_tests(project_path, git_repo_url)
    }

    /// Summarize how far a task got in the recovery lifecycle without
    /// requiring callers to replay the full handler state machine.
    pub fn recovery_checkpoint(
        live_output: &str,
        files_changed: &[&str],
        git_steps: &[serde_json::Value],
    ) -> &'static str {
        crate::handlers::dev_loop::recovery_checkpoint_for_tests(
            live_output,
            files_changed,
            git_steps,
        )
    }

    /// Run Phase 5's preflight decomposition detector against a
    /// prospective task's `(title, description)`. Returns
    /// `Some((reason_label, target_path))` when the heuristic would
    /// trigger a skeleton+fill split, `None` otherwise.
    pub fn preflight_decomposition_reason(
        title: &str,
        description: &str,
    ) -> Option<(String, Option<String>)> {
        crate::handlers::task_decompose::preflight_decomposition_reason_for_tests(
            title,
            description,
        )
    }

    /// Test-only: run the dev-loop invariant helper that decides
    /// whether a push-layer failure should keep the task in `done`.
    /// `push_class` accepts `"timeout"`, `"remote_storage_exhausted"`,
    /// or `"generic"` (anything else is treated as `"generic"`).
    #[allow(clippy::too_many_arguments)]
    pub fn should_task_complete_despite_push_failure(
        live_output: &str,
        files_changed: &[&str],
        n_build_steps: usize,
        n_test_steps: usize,
        n_format_steps: usize,
        n_lint_steps: usize,
        git_steps: &[serde_json::Value],
        push_class: &str,
    ) -> bool {
        crate::handlers::dev_loop::should_task_complete_despite_push_failure_for_tests(
            live_output,
            files_changed,
            n_build_steps,
            n_test_steps,
            n_format_steps,
            n_lint_steps,
            git_steps,
            push_class,
        )
    }

    /// Test-only: classify a `task_failed` reason into one of the
    /// push-failure classes, or `None` for non-push failures.
    /// Returns one of `"timeout" | "remote_storage_exhausted" | "generic"`.
    pub fn classify_push_failure(reason: &str) -> Option<&'static str> {
        crate::handlers::dev_loop::classify_push_failure_for_tests(reason)
    }

    /// Compatibility shim for the retired aura-os DoD retry classifier.
    /// Always returns `None`; the harness owns retry/remediation policy.
    pub fn classify_dod_remediation_kind(reason: &str) -> Option<&'static str> {
        crate::handlers::dev_loop::classify_dod_remediation_kind_for_tests(reason)
    }

    /// Compatibility shim for the retired aura-os DoD retry prompt.
    /// Always returns `None`; the harness owns follow-up prompts.
    pub fn build_dod_followup_prompt(
        kind_label: &str,
        attempt: u32,
        previous_reason: &str,
    ) -> Option<String> {
        crate::handlers::dev_loop::build_dod_followup_prompt_for_tests(
            kind_label,
            attempt,
            previous_reason,
        )
    }

    /// Test-only: the retired aura-os Definition-of-Done retry budget.
    /// Returns zero because retry/remediation policy now lives in the
    /// harness.
    #[must_use]
    pub const fn max_dod_retries_per_task() -> u32 {
        crate::handlers::dev_loop::max_dod_retries_per_task_for_tests()
    }

    /// Test-only: exercise the per-project push-failure counter.
    /// Bumps the streak `n` times on a fresh project id and returns a
    /// vector of `project_push_stuck`-emission booleans. Exactly one
    /// entry should be `true` even when `n` exceeds the threshold.
    pub fn bump_project_push_failures_streak(n: u32) -> Vec<bool> {
        crate::handlers::dev_loop::bump_project_push_failures_streak_for_tests(n)
    }

    /// Test-only: bump once, reset, bump once â proves the streak
    /// restarts cleanly so a subsequent threshold crossing re-emits
    /// `project_push_stuck`.
    pub fn push_failure_reset_rearms_stuck_emission() -> bool {
        crate::handlers::dev_loop::push_failure_reset_rearms_stuck_emission_for_tests()
    }

    /// Test-only: the dev-loop's configured push-failure stuck
    /// threshold. Exposed so regression tests don't hard-code the
    /// numeric constant.
    pub fn consecutive_push_failures_stuck_threshold() -> u32 {
        crate::handlers::dev_loop::CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD
    }

    pub fn sync_state_from_git_steps(git_steps: &[serde_json::Value]) -> serde_json::Value {
        serde_json::to_value(crate::sync_state::derive_sync_state(git_steps))
            .unwrap_or_else(|_| serde_json::json!({}))
    }

    pub fn recovery_point_from_git_steps(
        git_steps: &[serde_json::Value],
    ) -> Option<serde_json::Value> {
        let sync_state = crate::sync_state::derive_sync_state(git_steps);
        crate::sync_state::derive_recovery_point(&sync_state)
            .and_then(|point| serde_json::to_value(point).ok())
    }

    /// Run the reconciler's pure decision engine against a synthetic
    /// task recovery context and return the chosen action as a small
    /// JSON payload. Exposed so integration tests and downstream
    /// supervisors can exercise the decision table without depending
    /// on the server's private module layout.
    ///
    /// `failure_class` accepts one of `"none"`, `"truncation"`,
    /// `"rate_limited"`, `"push_timeout"`, `"other"`. Anything else is
    /// treated as `"other"`.
    ///
    /// A `max_retries` of `0` is treated as "use the default"
    /// ([`crate::reconciler::DEFAULT_MAX_RETRIES_PER_TASK`]) so callers
    /// that don't yet persist a per-task budget stay in lockstep with
    /// `handlers::dev_loop`'s `MAX_RETRIES_PER_TASK`.
    pub fn reconcile_decision(
        git_steps: &[serde_json::Value],
        failure_class: &str,
        retry_count: u32,
        max_retries: u32,
        has_live_automaton: bool,
        auto_decompose_disabled: bool,
    ) -> serde_json::Value {
        let sync_state = crate::sync_state::derive_sync_state(git_steps);
        let recovery_point = crate::sync_state::derive_recovery_point(&sync_state);
        let failure_signal = match failure_class {
            "none" => None,
            "truncation" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
                task_id: None,
                reason: Some("truncation".to_string()),
                failure: aura_os_harness::signals::HarnessFailureKind::Truncation,
            }),
            "rate_limited" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
                task_id: None,
                reason: Some("rate_limited".to_string()),
                failure: aura_os_harness::signals::HarnessFailureKind::RateLimited,
            }),
            "completion_contract" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
                task_id: None,
                reason: Some("task_done_without_file_changes".to_string()),
                failure: aura_os_harness::signals::HarnessFailureKind::CompletionContract,
            }),
            "push_timeout" => Some(aura_os_harness::signals::HarnessSignal::GitPushFailed {
                task_id: None,
                commit_sha: None,
                reason: Some("git push timeout".to_string()),
            }),
            _ => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
                task_id: None,
                reason: Some("other".to_string()),
                failure: aura_os_harness::signals::HarnessFailureKind::Other,
            }),
        };
        let effective_max = if max_retries == 0 {
            crate::reconciler::DEFAULT_MAX_RETRIES_PER_TASK
        } else {
            max_retries
        };
        let mut inputs = crate::reconciler::ReconcileInputs::from_sync_state(&sync_state);
        inputs.recovery_point = recovery_point.as_ref();
        inputs.retry_count = retry_count;
        inputs.max_retries = effective_max;
        inputs.latest_signal = failure_signal.as_ref();
        inputs.has_live_automaton = has_live_automaton;
        inputs.auto_decompose_disabled = auto_decompose_disabled;
        crate::reconciler::decide_reconcile_action(&inputs).to_json()
    }
}

pub mod handlers_test_support {
    use aura_os_core::{AgentId, AgentInstanceId, SessionEvent};
    use aura_os_harness::ConversationMessage;
    use aura_os_storage::StorageSessionEvent;

    use crate::state::AppState;

    pub fn events_to_session_history_pub(
        events: &[StorageSessionEvent],
        project_agent_id: &str,
        project_id: &str,
    ) -> Vec<SessionEvent> {
        crate::handlers::agents::conversions_pub::events_to_session_history(
            events,
            project_agent_id,
            project_id,
        )
    }

    pub fn session_events_to_conversation_history_pub(
        events: &[SessionEvent],
    ) -> Vec<ConversationMessage> {
        crate::handlers::agents::chat_pub::session_events_to_conversation_history(events)
    }

    pub fn session_events_to_agent_history_pub(events: &[SessionEvent]) -> Vec<serde_json::Value> {
        crate::handlers::agents::chat_pub::session_events_to_agent_history(events)
    }

    pub async fn load_current_session_events_for_agent_pub(
        state: &AppState,
        agent_id: &AgentId,
        jwt: &str,
    ) -> Vec<SessionEvent> {
        crate::handlers::agents::chat_pub::load_current_session_events_for_agent(
            state, agent_id, jwt,
        )
        .await
    }

    pub async fn load_current_session_events_for_instance_pub(
        state: &AppState,
        agent_instance_id: &AgentInstanceId,
        jwt: &str,
    ) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
        crate::handlers::agents::chat_pub::load_current_session_events_for_instance(
            state,
            agent_instance_id,
            jwt,
        )
        .await
    }

    pub fn build_project_system_prompt_for_test(
        project_id: &str,
        name: &str,
        description: &str,
        agent_prompt: &str,
    ) -> String {
        let mut ctx = format!(
            "<project_context>\nproject_id: {}\nproject_name: {}\n",
            project_id, name,
        );
        if !description.is_empty() {
            ctx.push_str(&format!("description: {}\n", description));
        }
        ctx.push_str("</project_context>\n\n");
        ctx.push_str(
            "IMPORTANT: When calling tools that accept a project_id parameter, \
             always use the project_id from the project_context above.\n\n",
        );
        format!("{}{}", ctx, agent_prompt)
    }
}
