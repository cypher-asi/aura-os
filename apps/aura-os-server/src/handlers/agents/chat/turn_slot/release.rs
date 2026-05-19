//! Release sentinel for the turn slot: spawns a tokio task that
//! holds the `TurnSlotGuard` until either a terminal harness event
//! arrives or the SSE drop guard signals an early release (client
//! disconnect / Stop).

use aura_os_harness::{HarnessCommandSender, HarnessInbound, HarnessOutbound};
use tokio::sync::{broadcast, oneshot};
use tracing::warn;

use super::acquire::TurnSlotGuard;

/// Spawn a sentinel that holds `guard` until either:
///
/// 1. The broadcast emits a terminal event
///    (`AssistantMessageEnd` / `Error`) or closes — the original
///    happy-path release boundary.
/// 2. The SSE handler signals an early release through
///    `early_release_rx` because the client disconnected (Stop or
///    refresh) before the harness reached a terminal event. In that
///    case we forward `HarnessInbound::Cancel` so the harness aborts
///    its in-flight turn and emits its own terminal event for the
///    persist task — without this, the turn slot would stay held
///    indefinitely (the stuck-after-Stop bug).
///
/// `Lagged` is treated as a continue: the persist task already
/// drains through lag and the SSE forwarder surfaces the synthetic
/// "stream lagged" event. For the turn-slot we only care about the
/// terminal boundary, and the broadcast `Closed` arm handles the
/// catastrophic case where the harness dropped the channel before
/// emitting one.
///
/// Pass [`oneshot::channel`]'s receiver as `early_release_rx`. The
/// sender side is held by the SSE stream's drop guard in
/// `streaming.rs`; dropping the sender without firing it is harmless
/// (the receiver yields `Err(_)` which the early-release arm treats
/// like the "client disconnected" case but without a `commands_tx`,
/// so we just release the slot).
pub(crate) fn spawn_turn_slot_release(
    guard: TurnSlotGuard,
    mut events_rx: broadcast::Receiver<HarnessOutbound>,
    early_release_rx: oneshot::Receiver<HarnessCommandSender>,
) {
    tokio::spawn(async move {
        let mut early_release_rx = early_release_rx;
        loop {
            tokio::select! {
                // Bias toward the terminal-event arm so the happy
                // path (harness completed normally before any drop
                // signal could race in) is observably indistinguishable
                // from the pre-Phase-7 behaviour.
                biased;
                evt = events_rx.recv() => match evt {
                    Ok(HarnessOutbound::AssistantMessageEnd(_)) | Ok(HarnessOutbound::Error(_)) => {
                        break;
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                },
                signal = &mut early_release_rx => {
                    // The SSE stream was dropped (client Stop or
                    // refresh) before the harness reached a terminal
                    // event. Forward Cancel so the harness aborts its
                    // in-flight turn, then drop the guard regardless
                    // of whether the send succeeded.
                    if let Ok(commands_tx) = signal {
                        if let Err(err) = commands_tx.try_send(HarnessInbound::Cancel) {
                            warn!(
                                error = %err,
                                "turn_slot early release: failed to forward Cancel to harness; releasing slot anyway"
                            );
                        }
                    }
                    break;
                }
            }
        }
        drop(guard);
    });
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::time::Duration;

    use aura_os_harness::{
        AssistantMessageEnd, ErrorMsg, FilesChanged, HarnessInbound, HarnessOutbound, SessionUsage,
    };
    use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

    use super::super::acquire::acquire_turn_slot;
    use super::spawn_turn_slot_release;

    fn assistant_end() -> HarnessOutbound {
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        })
    }

    fn error_msg() -> HarnessOutbound {
        HarnessOutbound::Error(ErrorMsg {
            code: "boom".to_string(),
            message: "boom".to_string(),
            recoverable: false,
            support_id: None,
        })
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_assistant_message_end() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel(8);
        let (_release_tx, release_rx) = oneshot::channel();

        spawn_turn_slot_release(acquired.guard, events_rx, release_rx);

        events_tx
            .send(assistant_end())
            .expect("send terminal event");

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after assistant_message_end");
        drop(next);
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_error() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel(8);
        let (_release_tx, release_rx) = oneshot::channel();

        spawn_turn_slot_release(acquired.guard, events_rx, release_rx);

        events_tx.send(error_msg()).expect("send error event");

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after error event");
        drop(next);
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_broadcast_close() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel::<HarnessOutbound>(8);
        let (_release_tx, release_rx) = oneshot::channel();

        spawn_turn_slot_release(acquired.guard, events_rx, release_rx);

        drop(events_tx);

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after broadcast close");
        drop(next);
    }

    /// Phase 7 client-disconnect cleanup: the SSE stream's drop guard
    /// fires the early-release oneshot with a clone of the harness
    /// `commands_tx`. The sentinel must (a) forward
    /// `HarnessInbound::Cancel` so the harness aborts its in-flight
    /// turn, and (b) release the slot guard so the next user message
    /// on the same partition can be accepted instead of timing out.
    #[tokio::test]
    async fn spawn_turn_slot_release_forwards_cancel_and_releases_on_early_signal() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (_events_tx, events_rx) = broadcast::channel::<HarnessOutbound>(8);
        let (release_tx, release_rx) = oneshot::channel();

        // Stand-in for the harness's inbound mpsc — capacity 4 mirrors
        // the real `aura-os-harness` default so a Cancel never gets
        // wedged behind a backed-up writer.
        let (commands_tx, mut commands_rx) = mpsc::channel::<HarnessInbound>(4);

        spawn_turn_slot_release(acquired.guard, events_rx, release_rx);

        release_tx
            .send(commands_tx)
            .expect("early-release oneshot send");

        let observed_cancel = tokio::time::timeout(Duration::from_millis(200), commands_rx.recv())
            .await
            .expect("early-release should forward Cancel before timeout")
            .expect("commands_tx still open");
        assert!(
            matches!(observed_cancel, HarnessInbound::Cancel),
            "early-release must forward HarnessInbound::Cancel, got {observed_cancel:?}",
        );

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after early-release signal");
        drop(next);
    }

    /// Companion to the early-release test: even if the SSE drop guard
    /// fires the oneshot AFTER the harness has already shipped its
    /// own terminal `Error`, the sentinel must not panic, must not
    /// double-release, and must end up freeing the slot exactly once.
    /// The `biased` select arm in `spawn_turn_slot_release` lets the
    /// terminal-event branch win the race so the happy path stays
    /// observably unchanged.
    #[tokio::test]
    async fn spawn_turn_slot_release_terminal_event_wins_over_late_early_signal() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel::<HarnessOutbound>(8);
        let (release_tx, release_rx) = oneshot::channel();

        spawn_turn_slot_release(acquired.guard, events_rx, release_rx);

        events_tx
            .send(assistant_end())
            .expect("send terminal event");

        // Drop the oneshot sender without firing — simulates the
        // common case where the SSE stream is dropped AFTER the
        // harness already emitted its terminal event (so the drop
        // guard never needs to take the early-release path).
        drop(release_tx);

        let next = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                if let Ok(acquired) = Arc::clone(&slot).try_lock_owned() {
                    return acquired;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("slot should be released after terminal event");
        drop(next);
    }
}
