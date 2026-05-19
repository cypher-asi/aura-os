//! Resolve a per-partition chat session: reuse the live registry
//! entry when one is alive, otherwise cold-open through the harness
//! `SessionBridge`. Owns the per-turn slot acquisition that prevents
//! the upstream `turn_in_progress` race.

use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use aura_os_core::HarnessMode;
use aura_os_harness::{
    HarnessCommandSender, HarnessOutbound, SessionBridge, SessionBridgeStarted, SessionBridgeTurn,
    SessionConfig,
};
use tokio::sync::{broadcast, Mutex};

use crate::error::{ApiError, ApiResult};
use crate::stability_metrics::StabilityMetrics;
use crate::state::{AppState, ChatSession, ChatSessionKey};

use super::super::errors::{map_session_bridge_error, map_session_bridge_start_error};
use super::super::turn_slot::{acquire_turn_slot, TurnSlotGuard};

/// Result of `get_or_create_delegated_chat_session`: a freshly opened
/// or reused chat session with its turn-slot guard already held by
/// the orchestrator.
pub(super) struct SessionForTurn {
    /// `true` when we cold-started the harness session in this call.
    /// Preserves the existing `progress: connecting` SSE prefix
    /// behaviour for first-turn UX.
    pub(super) is_new: bool,
    /// `true` when the per-partition turn slot was held when this
    /// call entered, i.e. the user message had to wait for the
    /// previous turn to terminate. Drives the new
    /// `progress: queued` SSE prefix.
    pub(super) was_queued: bool,
    /// SSE-bound receiver. The harness fan-out broadcast is wired
    /// here; the orchestrator resubscribes to feed the persist task
    /// and the turn-slot release sentinel.
    pub(super) rx: broadcast::Receiver<HarnessOutbound>,
    /// Sender paired with `rx`, used to broadcast synthetic terminal
    /// errors when the remote runtime goes silent while SSE keep-alives
    /// keep the HTTP connection open.
    pub(super) events_tx: broadcast::Sender<HarnessOutbound>,
    /// Held for the entire lifetime of this user turn; handed to a
    /// sentinel task that watches the broadcast for the terminal
    /// event and drops the guard there.
    pub(super) slot_guard: TurnSlotGuard,
    /// Cloned harness inbound mpsc sender for the live session. The
    /// SSE drop guard hands this to `spawn_turn_slot_release` via the
    /// early-release oneshot so a client disconnect (Stop or refresh)
    /// can forward `HarnessInbound::Cancel` and unstick the partition
    /// instead of letting the turn slot stay held until the next
    /// terminal event (which may never arrive on a cancelled
    /// long-running plan-mode turn).
    pub(super) commands_tx: HarnessCommandSender,
}

pub(super) async fn get_or_create_delegated_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    requested_model: Option<String>,
    turn: SessionBridgeTurn,
) -> ApiResult<SessionForTurn> {
    if let Some(reused) = try_reuse_session(state, key, &requested_model).await {
        return reuse_with_turn_slot(
            reused,
            turn,
            state.harness_ws_slots,
            Arc::clone(&state.stability_metrics),
        )
        .await;
    }

    let harness = state.harness_for(harness_mode);
    let session_agent_id = session_config.agent_id.clone();
    let session_template_agent_id = session_config.template_agent_id.clone();
    let t0 = std::time::Instant::now();
    tracing::info!(
        session_key = %key,
        harness_mode = ?harness_mode,
        "chat cold-open begin"
    );
    let open_fut = SessionBridge::open_and_send_user_message(harness, session_config, turn);
    let started = match tokio::time::timeout(std::time::Duration::from_secs(60), open_fut).await {
        Ok(result) => result.map_err(map_session_bridge_start_error(
            key,
            harness_mode,
            state.harness_ws_slots,
        ))?,
        Err(_elapsed) => {
            tracing::error!(
                elapsed_ms = t0.elapsed().as_millis() as u64,
                session_key = %key,
                "chat cold-open TIMEOUT — open_session hung past 60s"
            );
            return Err(ApiError::bad_gateway(
                "Harness did not open the session within 60s. Please retry or restart the harness.",
            ));
        }
    };
    tracing::info!(
        elapsed_ms = t0.elapsed().as_millis() as u64,
        session_key = %key,
        "chat cold-open complete"
    );
    insert_delegated_chat_session(
        state,
        key,
        requested_model,
        session_agent_id,
        session_template_agent_id,
        started,
    )
    .await
}

