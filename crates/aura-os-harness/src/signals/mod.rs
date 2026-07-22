//! Typed harness wire-event signals.
//!
//! This module owns the classifier that turns the harness's prose
//! `reason` strings into the typed [`HarnessFailureKind`] enum.
//! Downstream server code consumes the enum directly; substring
//! matching of harness prose lives only here.
//!
//! The sibling [`synthesize`] module owns the failure-reason
//! fallback synthesizer the dev-loop forwarder uses when a
//! `task_failed` event lands without a usable reason field.

mod synthesize;

use serde::{Deserialize, Serialize};

pub use synthesize::{synthesize_failure_reason, FailureContext, MAX_ERROR_EXCERPT_LEN};

/// Retry decision the dev-loop reconciler should take for a given
/// `(HarnessFailureKind, attempt)` pair. Returned by
/// [`HarnessFailureKind::retry_action`].
///
/// Collapsed to two variants by the harness-cook-loop-fix plan: the
/// orchestrator either re-runs the same task or stops. The previous
/// `RetryWithDecomposition` action (which routed through a Phase 5
/// splitter agent) has been removed along with its consumer in
/// `task_decompose`.
///
/// * `Retry` — re-run the same task with a fresh agent context.
///   Used while the per-kind attempt cap (3 for the transient
///   classes) hasn't been hit.
/// * `Terminal` — stop retrying. The failure kind is either
///   inherently terminal or the transient retry cap is exhausted.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryAction {
    Retry,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessFailureKind {
    Truncation,
    RateLimited,
    PushTimeout,
    CompletionContract,
    /// Terminal agent-side anti-waste signal: the harness has
    /// decided to stop on its own consecutive-error guard
    /// ("appears stuck", "stopping to prevent waste", ...).
    /// Restarting just tight-loops on the WS reconnect path, so
    /// the dev loop must not retry.
    AgentStuck,
    /// Provider rejected work because the account has no remaining
    /// credits (HTTP 402, "insufficient credits", "payment_required").
    /// Terminal — retrying or moving to the next task only burns
    /// build/setup time.
    InsufficientCredits,
    /// Transient provider internal error (5xx, stream aborted,
    /// connection reset). Retryable.
    ProviderInternal,
    Other,
}

impl HarnessFailureKind {
    /// Attempt-aware retry policy: decides whether the dev-loop
    /// reconciler should re-run the task as-is or give up.
    ///
    /// `attempt` is the zero-indexed count of attempts that have
    /// ALREADY been made before the failure being classified (i.e.
    /// the persisted `tasks.attempts` column at the moment of the
    /// `task_failed` event). So `attempt = 0` means "this is the
    /// first failure, no retries have been issued yet", `attempt =
    /// 1` means "one retry was already issued and it failed again",
    /// and so on.
    ///
    /// Exhaustive `match` so adding a new variant forces an explicit
    /// retry-policy decision at the compiler.
    ///
    /// Policy:
    ///
    /// * Infra-transient — `RateLimited`, `ProviderInternal`,
    ///   `PushTimeout` — `Retry` while `attempt < 3` (the upstream
    ///   typically clears on that timescale), then `Terminal`.
    /// * Task-shape — `Truncation`, `CompletionContract` —
    ///   `Terminal` from attempt 0. The decomposition splitter that
    ///   used to handle these has been removed, so re-running the
    ///   same task without any structural change is just burning
    ///   credits.
    /// * Terminal — `AgentStuck`, `InsufficientCredits`, `Other` —
    ///   `Terminal` at every attempt index. The harness has decided
    ///   to stop on its own anti-waste guard, the account is out of
    ///   credits, or the failure was unclassified.
    #[must_use]
    pub const fn retry_action(self, attempt: u32) -> RetryAction {
        match self {
            HarnessFailureKind::RateLimited
            | HarnessFailureKind::PushTimeout
            | HarnessFailureKind::ProviderInternal => {
                if attempt >= 3 {
                    RetryAction::Terminal
                } else {
                    RetryAction::Retry
                }
            }
            HarnessFailureKind::Truncation
            | HarnessFailureKind::CompletionContract
            | HarnessFailureKind::AgentStuck
            | HarnessFailureKind::InsufficientCredits
            | HarnessFailureKind::Other => RetryAction::Terminal,
        }
    }

