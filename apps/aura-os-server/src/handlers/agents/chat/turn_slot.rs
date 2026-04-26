//! Per-partition turn slot: serializes user messages on a single
//! ChatSession partition so back-to-back sends queue instead of
//! racing the upstream harness turn-lock.
//!
//! Phase 3 of the robust-concurrent-agent-infra plan. The harness
//! enforces "one in-flight turn per agent_id". After Phase 1
//! `agent_id` is partitioned per AgentInstance, so cross-partition
//! traffic already runs in parallel; the remaining race is two
//! user messages arriving back-to-back on the SAME partition. The
//! WS writer accepts both into its mpsc, the harness rejects the
//! second with `code: turn_in_progress`, and Phase 2's SSE remap
//! cleans up the wording. This module prevents the race outright
//! by serializing the sends on the server side.
//!
//! Lifetime model: the HTTP handler returns immediately after
//! handing the SSE stream to axum, so a guard local to the handler
//! would unlock as soon as the first byte hit the wire. Instead we
//! hand the guard to a sentinel task that watches the harness
//! broadcast for the same terminal events the SSE forwarder treats
//! as `should_close` (`AssistantMessageEnd` / `Error`) and drops
//! the guard there, releasing the slot for the next queued turn.
//!
//! Queue depth is bounded at 1 waiter (1 in-flight + 1 queued = 2
//! concurrent acquirers). A third concurrent acquire returns
//! `Err(TurnSlotQueueFull)` so the orchestrator can surface
//! `ApiError::agent_busy { reason: "queue full" }` instead of
//! letting the mutex pile up unbounded.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use aura_os_harness::HarnessOutbound;
use tokio::sync::{broadcast, Mutex, OwnedMutexGuard};

/// Maximum simultaneous "in-flight + queued" turns on one partition.
/// One actively holding the lock plus at most one waiter; a third
/// concurrent acquirer is rejected up front.
pub(super) const MAX_PENDING_TURNS: usize = 2;

/// Returned by [`acquire_turn_slot`] when the partition already has
/// one turn in flight and one queued. The orchestrator translates
/// this into `ApiError::agent_busy` so callers see a structured
/// 409 instead of stacking unbounded behind the mutex.
#[derive(Debug)]
pub(super) struct TurnSlotQueueFull;

/// Successful reservation of the per-partition turn slot.
pub(super) struct TurnSlotAcquired {
    /// RAII guard that releases the slot on drop.
    pub(super) guard: TurnSlotGuard,
    /// `true` when the caller had to wait for an in-flight turn to
    /// finish before the lock became available; the orchestrator
    /// uses this to prepend the synthetic `progress: queued` SSE
    /// event so the UI can render "Queued behind current turn".
    pub(super) queued: bool,
}

/// Owns the partition mutex lock plus a strong reference to the
/// pending counter. Drop releases the mutex first so the next
/// waiter can proceed, then decrements the counter so a follow-on
/// `acquire_turn_slot` observes the correct queue depth.
pub(super) struct TurnSlotGuard {
    inner: Option<OwnedMutexGuard<()>>,
    counter: Arc<AtomicUsize>,
}

