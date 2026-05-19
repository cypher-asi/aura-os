//! Background task that drains the harness outbound stream into
//! storage events and publishes lifecycle/progress signals onto the
//! WebSocket event bus. Public surface is just
//! [`spawn_chat_persist_task`] + [`persist_event`]; per-event dispatch
//! lives in `persist_task_dispatch/`.

use std::sync::Arc;

use aura_os_harness::HarnessOutbound;
use serde_json::Value;
use tokio::sync::broadcast;

use super::persist::ChatPersistCtx;
use crate::stability_metrics::StabilityMetrics;

mod auto_fork;
mod persist_event;
mod run_loop;
mod state;

pub(crate) use persist_event::persist_event;
pub(super) use state::{
    flush_text_segment, log_stream_summary, message_id_for_synth, message_id_str, PersistTaskState,
};

/// Bundle of process-wide handles the persist task needs above and
/// beyond the `ChatPersistCtx`. Held alongside `ctx` so the
/// auto-fork-on-context-pressure spawn (Phase 3 of the agent-stream
/// reliability plan) can call back into `generate_session_summary`
/// and update the storage row without dragging the full `AppState`
/// through the chat hot path. Equivalent in spirit to
/// `spawn_session_title_task`'s opt-in plumbing.
#[derive(Clone)]
pub(crate) struct ChatPersistTaskExtras {
    pub http_client: reqwest::Client,
    pub router_url: String,
    pub auto_fork_threshold: f64,
    /// Phase 5 observability bag. The persist task is the canonical
    /// "did this turn make it" observer — bumps `chat_turns_completed_ok`
    /// on a clean `AssistantMessageEnd` and `auto_fork_triggered`
    /// when the threshold marker fires. `Option` so the existing
    /// `persist_task_dispatch` unit tests can construct extras
    /// without needing a real `StabilityMetrics` instance.
    pub stability_metrics: Option<Arc<StabilityMetrics>>,
}

pub(crate) fn spawn_chat_persist_task(
    rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
    model: Option<String>,
    extras: ChatPersistTaskExtras,
) {
    tokio::spawn(
        async move { run_loop::run_persist_loop(rx, ctx, event_bus, model, extras).await },
    );
}
