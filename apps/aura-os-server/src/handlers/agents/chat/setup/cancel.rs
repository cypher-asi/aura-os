//! Cancel-turn HTTP endpoints + partition-level cancel sweep that
//! forwards `HarnessInbound::Cancel` to every live `ChatSession` under
//! a partition prefix and evicts them so the next user message
//! cold-starts a fresh harness session.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_harness::HarnessInbound;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use tracing::{info, warn};

use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

/// Sweep every chat-session entry under `partition` and forward
/// [`HarnessInbound::Cancel`] to each one's harness command channel,
/// then evict the entries from the registry.
///
/// Phase 7 cancel-turn flow: the explicit `/cancel-turn` HTTP routes
/// land here, and the SSE drop guard in `streaming.rs` performs the
/// equivalent cleanup directly through the slot-release sentinel
/// (single live entry, no full registry sweep) — both paths
/// converge on the same harness contract:
///
/// 1. **Forward `Cancel`** so the harness aborts its in-flight turn
///    and emits its own terminal event for the persist task. Without
///    this, a long-running plan-mode turn full of non-terminal
///    `Progress` heartbeats can keep the per-partition turn slot
///    held indefinitely (the stuck-after-Stop bug).
/// 2. **Evict the warm session**. Forces the next user message on
///    the same partition to cold-start with a fresh harness session
///    and replay history through the latest compaction logic, instead
///    of reusing the wedged session whose `acquire_turn_slot` may
///    block until a 90s SSE idle timeout.
///
/// Best-effort throughout. A `try_send` failure (channel closed,
/// queue full) is logged and swallowed; the registry eviction still
/// proceeds so the next request always cold-starts cleanly.
///
/// Same partition-shape contract as
/// `remove_live_sessions_for_partition`: pass either the
/// two-segment bare-template / bare-instance partition or any
/// three-segment per-session prefix and the sweep handles the
/// children uniformly.
pub(in super::super) async fn cancel_live_sessions_for_partition(
    state: &AppState,
    partition: &str,
) {
    cancel_live_sessions_in_registry(&state.chat_sessions, partition).await;
}

/// Registry-only worker for [`cancel_live_sessions_for_partition`].
/// Pulled out so unit tests can exercise the harness-cancel + evict
/// behaviour against a hand-built `ChatSessionRegistry` without
/// having to construct a full [`AppState`] (which threads through
/// every aura-os service binding and is impractical to fake at the
/// chat-handler unit-test layer).
pub(in super::super) async fn cancel_live_sessions_in_registry(
    registry: &crate::state::ChatSessionRegistry,
    partition: &str,
) {
    let prefix = format!("{partition}::");
    let matching_keys: Vec<crate::state::ChatSessionKey> = registry
        .iter()
        .filter(|entry| {
            entry.key().session_key == partition || entry.key().session_key.starts_with(&prefix)
        })
        .map(|entry| entry.key().clone())
        .collect();

    for key in &matching_keys {
        if let Some(entry) = registry.get(key) {
            // Cloning the sender is cheap (mpsc::Sender is an Arc
            // under the hood) and lets us drop the registry `Ref`
            // before awaiting / mutating the map.
            let commands_tx = entry.commands_tx.clone();
            drop(entry);
            if let Err(err) = commands_tx.try_send(HarnessInbound::Cancel) {
                warn!(
                    partition,
                    session_key = %key.session_key,
                    error = %err,
                    "cancel-turn: failed to forward Cancel to harness; evicting registry entry anyway"
                );
            } else {
                info!(
                    partition,
                    session_key = %key.session_key,
                    "cancel-turn: forwarded Cancel to harness"
                );
            }
        }
    }

    // Evict every matching entry so the next user message cold-starts
    // a fresh harness session instead of reusing the cancelled one.
    // Inlined the same partition-shape rules as
    // `remove_live_sessions_for_partition` so the helper can run on a
    // bare `ChatSessionRegistry` without going through `AppState`.
    let stale_keys: Vec<crate::state::ChatSessionKey> = registry
        .iter()
        .filter(|entry| {
            entry.key().session_key == partition || entry.key().session_key.starts_with(&prefix)
        })
        .map(|entry| entry.key().clone())
        .collect();
    for stale in stale_keys {
        registry.remove(&stale);
    }
}