impl Drop for TurnSlotGuard {
    fn drop(&mut self) {
        self.inner.take();
        self.counter.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Reserve the partition's turn slot.
///
/// 1. Increments `counter`. If the pre-increment value is already
///    `>= MAX_PENDING_TURNS` (one running + one queued), rolls back
///    and returns [`TurnSlotQueueFull`].
/// 2. Probes `try_lock_owned`. On success the slot was free, so
///    `queued = false` and the guard is held without ever yielding.
///    On failure another turn is in flight; we await `lock_owned`
///    and report `queued = true`.
pub(super) async fn acquire_turn_slot(
    slot: Arc<Mutex<()>>,
    counter: Arc<AtomicUsize>,
) -> Result<TurnSlotAcquired, TurnSlotQueueFull> {
    let prev = counter.fetch_add(1, Ordering::AcqRel);
    if prev >= MAX_PENDING_TURNS {
        counter.fetch_sub(1, Ordering::AcqRel);
        return Err(TurnSlotQueueFull);
    }
    let (inner, queued) = match Arc::clone(&slot).try_lock_owned() {
        Ok(g) => (g, false),
        Err(_) => (slot.lock_owned().await, true),
    };
    Ok(TurnSlotAcquired {
        guard: TurnSlotGuard {
            inner: Some(inner),
            counter,
        },
        queued,
    })
}

/// Spawn a sentinel that holds `guard` until the broadcast emits a
/// terminal event (AssistantMessageEnd / Error) or closes. Drops
/// the guard so the next queued turn can proceed.
///
/// `Lagged` is treated as a continue: the persist task already
/// drains through lag and the SSE forwarder surfaces the synthetic
/// "stream lagged" event. For the turn-slot we only care about the
/// terminal boundary, and the broadcast `Closed` arm handles the
/// catastrophic case where the harness dropped the channel before
/// emitting one.
pub(super) fn spawn_turn_slot_release(
    guard: TurnSlotGuard,
    mut events_rx: broadcast::Receiver<HarnessOutbound>,
) {
    tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(HarnessOutbound::AssistantMessageEnd(_))
                | Ok(HarnessOutbound::Error(_)) => break,
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
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
        AssistantMessageEnd, ErrorMsg, FilesChanged, HarnessOutbound, SessionUsage,
    };
    use tokio::sync::{broadcast, Mutex};

    use super::{acquire_turn_slot, spawn_turn_slot_release, MAX_PENDING_TURNS};

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
        })
    }

    #[tokio::test]
    async fn acquire_turn_slot_returns_not_queued_when_slot_is_free() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("free slot should acquire");
        assert!(
            !acquired.queued,
            "queued must be false on an uncontended acquire"
        );
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 1);
        drop(acquired.guard);
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            0,
            "drop must decrement the pending counter"
        );
    }

    #[tokio::test]
    async fn acquire_turn_slot_returns_queued_when_slot_is_held() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire should succeed");
        assert!(!first.queued);

        let slot_clone = Arc::clone(&slot);
        let counter_clone = Arc::clone(&counter);
        let second_handle = tokio::spawn(async move {
            acquire_turn_slot(slot_clone, counter_clone)
                .await
                .expect("second acquire should eventually succeed")
        });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !second_handle.is_finished(),
            "second acquire must block while the slot is held"
        );

        drop(first.guard);

        let second = tokio::time::timeout(Duration::from_millis(200), second_handle)
            .await
            .expect("second acquire timed out")
            .expect("second acquire join failed");
        assert!(
            second.queued,
            "queued must be true when the slot was already held at entry"
        );
    }

    #[tokio::test]
    async fn acquire_turn_slot_rejects_third_concurrent_caller() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));

        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire");
        let second_slot = Arc::clone(&slot);
        let second_counter = Arc::clone(&counter);
        let second_handle = tokio::spawn(async move {
            acquire_turn_slot(second_slot, second_counter).await
        });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            MAX_PENDING_TURNS,
            "two acquirers must occupy the slot before the bound trips"
        );

        let third = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter)).await;
        assert!(
            third.is_err(),
            "third concurrent acquire must be rejected as queue-full"
        );
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            MAX_PENDING_TURNS,
            "rejected acquire must roll back its counter increment"
        );

        drop(first.guard);
        let second = second_handle
            .await
            .expect("second join")
            .expect("second acquire");
        drop(second.guard);
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn spawn_turn_slot_release_releases_on_assistant_message_end() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let acquired = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("acquire");
        let (events_tx, events_rx) = broadcast::channel(8);

        spawn_turn_slot_release(acquired.guard, events_rx);

        events_tx.send(assistant_end()).expect("send terminal event");

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

        spawn_turn_slot_release(acquired.guard, events_rx);

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

        spawn_turn_slot_release(acquired.guard, events_rx);

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
}
