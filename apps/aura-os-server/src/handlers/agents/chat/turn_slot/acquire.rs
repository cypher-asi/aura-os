//! Per-partition turn-slot acquire: an `Arc<Mutex<()>>` mutex plus an
//! `AtomicUsize` queue counter, with a cap on in-flight + queued
//! acquirers so a partition can never grow an unbounded lock-pile.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, OwnedMutexGuard};

use super::config::max_pending_turns;

/// Returned by [`acquire_turn_slot`] when the partition already has
/// one turn in flight and one queued. The orchestrator translates
/// this into `ApiError::agent_busy` so callers see a structured
/// 409 instead of stacking unbounded behind the mutex.
#[derive(Debug)]
pub struct TurnSlotQueueFull;

/// Successful reservation of the per-partition turn slot.
pub struct TurnSlotAcquired {
    /// RAII guard that releases the slot on drop.
    pub guard: TurnSlotGuard,
    /// `true` when the caller had to wait for an in-flight turn to
    /// finish before the lock became available; the orchestrator
    /// uses this to prepend the synthetic `progress: queued` SSE
    /// event so the UI can render "Queued behind current turn".
    pub queued: bool,
}

/// Owns the partition mutex lock plus a strong reference to the
/// pending counter. Drop releases the mutex first so the next
/// waiter can proceed, then decrements the counter so a follow-on
/// `acquire_turn_slot` observes the correct queue depth.
pub struct TurnSlotGuard {
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
///    `>= max_pending_turns()` (one running + N-1 queued), rolls back
///    and returns [`TurnSlotQueueFull`].
/// 2. Probes `try_lock_owned`. On success the slot was free, so
///    `queued = false` and the guard is held without ever yielding.
///    On failure another turn is in flight; we await `lock_owned`
///    and report `queued = true`.
pub async fn acquire_turn_slot(
    slot: Arc<Mutex<()>>,
    counter: Arc<AtomicUsize>,
) -> Result<TurnSlotAcquired, TurnSlotQueueFull> {
    acquire_turn_slot_with_cap(slot, counter, max_pending_turns()).await
}

/// Test-friendly variant of [`acquire_turn_slot`] that takes the cap
/// directly so unit tests can pin the queue depth without going
/// through the `AURA_PARTITION_TURN_QUEUE` env-var lifecycle. The
/// public entry point delegates here with the cached env-driven cap.
pub(crate) async fn acquire_turn_slot_with_cap(
    slot: Arc<Mutex<()>>,
    counter: Arc<AtomicUsize>,
    cap: usize,
) -> Result<TurnSlotAcquired, TurnSlotQueueFull> {
    let prev = counter.fetch_add(1, Ordering::AcqRel);
    if prev >= cap {
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

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::sync::Mutex;

    use super::super::config::{max_pending_turns, DEFAULT_MAX_PENDING_TURNS};
    use super::{acquire_turn_slot, acquire_turn_slot_with_cap};

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
    async fn acquire_turn_slot_rejects_caller_past_default_cap() {
        // Phase 4 raised the partition cap from 2 to 4 (1 running + 3
        // queued by default). Saturate the slot at the new cap, then
        // confirm the (cap+1)th acquire is rejected as queue-full.
        //
        // Note: each queued acquirer holds the slot mutex inside its
        // returned `TurnSlotAcquired`; we drain them one-at-a-time and
        // drop each guard immediately so the next waiter can take the
        // lock. Without that drop the next `handle.await` would wedge
        // forever because the lock is still held.
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));

        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire");

        let mut queued_handles = Vec::new();
        for _ in 1..DEFAULT_MAX_PENDING_TURNS {
            let slot_clone = Arc::clone(&slot);
            let counter_clone = Arc::clone(&counter);
            queued_handles.push(tokio::spawn(async move {
                acquire_turn_slot(slot_clone, counter_clone).await
            }));
        }

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            DEFAULT_MAX_PENDING_TURNS,
            "all acquirers must occupy the slot before the bound trips"
        );

        let overflow = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter)).await;
        assert!(
            overflow.is_err(),
            "concurrent acquire past the default cap must be rejected as queue-full"
        );
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            DEFAULT_MAX_PENDING_TURNS,
            "rejected acquire must roll back its counter increment"
        );

        drop(first.guard);
        for handle in queued_handles {
            let acquired = tokio::time::timeout(Duration::from_millis(500), handle)
                .await
                .expect("queued waiter timed out")
                .expect("queued join")
                .expect("queued acquire");
            // Drop NOW so the next waiter can take the lock; otherwise
            // the join above would hang behind the still-held guard.
            drop(acquired.guard);
        }
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 0);
    }

    /// Phase 4 regression guard for the env-driven override path.
    /// `acquire_turn_slot_with_cap` lets tests pin the cap without
    /// having to leak `AURA_PARTITION_TURN_QUEUE` writes across the
    /// process; here we drive cap=3 directly, prove three acquirers
    /// fit and the fourth is rejected, then prove the public
    /// `max_pending_turns()` lookup still falls back to the
    /// `DEFAULT_MAX_PENDING_TURNS` baseline (since the env override is
    /// `OnceLock`-cached on first read and the test process never set
    /// it).
    #[tokio::test]
    async fn acquire_turn_slot_respects_env_override() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));
        let cap = 3usize;

        let first = acquire_turn_slot_with_cap(Arc::clone(&slot), Arc::clone(&counter), cap)
            .await
            .expect("first acquire under override");

        let mut queued_handles = Vec::new();
        for _ in 1..cap {
            let slot_clone = Arc::clone(&slot);
            let counter_clone = Arc::clone(&counter);
            queued_handles.push(tokio::spawn(async move {
                acquire_turn_slot_with_cap(slot_clone, counter_clone, cap).await
            }));
        }

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Acquire),
            cap,
            "the override cap must bound the in-flight + queued count exactly"
        );

        let overflow =
            acquire_turn_slot_with_cap(Arc::clone(&slot), Arc::clone(&counter), cap).await;
        assert!(
            overflow.is_err(),
            "fourth acquire under cap=3 must be rejected as queue-full"
        );

        // The cached env-driven cap must remain at the documented
        // default since this test process never sets the env var.
        assert_eq!(
            max_pending_turns(),
            DEFAULT_MAX_PENDING_TURNS,
            "max_pending_turns() must default to DEFAULT_MAX_PENDING_TURNS without env override"
        );

        drop(first.guard);
        for handle in queued_handles {
            let acquired = tokio::time::timeout(Duration::from_millis(500), handle)
                .await
                .expect("override queued waiter timed out")
                .expect("override queued join")
                .expect("override queued acquire");
            drop(acquired.guard);
        }
        assert_eq!(counter.load(std::sync::atomic::Ordering::Acquire), 0);
    }
}
