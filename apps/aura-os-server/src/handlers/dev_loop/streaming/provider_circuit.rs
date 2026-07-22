//! Run-level circuit breaker for an exhausted provider retry budget.

use std::sync::atomic::Ordering;

use aura_os_harness::signals::{HarnessFailureKind, RetryAction};

use super::LogLineInputs;
use super::{credits, emit_domain_event, emit_log_line, side_effects::SideEffectCtx};

/// Stop the enclosing plan only after the normal per-task retry policy has
/// become terminal. This preserves recovery from a one-off provider failure
/// while preventing a large task graph from spending the same exhausted
/// provider budget again on every remaining task.
pub(super) fn should_open(kind: HarnessFailureKind, prior_attempts: u32) -> bool {
    matches!(
        kind,
        HarnessFailureKind::ProviderInternal | HarnessFailureKind::RateLimited
    ) && kind.retry_action(prior_attempts) == RetryAction::Terminal
}

pub(super) async fn open(ctx: &SideEffectCtx<'_>, reason: &str) {
    if ctx
        .retry_state
        .provider_circuit_open
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    emit_domain_event(
        ctx.state,
        "provider_circuit_open",
        ctx.project_id,
        ctx.agent_instance_id,
        serde_json::json!({ "reason": reason }),
    );
    emit_log_line(LogLineInputs {
        state: ctx.state,
        project_id: ctx.project_id,
        agent_instance_id: ctx.agent_instance_id,
        session_id: ctx.session_id,
        message: "Provider retry budget exhausted; automation paused to protect credits."
            .to_string(),
        extra: serde_json::json!({ "reason": "provider_retry_budget_exhausted" }),
    });
    credits::stop_automaton(
        ctx.state,
        ctx.project_id,
        ctx.agent_instance_id,
        &ctx.retry_state.automaton_id,
        "provider retry budget exhausted",
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_after_provider_retries_are_exhausted() {
        assert!(!should_open(HarnessFailureKind::ProviderInternal, 0));
        assert!(!should_open(HarnessFailureKind::ProviderInternal, 2));
        assert!(should_open(HarnessFailureKind::ProviderInternal, 3));
        assert!(should_open(HarnessFailureKind::RateLimited, 3));
    }

    #[test]
    fn non_provider_failures_do_not_trip_the_provider_circuit() {
        assert!(!should_open(HarnessFailureKind::PushTimeout, 3));
        assert!(!should_open(HarnessFailureKind::CompletionContract, 3));
        assert!(!should_open(HarnessFailureKind::InsufficientCredits, 3));
    }
}
