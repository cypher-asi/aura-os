//! Bounded retention of reusable chat connections. Dropping the registry's
//! final command sender closes the bridge socket; replay/history lives elsewhere.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{ChatSession, ChatSessionRegistry};

const IDLE_RETENTION: Duration = Duration::from_secs(60);
const SWEEP_INTERVAL: Duration = Duration::from_secs(15);
// Reserve most of the harness's 128 slots for active turns, automata, and
// other API processes. Active or borrowed sessions may exceed this cache bound.
const WARM_SESSION_LIMIT: usize = 32;

pub(crate) fn new_chat_session_registry() -> ChatSessionRegistry {
    let registry = Arc::new(dashmap::DashMap::new());
    let weak = Arc::downgrade(&registry);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            let Some(registry) = weak.upgrade() else {
                break;
            };
            sweep(
                &registry,
                Instant::now(),
                IDLE_RETENTION,
                WARM_SESSION_LIMIT,
            );
        }
    });
    registry
}

pub(crate) fn make_room_for_chat_session(registry: &ChatSessionRegistry) {
    sweep(
        registry,
        Instant::now(),
        IDLE_RETENTION,
        WARM_SESSION_LIMIT - 1,
    );
}

fn is_idle(session: &ChatSession) -> bool {
    session.turn_pending_count.load(Ordering::Acquire) == 0
        // Reuse clones the sender while holding the registry entry lock.
        // Checking under that same lock protects even the gap before it
        // increments the pending count or waits for the turn mutex.
        && session.commands_tx.strong_count() == 1
}

fn sweep(registry: &ChatSessionRegistry, now: Instant, retention: Duration, limit: usize) {
    let mut candidates = Vec::new();
    registry.retain(|key, session| {
        if !session.is_alive() {
            return false;
        }
        if !is_idle(session) {
            // An arbitrarily long turn gets a full idle grace period
            // after its last observation as active, not after its start.
            session.last_used_at = now;
            return true;
        }
        if now.saturating_duration_since(session.last_used_at) >= retention {
            tracing::info!(session_id = %session.session_id, "Evicting idle warm chat connection");
            return false;
        }
        candidates.push((key.clone(), session.last_used_at));
        true
    });
    candidates.sort_unstable_by_key(|(_, last_used)| *last_used);
    for (key, observed_last_used) in candidates {
        if registry.len() <= limit {
            break;
        }
        // Revalidate under the write lock: a turn may have borrowed the
        // entry, or a new session may have replaced it since the scan.
        registry.remove_if(&key, |_, session| {
            let evict = session.last_used_at == observed_last_used && is_idle(session);
            if evict {
                tracing::info!(session_id = %session.session_id, limit, "Evicting warm chat connection to make room");
            }
            evict
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ChatSessionKey;
    use aura_os_harness::HarnessInbound;
    use std::sync::atomic::AtomicUsize;
    use tokio::sync::{broadcast, mpsc, Mutex};

    fn insert(
        registry: &ChatSessionRegistry,
        id: &str,
        last_used_at: Instant,
    ) -> mpsc::Receiver<HarnessInbound> {
        let (commands_tx, commands_rx) = mpsc::channel(4);
        let (events_tx, _) = broadcast::channel(4);
        registry.insert(
            ChatSessionKey::new(id, None),
            ChatSession {
                last_used_at,
                session_id: id.into(),
                commands_tx,
                events_tx,
                model: None,
                agent_id: None,
                template_agent_id: None,
                turn_slot: Arc::new(Mutex::new(())),
                turn_pending_count: Arc::new(AtomicUsize::new(0)),
            },
        );
        commands_rx
    }

    #[tokio::test]
    async fn expired_idle_entries_release_the_bridge_command_channel() {
        let registry = Arc::new(dashmap::DashMap::new());
        let start = Instant::now();
        let mut rx = insert(&registry, "idle", start);
        sweep(
            &registry,
            start + IDLE_RETENTION,
            IDLE_RETENTION,
            WARM_SESSION_LIMIT,
        );
        assert!(registry.is_empty());
        assert!(
            rx.recv().await.is_none(),
            "last sender must drop so bridge closes its socket"
        );
    }

    #[tokio::test]
    async fn active_queued_and_borrowed_sessions_survive_ttl_and_capacity_pressure() {
        let registry = Arc::new(dashmap::DashMap::new());
        let start = Instant::now();
        let mut active_rx = insert(&registry, "active", start);
        let mut borrowed_rx = insert(&registry, "borrowed", start);
        let active_key = ChatSessionKey::new("active", None);
        registry
            .get(&active_key)
            .unwrap()
            .turn_pending_count
            .store(2, Ordering::Release);
        let borrowed = registry
            .get(&ChatSessionKey::new("borrowed", None))
            .unwrap()
            .commands_tx
            .clone();
        let now = start + IDLE_RETENTION * 2;
        sweep(&registry, now, IDLE_RETENTION, 0);
        assert_eq!(registry.len(), 2);
        assert!(active_rx.try_recv().is_err());
        assert!(!active_rx.is_closed());
        assert!(!borrowed_rx.is_closed());
        registry
            .get(&active_key)
            .unwrap()
            .turn_pending_count
            .store(0, Ordering::Release);
        drop(borrowed);
        sweep(
            &registry,
            now + IDLE_RETENTION - Duration::from_secs(1),
            IDLE_RETENTION,
            WARM_SESSION_LIMIT,
        );
        assert_eq!(
            registry.len(),
            2,
            "long active turns get an idle grace period"
        );
        sweep(
            &registry,
            now + IDLE_RETENTION,
            IDLE_RETENTION,
            WARM_SESSION_LIMIT,
        );
        assert!(registry.is_empty());
        assert!(active_rx.recv().await.is_none());
        assert!(borrowed_rx.recv().await.is_none());
    }

    #[test]
    fn capacity_evicts_oldest_idle_entry_and_keeps_recent_reuse() {
        let registry = Arc::new(dashmap::DashMap::new());
        let start = Instant::now();
        let oldest_rx = insert(&registry, "oldest", start);
        let recent_rx = insert(&registry, "recent", start);
        let newest_rx = insert(&registry, "newest", start + Duration::from_secs(1));
        // Same touch performed when try_reuse_session borrows its handles.
        registry
            .get_mut(&ChatSessionKey::new("recent", None))
            .unwrap()
            .last_used_at = start + Duration::from_secs(2);
        sweep(&registry, start + Duration::from_secs(3), IDLE_RETENTION, 2);
        assert!(oldest_rx.is_closed());
        assert!(!recent_rx.is_closed());
        assert!(!newest_rx.is_closed());
    }

    #[tokio::test(start_paused = true)]
    async fn registry_sweeper_does_not_keep_app_state_alive() {
        let registry = new_chat_session_registry();
        let weak = Arc::downgrade(&registry);
        tokio::task::yield_now().await;
        drop(registry);
        assert!(weak.upgrade().is_none());
        tokio::time::advance(SWEEP_INTERVAL).await;
    }
}
