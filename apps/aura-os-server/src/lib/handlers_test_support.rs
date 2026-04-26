use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use aura_os_core::{AgentId, AgentInstanceId, SessionEvent};
use aura_os_harness::ConversationMessage;
use aura_os_storage::StorageSessionEvent;
use tokio::sync::Mutex;

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
    crate::handlers::agents::chat_pub::load_current_session_events_for_agent(state, agent_id, jwt)
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

// ---------------------------------------------------------------------------
// Phase-5 concurrency-test re-exports.
//
// Phase 5 of the robust-concurrent-agent-infra plan adds integration
// tests in `apps/aura-os-server/tests/concurrent_agents.rs` that
// exercise the chat handler's per-partition busy guard
// (`evaluate_partition_busy`), per-partition turn slot
// (`acquire_turn_slot`), and the in-stream `turn_in_progress` →
// `agent_busy` SSE remap (`harness_broadcast_to_sse`). All three live
// in `crate::handlers::agents::chat`; the `chat_pub` module surfaces
// them publicly so integration-test callers in `tests/` can reach
// them in the same style as `events_to_session_history_pub` above.
// ---------------------------------------------------------------------------

pub use crate::handlers::agents::chat_pub::{
    acquire_turn_slot, evaluate_partition_busy, harness_broadcast_to_sse, BusyMatch,
    TurnSlotAcquired, TurnSlotGuard, TurnSlotQueueFull, MAX_PENDING_TURNS,
};

/// Build the per-partition turn-slot `(Mutex, AtomicUsize)` pair the
/// chat session registry holds internally. Lets concurrency tests
/// invoke [`acquire_turn_slot`] against fresh state without
/// reaching into `ChatSession`'s private fields.
#[must_use]
pub fn fresh_turn_slot_state() -> (Arc<Mutex<()>>, Arc<AtomicUsize>) {
    (Arc::new(Mutex::new(())), Arc::new(AtomicUsize::new(0)))
}

/// Build a synthetic [`ActiveAutomatonEntry`] for use as the value
/// half of an automaton-registry snapshot fed to
/// [`evaluate_partition_busy`]. The chat handler's busy guard only
/// inspects the `template_agent_id`, the `paused` / `alive` flags,
/// and the `automaton_id`, so we surface a thin shim instead of the
/// crate-private `ActiveAutomaton` itself — that struct holds harness
/// handles, forwarder abort handles, and storage session ids that an
/// integration test cannot meaningfully populate.
#[must_use]
pub fn build_active_automaton_for_test(
    template: AgentId,
    project_id: aura_os_core::ProjectId,
    automaton_id: &str,
) -> crate::state::ActiveAutomaton {
    crate::state::ActiveAutomaton {
        automaton_id: automaton_id.to_string(),
        project_id,
        template_agent_id: template,
        harness_base_url: "http://127.0.0.1:1".to_string(),
        paused: false,
        alive: Arc::new(std::sync::atomic::AtomicBool::new(true)),
        forwarder: None,
        current_task_id: None,
        session_id: None,
    }
}

/// Re-export of the in-tree `ActiveAutomaton` so integration tests
/// can name the type when they construct registry snapshots via
/// [`build_active_automaton_for_test`].
pub use crate::state::ActiveAutomaton;

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
