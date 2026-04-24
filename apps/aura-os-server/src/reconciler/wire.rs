use super::{ReconcileAction, TerminalReason};

impl ReconcileAction {
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::AdoptRun => serde_json::json!({ "action": "adopt_run" }),
            Self::RetryPush {
                commit_sha,
                retry_safe,
            } => serde_json::json!({
                "action": "retry_push",
                "commit_sha": commit_sha,
                "retry_safe": retry_safe,
            }),
            Self::RetryTask => serde_json::json!({ "action": "retry_task" }),
            Self::Decompose => serde_json::json!({ "action": "decompose" }),
            Self::MarkTerminal { reason } => serde_json::json!({
                "action": "mark_terminal",
                "reason": reason.as_label(),
            }),
            Self::Noop => serde_json::json!({ "action": "noop" }),
        }
    }
}

impl TerminalReason {
    fn as_label(&self) -> &'static str {
        match self {
            Self::RetryBudgetExhausted => "retry_budget_exhausted",
            Self::RateLimited => "rate_limited",
            Self::CommitFailed => "commit_failed",
            Self::DecomposeDisabled => "decompose_disabled",
            Self::CompletionContract => "completion_contract",
        }
    }
}
