//! WebSocket-event-bus publishers for chat lifecycle events. Consumed
//! by `useChatHistorySync` on the client to live-refresh chat panels
//! when other agents (e.g. the CEO via `send_to_agent`) write into a
//! target agent's history.

use super::persist::ChatPersistCtx;

/// Publish a `user_message` event on the app-wide WebSocket event bus.
/// The UI's `useChatHistorySync` hook subscribes to this and force-refetches
/// the target agent's chat history so cross-agent writes (from the CEO's
/// `send_to_agent` tool, say) surface live in the target's panel without
/// needing a manual reload.
pub(crate) fn publish_user_message_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    event_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "user_message",
        "event_id": event_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        // `agent_instance_id` is the field the UI wire parser
        // (`parseAuraEvent` in interface/src/shared/types/aura-events.ts) reads
        // to populate `AuraEventBase.agent_id`, which the hook filters on.
        "agent_instance_id": ctx.project_agent_id,
        // Org-level agent id (`agents.agent_id`), used by the UI
        // standalone-chat invalidator to force-refresh
        // `agentHistoryKey(agent_id)` when someone else writes into
        // this agent's session (e.g. the CEO via `send_to_agent`).
        // `Null` for project-scoped chat sessions.
        "agent_id": ctx.agent_id,
    }));
}

/// Publish an `assistant_message_end` event on the app-wide WebSocket
/// event bus after a successful persist. Same consumer story as
/// `publish_user_message_event`.
pub(super) fn publish_assistant_message_end_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "assistant_message_end",
        "message_id": message_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        "agent_instance_id": ctx.project_agent_id,
        "agent_id": ctx.agent_id,
    }));
}

/// Publish a heartbeat-style progress event on the WS bus for an
/// in-flight assistant turn. Carries no payload beyond the routing
/// keys so the chat-history-sync hook on the client can throttle
/// itself into a single force-refetch per emission and pull the
/// latest reconstructed partial turn from `events_to_session_history`
/// — rather than us trying to ship token-level deltas over the bus.
///
/// Throttled to at most ~one publish per
/// `ASSISTANT_TURN_PROGRESS_THROTTLE` (currently 400ms) inside
/// `spawn_chat_persist_task`. Final state is delivered by the
/// existing `assistant_message_end` publish, so a missed progress
/// event just means slightly later refresh; correctness is preserved.
pub(super) fn publish_assistant_turn_progress_event(
    bus: &tokio::sync::broadcast::Sender<serde_json::Value>,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    let _ = bus.send(serde_json::json!({
        "type": "assistant_turn_progress",
        "message_id": message_id,
        "session_id": ctx.session_id,
        "project_id": ctx.project_id,
        "project_agent_id": ctx.project_agent_id,
        "agent_instance_id": ctx.project_agent_id,
        "agent_id": ctx.agent_id,
    }));
}