    /// Attempt-agnostic retry predicate, preserved for callers that
    /// don't have a per-task attempt counter in scope. Implemented
    /// in terms of [`Self::retry_action`] at `attempt = 0` so the
    /// two stay in lock-step: a kind that is terminal at attempt 0
    /// is never retryable, and vice versa.
    #[must_use]
    pub const fn is_retryable(self) -> bool {
        !matches!(self.retry_action(0), RetryAction::Terminal)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HarnessSignal {
    TaskCompleted {
        task_id: Option<String>,
    },
    TaskFailed {
        task_id: Option<String>,
        reason: Option<String>,
        failure: HarnessFailureKind,
    },
    GitCommitted {
        task_id: Option<String>,
        commit_sha: Option<String>,
    },
    GitPushed {
        task_id: Option<String>,
        commit_sha: Option<String>,
    },
    GitPushFailed {
        task_id: Option<String>,
        commit_sha: Option<String>,
        reason: Option<String>,
    },
    ToolResult {
        task_id: Option<String>,
        name: Option<String>,
        is_error: bool,
        reason: Option<String>,
    },
}

impl HarnessSignal {
    pub fn from_event(event_type: &str, content: &serde_json::Value) -> Option<Self> {
        if let Some(signal) = Self::from_wrapped_event(event_type, content) {
            return Some(signal);
        }

        match event_type {
            "task_completed" => Some(Self::TaskCompleted {
                task_id: task_id(content),
            }),
            "task_failed" => {
                let reason = reason(content);
                Some(Self::TaskFailed {
                    task_id: task_id(content),
                    failure: classify_failure(reason.as_deref()),
                    reason,
                })
            }
            "git_committed" | "commit_created" => Some(Self::GitCommitted {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
            }),
            "git_pushed" | "push_succeeded" | "pushed" => Some(Self::GitPushed {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
            }),
            "git_push_failed" | "push_failed" => Some(Self::GitPushFailed {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
                reason: reason(content),
            }),
            "tool_call_completed" | "tool_result" => Some(Self::ToolResult {
                task_id: task_id(content),
                name: string_field(content, &["name", "tool_name"]),
                is_error: content
                    .get("is_error")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                reason: reason(content),
            }),
            _ => None,
        }
    }

    fn from_wrapped_event(event_type: &str, content: &serde_json::Value) -> Option<Self> {
        match event_type {
            "task_sync_checkpoint" => content.get("checkpoint").and_then(|checkpoint| {
                Self::from_event_value_with_task_id(checkpoint, task_id(content))
            }),
            "task_checkpoint_state" => content
                .get("sync_state")
                .and_then(|state| state.get("status"))
                .and_then(|status| status.as_str())
                .and_then(|status| Self::from_event(status, content)),
            _ => None,
        }
    }

    pub fn from_event_value(value: &serde_json::Value) -> Option<Self> {
        Self::from_event_value_with_task_id(value, None)
    }

    pub fn task_id(&self) -> Option<&str> {
        match self {
            Self::TaskCompleted { task_id }
            | Self::TaskFailed { task_id, .. }
            | Self::GitCommitted { task_id, .. }
            | Self::GitPushed { task_id, .. }
            | Self::GitPushFailed { task_id, .. }
            | Self::ToolResult { task_id, .. } => task_id.as_deref(),
        }
    }

    pub fn failure_kind(&self) -> Option<HarnessFailureKind> {
        match self {
            Self::TaskFailed { failure, .. } => Some(*failure),
            Self::GitPushFailed { reason, .. } => Some(
                reason
                    .as_deref()
                    .map(|reason| {
                        if is_push_timeout(reason) {
                            HarnessFailureKind::PushTimeout
                        } else {
                            HarnessFailureKind::Other
                        }
                    })
                    .unwrap_or(HarnessFailureKind::Other),
            ),
            Self::ToolResult {
                is_error: true,
                name,
                reason,
                ..
            } => Some(classify_tool_result_failure(
                name.as_deref(),
                reason.as_deref(),
            )),
            _ => None,
        }
    }

    fn from_event_value_with_task_id(
        value: &serde_json::Value,
        fallback_task_id: Option<String>,
    ) -> Option<Self> {
        let event_type = string_field(value, &["type", "event_type", "kind", "status"])?;
        let mut content = value.clone();
        if task_id(&content).is_none() {
            if let (Some(object), Some(task_id)) = (content.as_object_mut(), fallback_task_id) {
                object.insert("task_id".into(), serde_json::Value::String(task_id));
            }
        }
        Self::from_event(&event_type, &content)
    }
}

pub fn classify_failure(reason: Option<&str>) -> HarnessFailureKind {
    let Some(reason) = reason else {
        return HarnessFailureKind::Other;
    };
    let reason = reason.to_ascii_lowercase();
    // Terminal anti-waste signals win first: a harness that decided to
    // stop on its own must not be restarted.
    if is_agent_stuck(&reason) {
        HarnessFailureKind::AgentStuck
    } else if is_insufficient_credits(&reason) {
        HarnessFailureKind::InsufficientCredits
    } else if is_completion_contract_failure(&reason) {
        HarnessFailureKind::CompletionContract
    } else if reason.contains("truncat")
        || reason.contains("max_tokens")
        || reason.contains("maximum tokens")
    {
        HarnessFailureKind::Truncation
    } else if is_rate_limited(&reason) {
        HarnessFailureKind::RateLimited
    } else if is_provider_internal(&reason) {
        HarnessFailureKind::ProviderInternal
    } else if is_push_timeout(&reason) {
        HarnessFailureKind::PushTimeout
    } else {
        HarnessFailureKind::Other
    }
}

/// Substring matcher for [`HarnessFailureKind::RateLimited`].
///
/// Matches provider rate-limit / overload responses (HTTP 429 / 529,
/// "overloaded", "rate_limited"). Caller must lowercase the input.
fn is_rate_limited(reason: &str) -> bool {
    reason.contains("rate limit")
        || reason.contains("rate_limited")
        || reason.contains("429")
        || reason.contains("529")
        || reason.contains("overloaded")
}

/// Substring matcher for [`HarnessFailureKind::InsufficientCredits`].
///
/// Caller must lowercase the input.
fn is_insufficient_credits(reason: &str) -> bool {
    reason.contains("insufficient credits")
        || reason.contains("insufficient_credits")
        || reason.contains("payment_required")
        || reason.contains("402 payment required")
        || (reason.contains("402") && reason.contains("payment required"))
}

/// Substring matcher for [`HarnessFailureKind::ProviderInternal`].
///
/// 5xx responses and transport-level stream aborts are all classified
/// as transient provider internal errors. Provider SDKs do not use one
/// stable phrase for the latter: reqwest commonly reports "error sending
/// request for url" while Anthropic's streaming client can surface
/// "connection closed before message completed". Caller must lowercase
/// the input.
fn is_provider_internal(reason: &str) -> bool {
    reason.contains("internal server error")
        || reason.contains(" 500")
        || reason.contains(" 502")
        || reason.contains(" 503")
        || reason.contains(" 504")
        || reason.contains("stream terminated")
        || reason.contains("connection reset by peer")
        || reason.contains("provider stream interrupted before completion")
        || reason.contains("connection closed before message completed")
        || reason.contains("error sending request for url")
}

/// Substring matcher for [`HarnessFailureKind::AgentStuck`].
///
/// Caller must lowercase the input.
fn is_agent_stuck(reason: &str) -> bool {
    reason.contains("appears stuck")
        || reason.contains("agent is stuck")
        || reason.contains("consecutive error")
        || reason.contains("consecutive failure")
        || reason.contains("all tool calls have returned errors")
        || reason.contains("prevent waste")
        || reason.contains("conserve budget")
}

fn classify_tool_result_failure(name: Option<&str>, reason: Option<&str>) -> HarnessFailureKind {
    if name == Some("git_commit_push")
        && reason
            .map(|reason| {
                let reason = reason.to_ascii_lowercase();
                reason.contains("timeout") || reason.contains("timed out")
            })
            .unwrap_or(false)
    {
        return HarnessFailureKind::PushTimeout;
    }
    classify_failure(reason)
}

// The workspace-health blocking verdict reason emitted by the
// server-side `classify_delta`. Duplicated as a `&str` literal
// (instead of `use`-ing the constant from the server) because
// `aura-os-harness` lives BELOW `aura-os-server` in the dep graph.
// The exact string is pinned by the test suite in the server's
// `handlers::dev_loop::health::delta::tests` module so this
// duplication will fail loudly if the canonical reason ever changes.
const WORKSPACE_HEALTH_BLOCKING_REASONS: &[&str] = &["workspace_health_regressed"];

fn is_completion_contract_failure(reason: &str) -> bool {
    let mentions_task_done =
        reason.contains("task_done") || reason.contains("completing this task");
    let mentions_missing_edits = reason.contains("not made any file changes")
        || reason.contains("no file changes")
        || reason.contains("no files changed")
        || reason.contains("no file edited")
        || reason.contains("no file edits");
    let mentions_no_change_escape_hatch = reason.contains("no_changes_needed");
    let mentions_workspace_health_verdict = WORKSPACE_HEALTH_BLOCKING_REASONS
        .iter()
        .any(|needle| reason.contains(needle));

    mentions_task_done && (mentions_missing_edits || mentions_no_change_escape_hatch)
        || mentions_workspace_health_verdict
}

fn is_push_timeout(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("git")
        && reason.contains("push")
        && (reason.contains("timeout") || reason.contains("timed out"))
}

fn task_id(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["task_id", "taskId"])
}

fn commit_sha(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["commit_sha", "commitSha", "sha"]).or_else(|| {
        value
            .get("commits")
            .and_then(|commits| commits.as_array())
            .and_then(|commits| commits.last())
            .and_then(|commit| commit.get("sha"))
            .and_then(|sha| sha.as_str())
            .map(str::to_owned)
    })
}

