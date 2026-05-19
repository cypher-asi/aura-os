//! Phase 3 context-pressure auto-fork: detect when a finalized turn crossed the rollover threshold, summarise the session, persist the rollover marker, and flag the storage session `rolled_over` so the next user send transparently mints a follow-up session.

use std::sync::Arc;

use aura_os_storage::StorageClient;
use serde_json::json;
use tracing::{info, warn};

use super::super::persist::ChatPersistCtx;
use super::persist_event::persist_event;
use super::ChatPersistTaskExtras;

/// Phase 3 auto-fork trigger. When the just-finalized assistant turn
/// reports `usage.context_utilization >= AURA_CHAT_AUTO_FORK_THRESHOLD`,
/// detach a background task that summarises the session and flags the
/// storage row `rolled_over`. The next user send to this partition
/// observes the flag in `resolve_chat_session_with_pin` and
/// transparently mints a fresh session via
/// `SessionService::create_chat_followup_session` carrying the summary
/// forward — the user never has to click `+`.
pub(super) fn maybe_spawn_auto_fork_marker(
    ctx: &ChatPersistCtx,
    end: &aura_os_harness::AssistantMessageEnd,
    extras: &ChatPersistTaskExtras,
) {
    let utilization = end.usage.context_utilization as f64;
    if !utilization.is_finite() || utilization < extras.auto_fork_threshold {
        return;
    }
    info!(
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        utilization,
        threshold = extras.auto_fork_threshold,
        "Marked chat session for auto-fork at next user send"
    );
    if let Some(metrics) = extras.stability_metrics.as_ref() {
        metrics.inc_auto_fork_triggered();
    }
    let ctx = ctx.clone();
    let extras = extras.clone();
    tokio::spawn(async move {
        run_auto_fork_marker(ctx, extras, utilization).await;
    });
}

async fn run_auto_fork_marker(
    ctx: ChatPersistCtx,
    extras: ChatPersistTaskExtras,
    utilization: f64,
) {
    // 1. Best-effort summarisation. `generate_session_summary` returns
    // an empty string when there's nothing useful to summarise (e.g.
    // every turn was tool-use only). Fall back to a static label so
    // the next session at least carries the context-pressure trigger
    // forward instead of an empty summary that
    // `create_chat_followup_session` would drop.
    let summary = generate_rollover_summary_for_session(&ctx, &extras).await;
    persist_rollover_summary_event(&ctx, &summary, utilization).await;
    mark_storage_session_rolled_over(&ctx).await;
}

async fn generate_rollover_summary_for_session(
    ctx: &ChatPersistCtx,
    extras: &ChatPersistTaskExtras,
) -> String {
    // Stringify the typed session id once at this storage boundary;
    // `generate_session_summary` keeps `&str` to match the REST shape.
    let session_id_str = ctx.session_id.to_string();
    let result = crate::handlers::agents::sessions::generate_session_summary(
        &ctx.storage,
        &extras.http_client,
        &extras.router_url,
        &ctx.jwt,
        &session_id_str,
        &ctx.project_id,
        &ctx.project_agent_id,
    )
    .await;
    match result {
        Ok(summary) if !summary.trim().is_empty() => summary,
        Ok(_) => {
            info!(
                session_id = %ctx.session_id,
                "Auto-fork summary was empty; using fallback label"
            );
            "Continued from a long conversation (no summary available).".to_string()
        }
        Err(error) => {
            warn!(
                session_id = %ctx.session_id,
                %error,
                "Auto-fork summary generation failed; using fallback label"
            );
            "Continued from a long conversation (no summary available).".to_string()
        }
    }
}

async fn persist_rollover_summary_event(ctx: &ChatPersistCtx, summary: &str, utilization: f64) {
    let payload = json!({
        "summary": summary,
        "trigger": "context_pressure",
        "utilization": utilization,
    });
    if !persist_event(ctx, "rollover_summary", payload).await {
        warn!(
            session_id = %ctx.session_id,
            "Failed to persist rollover_summary event; next send will fall back to a generic summary"
        );
    }
}

async fn mark_storage_session_rolled_over(ctx: &ChatPersistCtx) {
    let req = aura_os_storage::UpdateSessionRequest {
        status: Some("rolled_over".to_string()),
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
        summary_of_previous_context: None,
        tasks_worked_count: None,
        ended_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    if let Err(error) =
        update_session_with_storage(&ctx.storage, &ctx.session_id.to_string(), &ctx.jwt, &req).await
    {
        warn!(
            session_id = %ctx.session_id,
            %error,
            "Failed to flag chat session rolled_over; auto-fork will rely on the context_usage_estimate fallback"
        );
    }
}

async fn update_session_with_storage(
    storage: &Arc<StorageClient>,
    session_id: &str,
    jwt: &str,
    req: &aura_os_storage::UpdateSessionRequest,
) -> Result<(), aura_os_storage::StorageError> {
    storage.update_session(session_id, jwt, req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stability_metrics::StabilityMetrics;
    use aura_os_harness::{AssistantMessageEnd, FilesChanged, SessionUsage};

    /// Phase 5 wiring guard: when `maybe_spawn_auto_fork_marker` fires
    /// because the assistant turn's `usage.context_utilization`
    /// exceeded the configured threshold, it must bump
    /// [`crate::stability_metrics::StabilityMetrics::inc_auto_fork_triggered`]
    /// once. The synchronous prefix runs before the spawned summary
    /// task so this test does NOT need to await any background work
    /// — the increment happens on the calling thread.
    ///
    /// Constructs a minimal `ChatPersistCtx` via a temporary storage
    /// client; the marker function only reads `ctx.session_id` /
    /// `project_agent_id` for log fields and never actually invokes
    /// the storage client when the threshold path is short-circuited
    /// in this thread (the spawned task is detached and can race the
    /// test's drop without tripping the assertion).
    #[tokio::test]
    async fn maybe_spawn_auto_fork_marker_increments_triggered_counter_when_over_threshold() {
        let metrics = Arc::new(StabilityMetrics::new());
        let extras = ChatPersistTaskExtras {
            http_client: reqwest::Client::new(),
            router_url: "http://localhost:9999".to_string(),
            auto_fork_threshold: 0.8,
            stability_metrics: Some(Arc::clone(&metrics)),
        };
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://localhost:9999",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };
        let mut end = AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        };
        end.usage.context_utilization = 0.9;

        maybe_spawn_auto_fork_marker(&ctx, &end, &extras);

        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.auto_fork_triggered, 1,
            "auto_fork_triggered must advance on first over-threshold finalization"
        );
    }

    /// Negative case: utilization below threshold must NOT advance
    /// the counter. Pins the threshold gating logic so a future
    /// reorder of the early-return doesn't silently leak triggered
    /// events.
    #[tokio::test]
    async fn maybe_spawn_auto_fork_marker_skips_increment_when_below_threshold() {
        let metrics = Arc::new(StabilityMetrics::new());
        let extras = ChatPersistTaskExtras {
            http_client: reqwest::Client::new(),
            router_url: "http://localhost:9999".to_string(),
            auto_fork_threshold: 0.8,
            stability_metrics: Some(Arc::clone(&metrics)),
        };
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://localhost:9999",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };
        let mut end = AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        };
        end.usage.context_utilization = 0.5;

        maybe_spawn_auto_fork_marker(&ctx, &end, &extras);

        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.auto_fork_triggered, 0,
            "auto_fork_triggered must not advance below the threshold"
        );
    }
}