/// Handles the cloned turn-slot from an alive registry entry —
/// acquires the per-partition mutex (waiting if another turn is
/// in flight), maps queue-full to `ApiError::agent_busy`, and only
/// then forwards the user message into the harness mpsc. Sending
/// AFTER the slot is held is what prevents the upstream
/// `turn_in_progress` race.
async fn reuse_with_turn_slot(
    reused: ReusedSessionHandles,
    turn: SessionBridgeTurn,
    ws_slots_cap: usize,
    metrics: Arc<StabilityMetrics>,
) -> ApiResult<SessionForTurn> {
    let acquired = acquire_turn_slot(reused.turn_slot, reused.turn_pending_count)
        .await
        .map_err(|_| {
            metrics.inc_agent_busy_queue_full();
            ApiError::agent_busy(
                "Agent is busy: another turn is already running and one is queued.",
                None,
            )
        })?;
    SessionBridge::send_user_message(&reused.commands_tx, turn)
        .map_err(|err| map_session_bridge_error(err, ws_slots_cap))?;
    Ok(SessionForTurn {
        is_new: false,
        was_queued: acquired.queued,
        rx: reused.rx,
        events_tx: reused.events_tx,
        slot_guard: acquired.guard,
        commands_tx: reused.commands_tx,
    })
}

/// Cloned handles needed by `reuse_with_turn_slot` — taken while
/// holding the registry mutex briefly, then released so the slot
/// `await` does not block other partitions.
struct ReusedSessionHandles {
    rx: broadcast::Receiver<HarnessOutbound>,
    events_tx: broadcast::Sender<HarnessOutbound>,
    commands_tx: HarnessCommandSender,
    turn_slot: Arc<Mutex<()>>,
    turn_pending_count: Arc<AtomicUsize>,
}

async fn try_reuse_session(
    state: &AppState,
    key: &str,
    requested_model: &Option<String>,
) -> Option<ReusedSessionHandles> {
    // Phase 4: the registry is now keyed on `(session_key, model)`,
    // so two clients on the same partition picking different models
    // each get their own entry and never evict each other. The
    // `model_changed(...)` helper that used to wipe the resident
    // session whenever the requested model drifted is gone — its
    // job is taken over by the composite key lookup.
    let composite_key = ChatSessionKey::new(key, requested_model.clone());
    let entry = state.chat_sessions.get(&composite_key)?;
    if !entry.is_alive() {
        // Drop the `Ref` BEFORE removing the same key: DashMap shard
        // locks are non-reentrant, and remove() would deadlock if a
        // read guard for the same shard is still alive on this task.
        drop(entry);
        state.chat_sessions.remove(&composite_key);
        return None;
    }
    let handles = ReusedSessionHandles {
        rx: entry.events_tx.subscribe(),
        events_tx: entry.events_tx.clone(),
        commands_tx: entry.commands_tx.clone(),
        turn_slot: Arc::clone(&entry.turn_slot),
        turn_pending_count: Arc::clone(&entry.turn_pending_count),
    };
    // Drop the read `Ref` before the caller `await`s on the
    // turn-slot mutex — holding it across `.await` would block any
    // other partition that hashes onto the same DashMap shard.
    drop(entry);
    Some(handles)
}

async fn insert_delegated_chat_session(
    state: &AppState,
    key: &str,
    requested_model: Option<String>,
    session_agent_id: Option<String>,
    session_template_agent_id: Option<String>,
    started: SessionBridgeStarted,
) -> ApiResult<SessionForTurn> {
    // Build the per-partition turn slot up front and acquire it BEFORE
    // exposing the new session through the registry. The first user
    // message is already in flight via `open_and_send_user_message`,
    // so no other call can collide with us here — but a second
    // back-to-back send arriving the moment we publish the entry
    // MUST observe the slot as held, otherwise it would race the
    // first turn and trigger the upstream `turn_in_progress` error.
    let turn_slot = Arc::new(Mutex::new(()));
    let turn_pending_count = Arc::new(AtomicUsize::new(0));
    let acquired = acquire_turn_slot(Arc::clone(&turn_slot), Arc::clone(&turn_pending_count))
        .await
        .map_err(|_| {
            ApiError::internal("turn slot rejected fresh acquire — should be unreachable")
        })?;

    let rx = started.events_rx;
    let events_tx = started.session.events_tx.clone();
    let commands_tx = started.session.commands_tx.clone();
    let composite_key = ChatSessionKey::new(key, requested_model.clone());
    state.chat_sessions.insert(
        composite_key,
        ChatSession {
            session_id: started.session.session_id,
            commands_tx: started.session.commands_tx,
            events_tx: started.session.events_tx,
            model: requested_model,
            agent_id: session_agent_id,
            template_agent_id: session_template_agent_id,
            turn_slot,
            turn_pending_count,
        },
    );
    Ok(SessionForTurn {
        is_new: true,
        was_queued: false,
        rx,
        events_tx,
        slot_guard: acquired.guard,
        commands_tx,
    })
}