fn reason(value: &serde_json::Value) -> Option<String> {
    string_field(
        value,
        &[
            "reason",
            "error",
            "message",
            "result",
            "result_preview",
            "failure_class",
        ],
    )
}

fn string_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_task_failed_with_classification() {
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": "harness response truncated mid-stream",
            }),
        )
        .expect("signal");

        assert_eq!(signal.task_id(), Some("task-1"));
        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::Truncation));
    }

    #[test]
    fn classifies_task_done_without_file_edits_as_completion_contract() {
        let reason = "ERROR: You are completing this task but have not made any file changes \
                      (write_file, edit_file, or delete_file). Implementation tasks must produce \
                      file changes. If this task genuinely requires no file changes, call \
                      task_done again with \"no_changes_needed\": true and explain why in the \
                      notes field.";
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": reason,
            }),
        )
        .expect("signal");

        assert_eq!(
            signal.failure_kind(),
            Some(HarnessFailureKind::CompletionContract)
        );
    }

    #[test]
    fn agent_stuck_precedence_over_combined_reason_strings() {
        // A reason that contains BOTH an agent-stuck phrase and what
        // used to be a research-loop-abort phrase must still classify
        // as `AgentStuck`: the harness has decided to stop on its own
        // anti-waste guard and restarting just thrashes the WS
        // reconnect path. The research-loop classifier is gone now,
        // but the precedence over the rest of the matcher list is
        // still load-bearing.
        let reason = "agent is stuck after task completed without any file operations";
        assert_eq!(
            classify_failure(Some(reason)),
            HarnessFailureKind::AgentStuck,
            "agent-stuck precedence must win — restarting a stuck harness \
             just thrashes the WS reconnect path",
        );
    }

    #[test]
    fn classifies_agent_stuck_anti_waste_signals() {
        let stuck = [
            "agent appears stuck — no progress",
            "agent is stuck after consecutive errors",
            "10 consecutive errors observed",
            "stopping to prevent waste",
            "halting to conserve budget",
            "all tool calls have returned errors",
        ];
        for reason in stuck {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::AgentStuck,
                "expected agent_stuck: {reason}",
            );
        }
    }

    #[test]
    fn classifies_insufficient_credits_provider_phrasings() {
        let positives = [
            "Insufficient credits",
            "insufficient_credits",
            "payment_required",
            "402 payment required",
            "Anthropic 402 Payment Required - balance=0",
        ];
        for reason in positives {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::InsufficientCredits,
                "expected insufficient_credits: {reason}",
            );
        }
    }

    #[test]
    fn classifies_provider_internal_5xx_and_stream_aborts() {
        let positives = [
            "Internal server error",
            "upstream returned 500",
            "got 502 bad gateway",
            "upstream 503 service unavailable",
            "upstream 504 gateway timeout",
            "stream terminated unexpectedly",
            "connection reset by peer",
            "Provider stream interrupted before completion",
            "Anthropic API request failed: error sending request for url (https://aura-router.onrender.com/v1/messages): connection closed before message completed (llm_error)",
        ];
        for reason in positives {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::ProviderInternal,
                "expected provider_internal: {reason}",
            );
        }
    }

    #[test]
    fn classifies_rate_limited_provider_phrasings() {
        let positives = [
            "rate limit exceeded",
            "rate_limited",
            "overloaded_error",
            "HTTP 429 Too Many Requests",
            "got 529 from upstream",
        ];
        for reason in positives {
            assert_eq!(
                classify_failure(Some(reason)),
                HarnessFailureKind::RateLimited,
                "expected rate_limited: {reason}",
            );
        }
    }

    #[test]
    fn is_retryable_pinned_by_kind() {
        // Pin the typed retry-policy table so adding a new variant
        // forces an explicit decision via the exhaustive `match`.
        assert!(HarnessFailureKind::RateLimited.is_retryable());
        assert!(HarnessFailureKind::PushTimeout.is_retryable());
        assert!(HarnessFailureKind::ProviderInternal.is_retryable());
        // Truncation and CompletionContract are terminal from attempt 0
        // after the decomposition splitter was removed.
        assert!(!HarnessFailureKind::Truncation.is_retryable());
        assert!(!HarnessFailureKind::CompletionContract.is_retryable());
        assert!(!HarnessFailureKind::AgentStuck.is_retryable());
        assert!(!HarnessFailureKind::InsufficientCredits.is_retryable());
        assert!(!HarnessFailureKind::Other.is_retryable());
    }

    // -----------------------------------------------------------------
    // Attempt-aware retry policy (`HarnessFailureKind::retry_action`).
    //
    // Two-arm ladder: transient infra kinds retry until attempt >= 3,
    // task-shape and terminal kinds are `Terminal` from attempt 0.
    // -----------------------------------------------------------------

    #[test]
    fn task_shape_kinds_are_terminal_from_zero() {
        // Truncation and CompletionContract used to escalate through a
        // decomposition splitter; that splitter has been removed so
        // re-running the same task wholesale is just burning credits.
        for kind in [
            HarnessFailureKind::Truncation,
            HarnessFailureKind::CompletionContract,
        ] {
            for attempt in 0..5 {
                assert_eq!(
                    kind.retry_action(attempt),
                    RetryAction::Terminal,
                    "{kind:?}@{attempt}",
                );
            }
        }
    }

    #[test]
    fn terminal_kinds_never_retry() {
        for kind in [
            HarnessFailureKind::AgentStuck,
            HarnessFailureKind::InsufficientCredits,
            HarnessFailureKind::Other,
        ] {
            for attempt in 0..5 {
                assert_eq!(
                    kind.retry_action(attempt),
                    RetryAction::Terminal,
                    "{kind:?}@{attempt}",
                );
            }
        }
    }

    #[test]
    fn rate_limited_retries_until_cap() {
        assert_eq!(
            HarnessFailureKind::RateLimited.retry_action(0),
            RetryAction::Retry,
        );
        assert_eq!(
            HarnessFailureKind::RateLimited.retry_action(2),
            RetryAction::Retry,
        );
        assert_eq!(
            HarnessFailureKind::RateLimited.retry_action(3),
            RetryAction::Terminal,
        );
    }

    #[test]
    fn infra_transient_kinds_share_rate_limited_cap() {
        // PushTimeout and ProviderInternal share the same
        // straight-Retry-until-3 policy as RateLimited because none
        // of them is a task-shape failure — decomposing wouldn't
        // help, the upstream just needs more time to clear.
        for kind in [
            HarnessFailureKind::PushTimeout,
            HarnessFailureKind::ProviderInternal,
        ] {
            assert_eq!(kind.retry_action(0), RetryAction::Retry, "{kind:?}@0");
            assert_eq!(kind.retry_action(2), RetryAction::Retry, "{kind:?}@2");
            assert_eq!(kind.retry_action(3), RetryAction::Terminal, "{kind:?}@3");
        }
    }

    #[test]
    fn is_retryable_remains_consistent_with_retry_action() {
        // Lock-step invariant: the legacy attempt-agnostic predicate
        // must agree with `retry_action(0) != Terminal` for every
        // kind.
        use HarnessFailureKind::{
            AgentStuck, CompletionContract, InsufficientCredits, Other, ProviderInternal,
            PushTimeout, RateLimited, Truncation,
        };
        for kind in [
            RateLimited,
            PushTimeout,
            ProviderInternal,
            Truncation,
            CompletionContract,
            AgentStuck,
            InsufficientCredits,
            Other,
        ] {
            let legacy = kind.is_retryable();
            let new = kind.retry_action(0) != RetryAction::Terminal;
            assert_eq!(
                legacy, new,
                "is_retryable/retry_action diverge for {kind:?}",
            );
        }
    }

    /// Exhaustive cross-product invariant over EVERY variant and
    /// attempt index 0..=5: the attempt-agnostic
    /// [`HarnessFailureKind::is_retryable`] predicate MUST stay
    /// consistent with `retry_action(0) != Terminal`. Additionally
    /// a kind that is `Terminal` at attempt 0 must stay `Terminal`
    /// at every higher attempt — the ladder only ratchets toward
    /// `Terminal`, never away.
    #[test]
    fn is_retryable_matches_retry_action_for_every_kind_and_attempt() {
        use HarnessFailureKind::{
            AgentStuck, CompletionContract, InsufficientCredits, Other, ProviderInternal,
            PushTimeout, RateLimited, Truncation,
        };
        let kinds = [
            RateLimited,
            PushTimeout,
            ProviderInternal,
            Truncation,
            CompletionContract,
            AgentStuck,
            InsufficientCredits,
            Other,
        ];
        for kind in kinds {
            let legacy = kind.is_retryable();
            for attempt in 0u32..=5 {
                let action = kind.retry_action(attempt);
                let derived = action != RetryAction::Terminal;
                if attempt == 0 {
                    assert_eq!(
                        legacy, derived,
                        "is_retryable/retry_action(0) diverge for {kind:?}",
                    );
                }
                if !legacy {
                    assert_eq!(
                        action,
                        RetryAction::Terminal,
                        "{kind:?}@{attempt}: terminal-from-zero kinds must stay terminal forever",
                    );
                }
            }
        }
    }

    /// On-wire format pin: the `RetryAction` variants must serialize
    /// to the EXACT snake_case strings the `task_retrying` event
    /// consumers pattern-match against. The dev-loop forwarder
    /// (`apps/aura-os-server/src/handlers/dev_loop/streaming/
    /// side_effects/retry.rs`) embeds the serialized variant under
    /// the `retry_action` JSON key; downstream consumers route on
    /// the literal strings, so a typo or rename would silently
    /// break the contract.
    #[test]
    fn retry_action_serializes_to_snake_case_strings() {
        assert_eq!(
            serde_json::to_string(&RetryAction::Retry).unwrap(),
            "\"retry\"",
        );
        assert_eq!(
            serde_json::to_string(&RetryAction::Terminal).unwrap(),
            "\"terminal\"",
        );

        assert_eq!(
            serde_json::from_str::<RetryAction>("\"retry\"").unwrap(),
            RetryAction::Retry,
        );
        assert_eq!(
            serde_json::from_str::<RetryAction>("\"terminal\"").unwrap(),
            RetryAction::Terminal,
        );
    }

    #[test]
    fn completion_contract_does_not_swallow_plain_truncation() {
        assert_eq!(
            classify_failure(Some(
                "response truncated because no file context was available"
            )),
            HarnessFailureKind::Truncation
        );
    }

    #[test]
    fn parses_legacy_git_push_failed_step() {
        let signal = HarnessSignal::from_event_value(&serde_json::json!({
            "type": "git_push_failed",
            "commit_sha": "abc123",
            "reason": "git push timeout",
        }))
        .expect("signal");

        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::PushTimeout));
        assert!(matches!(
            signal,
            HarnessSignal::GitPushFailed {
                commit_sha: Some(ref sha),
                ..
            } if sha == "abc123"
        ));
    }

    #[test]
    fn classifies_git_commit_push_tool_timeout_as_push_timeout() {
        let signal = HarnessSignal::from_event(
            "tool_call_completed",
            &serde_json::json!({
                "task_id": "task-1",
                "name": "git_commit_push",
                "is_error": true,
                "result": "Tool timed out after 120000ms",
            }),
        )
        .expect("signal");

        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::PushTimeout));
    }

    // -----------------------------------------------------------------
    // The workspace-health blocking verdict must classify as
    // `CompletionContract` so the server-side restart path routes it
    // through the same fresh-context retry loop as the existing
    // `task_done` / research-loop failures.
    // -----------------------------------------------------------------

    #[test]
    fn classifies_workspace_health_regressed_as_completion_contract() {
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": "workspace_health_regressed: 2 new error(s) in zero-storage (E0277)",
            }),
        )
        .expect("signal");

        assert_eq!(
            signal.failure_kind(),
            Some(HarnessFailureKind::CompletionContract),
            "workspace_health_regressed must classify as a \
             CompletionContract failure so the dev-loop restart \
             path treats it as restartable",
        );
    }

    #[test]
    fn parses_checkpoint_wrapper_with_task_id() {
        let signal = HarnessSignal::from_event(
            "task_sync_checkpoint",
            &serde_json::json!({
                "task_id": "task-1",
                "checkpoint": {
                    "kind": "git_pushed",
                    "commits": [{ "sha": "def456" }],
                },
            }),
        )
        .expect("signal");

        assert_eq!(signal.task_id(), Some("task-1"));
        assert!(matches!(
            signal,
            HarnessSignal::GitPushed {
                commit_sha: Some(ref sha),
                ..
            } if sha == "def456"
        ));
    }
}
