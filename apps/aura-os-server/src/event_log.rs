//! Sequenced, bounded global event log backing the `/ws/events`
//! firehose reconnect story.
//!
//! The legacy [`crate::state::AppState::event_broadcast`] channel is a
//! plain `broadcast::Sender<serde_json::Value>` with no sequence
//! numbers and no replay: a subscriber that disconnects (browser tab
//! sleeps, laptop lid closes, flaky wifi) silently loses every event
//! published during the gap, and on `RecvError::Lagged` the WS
//! forwarder just skips ahead. There is no way for the client to ask
//! "give me everything I missed since seq N".
//!
//! [`EventLog`] sits *downstream* of `event_broadcast`: a single bridge
//! task (spawned by [`EventLog::with_bridge`]) drains the legacy channel
//! and appends every payload here, stamping a monotonic `seq`. The WS
//! handler subscribes to the log instead of the raw broadcast so it can
//! both replay a bounded backlog on connect (`?since=N`) and stream live
//! events with stable sequence numbers. Producers are untouched — they
//! keep publishing to `event_broadcast` exactly as before.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::broadcast;

/// Default size of the in-memory replay ring (number of events).
pub const DEFAULT_EVENT_LOG_CAPACITY: usize = 8192;

/// Env var overriding [`DEFAULT_EVENT_LOG_CAPACITY`].
pub const EVENT_LOG_CAPACITY_ENV: &str = "AURA_EVENT_LOG_CAPACITY";

/// A single sequenced event. `seq` is monotonically increasing and
/// starts at 1; `seq == 0` is reserved to mean "I have seen nothing"
/// when a client sends `?since=0`.
#[derive(Clone, Debug)]
pub struct SeqEvent {
    pub seq: u64,
    pub value: Arc<serde_json::Value>,
}

/// Outcome of a [`EventLog::replay_since`] request.
#[derive(Debug)]
pub enum ReplayResult {
    /// The caller's cursor is at or beyond the newest event; nothing to
    /// replay. `latest` is the newest seq currently assigned.
    UpToDate { latest: u64 },
    /// The requested backlog is fully buffered; `events` are the events
    /// with `seq > since`, oldest first. `latest` is the newest seq.
    Replay { events: Vec<SeqEvent>, latest: u64 },
    /// The caller fell so far behind that the events it needs were
    /// already evicted from the ring. The caller must perform a full
    /// state resync rather than a delta replay. `latest` is the newest
    /// seq currently assigned.
    GapTooLarge { latest: u64 },
}

/// Bounded, sequenced event log with a live fan-out channel.
pub struct EventLog {
    ring: Mutex<VecDeque<SeqEvent>>,
    next_seq: AtomicU64,
    capacity: usize,
    tx: broadcast::Sender<SeqEvent>,
}

impl EventLog {
    /// Resolve the configured ring capacity from the environment,
    /// falling back to [`DEFAULT_EVENT_LOG_CAPACITY`].
    pub fn capacity_from_env() -> usize {
        std::env::var(EVENT_LOG_CAPACITY_ENV)
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(DEFAULT_EVENT_LOG_CAPACITY)
    }

    /// Construct an empty log with the given ring capacity.
    pub fn new(capacity: usize) -> Arc<Self> {
        let capacity = capacity.max(1);
        // Size the live broadcast channel to match the ring so a
        // subscriber that briefly stalls has the same slack the replay
        // ring provides before it has to fall back to a resync.
        let (tx, _) = broadcast::channel(capacity);
        Arc::new(Self {
            ring: Mutex::new(VecDeque::with_capacity(capacity)),
            next_seq: AtomicU64::new(1),
            capacity,
            tx,
        })
    }

