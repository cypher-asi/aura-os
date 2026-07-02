//! Resolve a per-partition chat session: reuse the live registry
//! entry when one is alive, otherwise cold-open through the harness
//! `SessionBridge`. Owns the per-turn slot acquisition that prevents
//! the upstream `turn_in_progress` race.

use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use aura_os_core::HarnessMode;
use aura_os_harness::{
    CouncilPresentation, HarnessCommandSender, HarnessOutbound, SessionBridge,
    SessionBridgeStarted, SessionBridgeTurn, SessionConfig,
};
use tokio::sync::{broadcast, Mutex};

use crate::error::{ApiError, ApiResult};
use crate::stability_metrics::StabilityMetrics;
use crate::state::{AppState, ChatSession, ChatSessionKey, ChatSessionRegistry};

use super::super::errors::{map_session_bridge_error, map_session_bridge_start_error};
use super::super::turn_slot::{acquire_turn_slot, TurnSlotGuard};

/// Default wall-clock cap for cold-opening a harness chat session when
/// `AURA_COLD_OPEN_TIMEOUT_SECS` is unset or invalid.
///
/// Cold-open has to wake a possibly-hibernated remote microVM, complete
/// the swarm HTTP handshake, connect the run WebSocket, and wait for
/// `session_ready` — steps that nest their own ~90s ready poll and ~20s
/// `session_ready` wait. The previous hard `60s` cap routinely 502'd a
/// legitimate wake before those nested steps finished. `180s` covers the
/// realistic worst case while still failing a genuinely dead harness in
/// a few minutes. Tune with `AURA_COLD_OPEN_TIMEOUT_SECS` (`0`/invalid
/// falls back to this default).
const DEFAULT_COLD_OPEN_TIMEOUT_SECS: u64 = 180;

/// Resolve the cold-open wall-clock cap from `AURA_COLD_OPEN_TIMEOUT_SECS`,
/// cached after first read. Falls back to [`DEFAULT_COLD_OPEN_TIMEOUT_SECS`]
/// when unset, unparsable, or zero.
fn cold_open_timeout() -> std::time::Duration {
    static CACHED: std::sync::OnceLock<std::time::Duration> = std::sync::OnceLock::new();
    *CACHED.get_or_init(|| {
        let secs = std::env::var("AURA_COLD_OPEN_TIMEOUT_SECS")
            .ok()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(DEFAULT_COLD_OPEN_TIMEOUT_SECS);
        std::time::Duration::from_secs(secs)
    })
}

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
    /// Cloned harness inbound mpsc sender for the live session. Handed
    /// to the registered reattachable live stream so an explicit cancel
    /// can forward `HarnessInbound::Cancel` to the upstream turn. (A
    /// passive SSE disconnect no longer cancels the turn — see
    /// `spawn_turn_slot_release`; explicit Stop cancels via
    /// `setup/cancel.rs`.)
    pub(super) commands_tx: HarnessCommandSender,
    /// Subagent frames (`SubagentSpawned` / `SubagentStatus`) the harness
    /// emitted before `session_ready`, captured at cold-open because no
    /// consumer was subscribed yet. The orchestrator replays them onto
    /// `events_tx` after every consumer subscribes so AURA Council member
    /// columns render live and persist. Empty for warm reuse and for runs
    /// that emit no subagent frames during init.
    pub(super) pending_events: Vec<HarnessOutbound>,
    /// Optional presentation override for this turn's council-style
    /// subagent events. Second Opinion uses the council runtime but
    /// needs its spawned model passes to render under a distinct label.
    pub(super) council_presentation: Option<CouncilPresentation>,
}