/// `POST /api/agents/:agent_id/cancel-turn`
///
/// Phase 7 Stop / refresh cleanup: forward
/// [`HarnessInbound::Cancel`] to every live `ChatSession` on the
/// bare-template partition and evict them so the next user message
/// cold-starts with a fresh harness session. Idempotent — calling it
/// when no live session exists is a no-op (and still returns 204).
///
/// Counterpart to `reset_agent_session` but intentionally lighter:
/// `reset-session` is a destructive admin op that mints a brand-new
/// storage session row for the next turn; `cancel-turn` only unsticks
/// the partition so a stuck turn no longer blocks subsequent sends,
/// keeping the storage session continuity.
pub(crate) async fn cancel_agent_turn(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<StatusCode> {
    let partition = aura_os_core::harness_agent_id(&agent_id, None, None);
    cancel_live_sessions_for_partition(&state, &partition).await;
    info!(%agent_id, "Agent chat turn cancelled");
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/projects/:project_id/agents/:agent_instance_id/cancel-turn`
///
/// Phase 7 Stop / refresh cleanup for the project / instance chat
/// route. Resolves the parent template id so the partition prefix
/// matches the `{template}::{instance}::{session_id}` shape the chat
/// route stores under, then sweeps every per-session entry under that
/// instance.
///
/// Counterpart to `reset_instance_session`; see [`cancel_agent_turn`]
/// for the contract distinction.
pub(crate) async fn cancel_instance_turn(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<StatusCode> {
    let live_session_key = match state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
    {
        Ok(instance) => Some(aura_os_core::harness_agent_id(
            &instance.agent_id,
            Some(&agent_instance_id),
            None,
        )),
        Err(e) => {
            warn!(
                %project_id,
                %agent_instance_id,
                error = %e,
                "Instance cancel-turn: cannot resolve parent template; skipping in-memory cleanup",
            );
            None
        }
    };
    if let Some(key) = live_session_key {
        cancel_live_sessions_for_partition(&state, &key).await;
    }
    info!(%agent_instance_id, "Instance chat turn cancelled");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    //! Phase 7 `cancel-turn` cleanup contract: pin the harness-cancel
    //! forwarding and registry eviction so a stuck Stop can never
    //! wedge the per-partition turn slot.
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::time::Duration;

    use aura_os_harness::{HarnessInbound, HarnessOutbound};
    use dashmap::DashMap;
    use tokio::sync::{broadcast, mpsc, Mutex};

    use crate::state::{ChatSession, ChatSessionKey, ChatSessionRegistry};

    use super::cancel_live_sessions_in_registry;

    /// Inserts a `ChatSession` whose harness `commands_tx` is wired
    /// to a stand-in mpsc receiver the test can drain. Returns the
    /// receiver alongside the registry insertion key so the caller
    /// can assert what (if anything) was forwarded to the harness.
    fn insert_fake_chat_session(
        registry: &ChatSessionRegistry,
        session_key: &str,
    ) -> mpsc::Receiver<HarnessInbound> {
        let (commands_tx, commands_rx) = mpsc::channel::<HarnessInbound>(4);
        let (events_tx, _events_rx) = broadcast::channel::<HarnessOutbound>(8);
        registry.insert(
            ChatSessionKey::new(session_key, None),
            ChatSession {
                session_id: format!("session-{session_key}"),
                commands_tx,
                events_tx,
                model: None,
                agent_id: Some(session_key.to_string()),
                template_agent_id: None,
                turn_slot: Arc::new(Mutex::new(())),
                turn_pending_count: Arc::new(AtomicUsize::new(0)),
            },
        );
        commands_rx
    }

    /// Phase 7 cancel-turn contract: the helper must forward
    /// `HarnessInbound::Cancel` to the live session's command channel
    /// AND evict the registry entry so a subsequent send cold-starts
    /// a fresh session instead of reusing the cancelled one.
    #[tokio::test]
    async fn cancel_live_sessions_forwards_cancel_and_evicts_partition_entry() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        let partition = "agent-template::ai-1::session-x";
        let mut commands_rx = insert_fake_chat_session(&registry, partition);

        cancel_live_sessions_in_registry(&registry, partition).await;

        let observed = tokio::time::timeout(Duration::from_millis(100), commands_rx.recv())
            .await
            .expect("Cancel must be forwarded before timeout")
            .expect("commands_tx still open");
        assert!(
            matches!(observed, HarnessInbound::Cancel),
            "cancel-turn must forward HarnessInbound::Cancel; got {observed:?}",
        );

        assert!(
            registry
                .get(&ChatSessionKey::new(partition, None))
                .is_none(),
            "cancel-turn must evict the partition entry so the next user message cold-starts",
        );
    }

    /// Three-segment per-session entries (the per-`session_id` prefix
    /// the chat routes write under after Phase 1 of parallel-session
    /// chats) must all be swept when the caller passes the two-segment
    /// `{template}::{instance}` partition prefix — same contract as
    /// `remove_live_sessions_for_partition`. Without this the cancel
    /// would unstick exactly one session and leave its siblings under
    /// the same instance still wedged.
    #[tokio::test]
    async fn cancel_live_sessions_sweeps_three_segment_session_children() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        let instance_partition = "agent-template::ai-1";
        let session_a = "agent-template::ai-1::session-a";
        let session_b = "agent-template::ai-1::session-b";
        let unrelated = "agent-template::ai-2::session-z";

        let mut commands_rx_a = insert_fake_chat_session(&registry, session_a);
        let mut commands_rx_b = insert_fake_chat_session(&registry, session_b);
        let _commands_rx_unrelated = insert_fake_chat_session(&registry, unrelated);

        cancel_live_sessions_in_registry(&registry, instance_partition).await;

        // Both three-segment children must observe a forwarded Cancel.
        for (label, rx) in [
            ("session-a", &mut commands_rx_a),
            ("session-b", &mut commands_rx_b),
        ] {
            let observed = tokio::time::timeout(Duration::from_millis(100), rx.recv())
                .await
                .unwrap_or_else(|_| panic!("{label} must observe forwarded Cancel"))
                .expect("commands_tx still open");
            assert!(
                matches!(observed, HarnessInbound::Cancel),
                "{label} must observe HarnessInbound::Cancel; got {observed:?}",
            );
        }

        // ...and the eviction sweep must drop both children but leave
        // the unrelated sibling instance alone (sharing only a template
        // prefix is not enough to belong to this partition).
        assert!(registry
            .get(&ChatSessionKey::new(session_a, None))
            .is_none());
        assert!(registry
            .get(&ChatSessionKey::new(session_b, None))
            .is_none());
        assert!(
            registry
                .get(&ChatSessionKey::new(unrelated, None))
                .is_some(),
            "cancel-turn for ai-1 must NOT touch sibling instance ai-2 — partition prefix is exact",
        );
    }

    /// Idempotency guard: calling `cancel-turn` against a partition
    /// that has no live registry entries is a no-op (and must not
    /// panic). Backs the `204 No Content` semantics of the public
    /// `/cancel-turn` HTTP routes when no chat is in flight.
    #[tokio::test]
    async fn cancel_live_sessions_is_a_noop_on_empty_partition() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        // Insert an entry on a different partition to prove the sweep
        // is scoped: the unrelated entry must survive intact.
        let unrelated = "agent-template-other::ai-z::session-z";
        let _commands_rx = insert_fake_chat_session(&registry, unrelated);

        cancel_live_sessions_in_registry(&registry, "missing-template::ai-x").await;

        assert!(
            registry
                .get(&ChatSessionKey::new(unrelated, None))
                .is_some(),
            "cancel-turn for an empty partition must not evict unrelated entries",
        );
    }
}