    /// Construct a log and spawn a background bridge that drains
    /// `source` (the legacy `event_broadcast` channel) into it. The
    /// bridge runs until the source is closed.
    pub fn with_bridge(
        mut source: broadcast::Receiver<serde_json::Value>,
        capacity: usize,
    ) -> Arc<Self> {
        let log = Self::new(capacity);
        let log_for_task = log.clone();
        tokio::spawn(async move {
            loop {
                match source.recv().await {
                    Ok(value) => {
                        log_for_task.append(value);
                    }
                    // If the bridge itself falls behind the legacy
                    // channel we cannot recover the dropped payloads —
                    // they never got a seq. Skip ahead; the per-client
                    // lag path will surface a resync if needed.
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        log
    }

    /// Append an event, assign it the next seq, push it onto the ring
    /// (evicting the oldest if at capacity), and fan it out live.
    /// Returns the assigned seq.
    pub fn append(&self, value: serde_json::Value) -> u64 {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let evt = SeqEvent {
            seq,
            value: Arc::new(value),
        };
        {
            let mut ring = self.ring.lock().expect("event log ring poisoned");
            while ring.len() >= self.capacity {
                ring.pop_front();
            }
            ring.push_back(evt.clone());
        }
        // A send error just means no live subscribers right now; the
        // event still lives in the ring for future replay.
        let _ = self.tx.send(evt);
        seq
    }

    /// Subscribe to the live fan-out of newly appended events.
    pub fn subscribe(&self) -> broadcast::Receiver<SeqEvent> {
        self.tx.subscribe()
    }

    /// Newest seq assigned so far (0 if nothing has been appended).
    pub fn latest_seq(&self) -> u64 {
        self.next_seq.load(Ordering::SeqCst).saturating_sub(1)
    }

    /// Return whether any currently-buffered value matches `predicate`.
    ///
    /// This is intentionally a read-only snapshot over the bounded ring.
    /// Callers use it to resolve control messages (for example a mobile
    /// tool-approval response) back to the live stream that emitted the
    /// corresponding request without exposing the ring itself.
    pub fn any_value(&self, predicate: impl Fn(&serde_json::Value) -> bool) -> bool {
        self.ring
            .lock()
            .expect("event log ring poisoned")
            .iter()
            .any(|event| predicate(&event.value))
    }

    /// Compute the delta a client needs to catch up from `since`.
    pub fn replay_since(&self, since: u64) -> ReplayResult {
        let ring = self.ring.lock().expect("event log ring poisoned");
        let latest = self.next_seq.load(Ordering::SeqCst).saturating_sub(1);
        if since >= latest {
            return ReplayResult::UpToDate { latest };
        }
        match ring.front() {
            // Nothing buffered yet but latest > since — treat as up to
            // date (no events exist to replay).
            None => ReplayResult::UpToDate { latest },
            Some(front) => {
                // We can serve a clean delta only if the next event the
                // client expects (`since + 1`) is still in the ring,
                // i.e. it is at or after the oldest buffered seq.
                if since + 1 < front.seq {
                    ReplayResult::GapTooLarge { latest }
                } else {
                    let events: Vec<SeqEvent> =
                        ring.iter().filter(|e| e.seq > since).cloned().collect();
                    ReplayResult::Replay { events, latest }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn val(n: u64) -> serde_json::Value {
        serde_json::json!({ "type": "test", "n": n })
    }

    #[test]
    fn append_assigns_monotonic_seqs_from_one() {
        let log = EventLog::new(16);
        assert_eq!(log.latest_seq(), 0);
        assert_eq!(log.append(val(1)), 1);
        assert_eq!(log.append(val(2)), 2);
        assert_eq!(log.latest_seq(), 2);
    }

    #[test]
    fn replay_since_zero_returns_everything_buffered() {
        let log = EventLog::new(16);
        for n in 0..5 {
            log.append(val(n));
        }
        match log.replay_since(0) {
            ReplayResult::Replay { events, latest } => {
                assert_eq!(latest, 5);
                assert_eq!(events.len(), 5);
                assert_eq!(events.first().unwrap().seq, 1);
                assert_eq!(events.last().unwrap().seq, 5);
            }
            other => panic!("expected Replay, got {other:?}"),
        }
    }

    #[test]
    fn replay_since_latest_is_up_to_date() {
        let log = EventLog::new(16);
        log.append(val(1));
        log.append(val(2));
        match log.replay_since(2) {
            ReplayResult::UpToDate { latest } => assert_eq!(latest, 2),
            other => panic!("expected UpToDate, got {other:?}"),
        }
    }

    #[test]
    fn replay_since_partial_returns_only_newer_events() {
        let log = EventLog::new(16);
        for n in 0..5 {
            log.append(val(n));
        }
        match log.replay_since(3) {
            ReplayResult::Replay { events, latest } => {
                assert_eq!(latest, 5);
                let seqs: Vec<u64> = events.iter().map(|e| e.seq).collect();
                assert_eq!(seqs, vec![4, 5]);
            }
            other => panic!("expected Replay, got {other:?}"),
        }
    }

    #[test]
    fn replay_since_evicted_cursor_signals_gap() {
        // Capacity 4: after appending 10 events, the ring holds seq
        // 7..=10. A client asking for since=2 needs seq 3, which was
        // evicted.
        let log = EventLog::new(4);
        for n in 0..10 {
            log.append(val(n));
        }
        match log.replay_since(2) {
            ReplayResult::GapTooLarge { latest } => assert_eq!(latest, 10),
            other => panic!("expected GapTooLarge, got {other:?}"),
        }
    }

    #[test]
    fn replay_since_oldest_buffered_boundary_is_servable() {
        // Ring holds seq 7..=10 (oldest front.seq == 7). A client at
        // since=6 expects seq 7, which is still buffered -> clean delta.
        let log = EventLog::new(4);
        for n in 0..10 {
            log.append(val(n));
        }
        match log.replay_since(6) {
            ReplayResult::Replay { events, latest } => {
                assert_eq!(latest, 10);
                let seqs: Vec<u64> = events.iter().map(|e| e.seq).collect();
                assert_eq!(seqs, vec![7, 8, 9, 10]);
            }
            other => panic!("expected Replay, got {other:?}"),
        }
    }
}
