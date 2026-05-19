//! Live `ChatSession` registry helpers: probe for an alive entry on a
//! partition prefix, and sweep stale entries when a reset / cancel
//! lands.

use crate::state::AppState;

/// Phase 4 widened the chat-session registry from a single
/// `String → ChatSession` map to `(session_key, model) → ChatSession`,
/// so a partition may hold multiple alive entries (one per model the
/// caller has used). Callers here only care whether ANY entry on the
/// partition is alive / what storage session it belongs to; we walk
/// the DashMap and short-circuit on the first match.
pub(in super::super) async fn has_live_session(state: &AppState, key: &str) -> bool {
    state
        .chat_sessions
        .iter()
        .any(|entry| entry.key().session_key == key && entry.value().is_alive())
}

/// Drop EVERY chat-session entry whose `session_key` matches — or
/// is a per-session extension of — the given partition prefix,
/// regardless of model or storage session. Used by both
/// `reset_agent_session` (bare-template partition) and
/// `reset_instance_session` (instance partition) to evict every
/// per-session entry under one partition in a single sweep, since
/// after Phase 1 of parallel-session-chats the registry holds one
/// entry per `(template, instance|default, storage_session)` triple
/// instead of one per partition.
///
/// The helper is partition-shape-agnostic: callers pass whichever
/// `harness_agent_id` they own (two-segment bare-template, two-segment
/// instance, etc.) and the prefix sweep handles the three-segment
/// children uniformly.
///
/// The `==` branch covers the legacy two-segment form (callers that
/// did not opt into a session segment, e.g. before
/// `harness_agent_id` accepted a `SessionId`); the `starts_with`
/// branch covers every three-segment per-session entry.
pub(in super::super) async fn remove_live_sessions_for_partition(
    state: &AppState,
    partition: &str,
) {
    let prefix = format!("{partition}::");
    let stale_keys: Vec<crate::state::ChatSessionKey> = state
        .chat_sessions
        .iter()
        .filter(|entry| {
            entry.key().session_key == partition || entry.key().session_key.starts_with(&prefix)
        })
        .map(|entry| entry.key().clone())
        .collect();
    for stale in stale_keys {
        state.chat_sessions.remove(&stale);
    }
}