pub(super) async fn get_or_create_delegated_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    requested_model: Option<String>,
    turn: SessionBridgeTurn,
) -> ApiResult<SessionForTurn> {
    // Snapshot the effort before `session_config` is moved into the
    // cold-open path: it joins `(session_key, model)` as the third
    // axis of the registry key so an effort change re-opens the
    // session instead of reusing one pinned to the prior level.
    let requested_effort = session_config.reasoning_effort.clone();
    // AURA Council sends must NEVER reuse a warm session. A resident
    // entry was opened as a single-model `Chat` runtime request and
    // reuse only forwards a bare `UserMessage`, which can never turn it
    // into a `Council` run (no member fan-out, no synthesizer). The
    // harness mints a fresh parent run per council request anyway, so we
    // force a cold open whenever council is active and let this turn
    // open its own `Council` session.
    let council_active = session_config.council.is_some();
    let council_presentation = session_config.council_presentation;
    if !council_active {
        if let Some(reused) =
            try_reuse_session(state, key, &requested_model, &requested_effort).await
        {
            return reuse_with_turn_slot(
                reused,
                turn,
                state.harness_ws_slots,
                Arc::clone(&state.stability_metrics),
            )
            .await;
        }
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
    // AURA Council parent runs are driven entirely by the harness
    // council orchestrator: the query rides in the request's
    // `conversation_messages` and the orchestrator injects the single
    // synthesis turn. Forwarding the user message here would run a
    // spurious single-model turn on the synthesizer ahead of the
    // council, so council cold-opens open-only.
    let open_fut: std::pin::Pin<Box<dyn std::future::Future<Output = _> + Send>> = if council_active
    {
        Box::pin(SessionBridge::open(harness, session_config))
    } else {
        Box::pin(SessionBridge::open_and_send_user_message(
            harness,
            session_config,
            turn,
        ))
    };
    let cold_open = cold_open_timeout();
    let started = match tokio::time::timeout(cold_open, open_fut).await {
        Ok(result) => result.map_err(map_session_bridge_start_error(
            key,
            harness_mode,
            state.harness_ws_slots,
        ))?,
        Err(_elapsed) => {
            tracing::error!(
                elapsed_ms = t0.elapsed().as_millis() as u64,
                session_key = %key,
                cold_open_secs = cold_open.as_secs(),
                "chat cold-open TIMEOUT — open_session hung past cold-open cap"
            );
            return Err(ApiError::bad_gateway(format!(
                "Harness did not open the session within {}s. Please retry or restart the harness.",
                cold_open.as_secs(),
            )));
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
        requested_effort,
        session_agent_id,
        session_template_agent_id,
        started,
        council_presentation,
        !council_active,
    )
    .await
}

pub(super) fn apply_council_presentation_to_event(
    evt: HarnessOutbound,
    presentation: Option<CouncilPresentation>,
) -> HarnessOutbound {
    let Some(presentation) = presentation else {
        return evt;
    };
    match evt {
        HarnessOutbound::SubagentSpawned(mut spawned) if spawned.council_index.is_some() => {
            spawned.subagent_type = presentation.subagent_type().to_string();
            HarnessOutbound::SubagentSpawned(spawned)
        }
        other => other,
    }
}

fn apply_council_presentation(
    pending_events: Vec<HarnessOutbound>,
    presentation: Option<CouncilPresentation>,
) -> Vec<HarnessOutbound> {
    pending_events
        .into_iter()
        .map(|evt| apply_council_presentation_to_event(evt, presentation))
        .collect()
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
        // Warm reuse never cold-opens, so there are no pre-`session_ready`
        // frames to replay. AURA Council always forces a cold open (see
        // `council_active` above), so this path is never a council turn.
        pending_events: Vec::new(),
        council_presentation: None,
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
    requested_effort: &Option<String>,
) -> Option<ReusedSessionHandles> {
    // Phase 4: the registry is now keyed on `(session_key, model)`,
    // so two clients on the same partition picking different models
    // each get their own entry and never evict each other. The
    // `model_changed(...)` helper that used to wipe the resident
    // session whenever the requested model drifted is gone — its
    // job is taken over by the composite key lookup. The
    // reasoning-effort tier is folded in as a third axis so a
    // thinking-level change also lands on its own entry (and
    // cold-opens with the new effort) rather than reusing a session
    // pinned to the previous level.
    let composite_key =
        ChatSessionKey::with_effort(key, requested_model.clone(), requested_effort.clone());
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
    requested_effort: Option<String>,
    session_agent_id: Option<String>,
    session_template_agent_id: Option<String>,
    started: SessionBridgeStarted,
    council_presentation: Option<CouncilPresentation>,
    register_warm_session: bool,
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
    // Move the captured pre-`session_ready` subagent frames out of the
    // session before its remaining fields are consumed into the registry
    // entry below; the orchestrator replays these onto `events_tx`.
    let pending_events =
        apply_council_presentation(started.session.pending_events, council_presentation);
    maybe_register_warm_chat_session(
        &state.chat_sessions,
        key,
        requested_model.clone(),
        requested_effort,
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
        register_warm_session,
    );
    Ok(SessionForTurn {
        is_new: true,
        was_queued: false,
        rx,
        events_tx,
        slot_guard: acquired.guard,
        commands_tx,
        pending_events,
        council_presentation,
    })
}

fn maybe_register_warm_chat_session(
    registry: &ChatSessionRegistry,
    key: &str,
    requested_model: Option<String>,
    requested_effort: Option<String>,
    session: ChatSession,
    register_warm_session: bool,
) {
    if !register_warm_session {
        return;
    }
    let composite_key = ChatSessionKey::with_effort(key, requested_model, requested_effort);
    registry.insert(composite_key, session);
}

#[cfg(test)]
mod tests {
    use super::*;
    use dashmap::DashMap;

    #[test]
    fn apply_council_presentation_labels_second_opinion_spawns() {
        let events = vec![HarnessOutbound::SubagentSpawned(
            aura_os_harness::SubagentSpawned {
                child_run_id: "child-1".to_string(),
                parent_tool_use_id: Some("toolu_1".to_string()),
                subagent_type: "council-member".to_string(),
                prompt: "review".to_string(),
                model: Some("final-model".to_string()),
                council_index: Some(0),
                council_mechanism: Some("synthesize".to_string()),
            },
        )];

        let patched = apply_council_presentation(events, Some(CouncilPresentation::SecondOpinion));

        match &patched[0] {
            HarnessOutbound::SubagentSpawned(spawned) => {
                assert_eq!(spawned.subagent_type, "second-opinion");
                assert_eq!(spawned.council_index, Some(0));
            }
            other => panic!("expected subagent spawn, got {other:?}"),
        }
    }

    fn test_chat_session(id: &str) -> ChatSession {
        let (commands_tx, _commands_rx) = tokio::sync::mpsc::channel(1);
        let (events_tx, _events_rx) = broadcast::channel(1);
        ChatSession {
            session_id: id.to_string(),
            commands_tx,
            events_tx,
            model: Some("sonnet".to_string()),
            agent_id: Some("agent::default".to_string()),
            template_agent_id: Some("agent".to_string()),
            turn_slot: Arc::new(Mutex::new(())),
            turn_pending_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    #[test]
    fn council_turns_do_not_register_warm_sessions() {
        let registry: ChatSessionRegistry = Arc::new(DashMap::new());
        let key = "agent::default::session-a";
        let model = Some("sonnet".to_string());
        let effort = Some("high".to_string());

        maybe_register_warm_chat_session(
            &registry,
            key,
            model.clone(),
            effort.clone(),
            test_chat_session("second-opinion-parent"),
            false,
        );

        assert!(
            registry
                .get(&ChatSessionKey::with_effort(
                    key,
                    model.clone(),
                    effort.clone()
                ))
                .is_none(),
            "Second Opinion/Council parents must not become reusable warm chat sessions"
        );

        maybe_register_warm_chat_session(
            &registry,
            key,
            model.clone(),
            effort.clone(),
            test_chat_session("normal-chat"),
            true,
        );

        let stored = registry
            .get(&ChatSessionKey::with_effort(key, model, effort))
            .expect("normal chat should still register a reusable warm session");
        assert_eq!(stored.session_id, "normal-chat");
    }
}
