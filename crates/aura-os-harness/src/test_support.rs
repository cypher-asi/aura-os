//! Public `FakeHarness` scaffold for integration tests.
//!
//! Phase 5 of the robust-concurrent-agent-infra plan needs a harness
//! double that:
//!
//! * implements [`HarnessLink`] so it can be dropped into the server's
//!   `AppState.local_harness` slot,
//! * records every [`SessionInit`] it sees so tests can assert on the
//!   `agent_id` partition key produced by [`crate::build_session_init`]
//!   (and therefore by the upstream chat / loop / executor call sites),
//! * replays a scripted sequence of [`HarnessOutbound`] events on a
//!   configurable initial / per-chunk delay so timing-sensitive
//!   concurrency tests can prove that two streams interleave instead
//!   of serializing.
//!
//! This module is gated behind `cfg(any(test, feature = "test-support"))`
//! — own-crate tests get it unconditionally, downstream crates opt in
//! via their dev-dependencies entry. See
//! `apps/aura-os-server/Cargo.toml` for an example consumer.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc, Mutex, Notify};

use aura_protocol::SessionInit;

use crate::error::HarnessError;
use crate::harness::{build_session_init, HarnessLink, HarnessSession, SessionConfig};
use crate::{HarnessInbound, HarnessOutbound};

/// Default broadcast capacity for a [`FakeHarness`] session. Sized
/// generously so a 32-partition stress test can buffer 5 text chunks
/// + an `AssistantMessageEnd` per session without lagging the
/// receiver.
const DEFAULT_EVENT_CHANNEL_CAPACITY: usize = 256;

/// Default mpsc capacity for the inbound command channel.
const DEFAULT_COMMAND_CHANNEL_CAPACITY: usize = 32;

/// Per-session response script. Cloned out of the shared inner state
/// each time `open_session` is called so the producer task owns a
/// stable list and concurrent test mutations don't race.
#[derive(Clone, Default)]
struct ResponseScript {
    events: Vec<HarnessOutbound>,
    initial_delay: Duration,
    chunk_delay: Duration,
}

struct FakeInner {
    /// Append-only log of every [`SessionInit`] this harness has seen,
    /// one per `open_session` call. Tests assert on this to prove the
    /// partition `agent_id` plumbing.
    session_inits: Vec<SessionInit>,
    /// Script the producer task replays for every inbound
    /// `UserMessage`.
    script: ResponseScript,
    /// Optional gate: if `Some`, every inbound `UserMessage` waits on
    /// this `Notify` before emitting any events. `None` means "fire
    /// immediately" and is the default.
    gate: Option<Arc<Notify>>,
    /// Counter for synthetic session ids.
    next_session_id: u64,
    /// When `Some(n)`, every `open_session` call after the `n`-th one
    /// fails with [`HarnessError::CapacityExhausted`]. Used by Phase
    /// 6 integration tests that assert the server's clean
    /// `harness_capacity_exhausted` 503 mapping.
    capacity_limit: Option<usize>,
}

impl FakeInner {
    fn new() -> Self {
        Self {
            session_inits: Vec::new(),
            script: ResponseScript::default(),
            gate: None,
            next_session_id: 0,
            capacity_limit: None,
        }
    }
}

/// Cheap-to-clone double of [`HarnessLink`] for integration tests.
///
/// Cloning shares the same inner state across all clones, so a test
/// may give one clone to `AppState.local_harness` and keep another
/// for asserting on the recorded [`SessionInit`]s.
#[derive(Clone)]
pub struct FakeHarness {
    inner: Arc<Mutex<FakeInner>>,
}

impl FakeHarness {
    /// Build an empty fake harness with no scripted events and zero
    /// delay. Callers configure it via [`Self::set_script`] /
    /// [`Self::set_initial_delay`] / [`Self::set_chunk_delay`].
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(FakeInner::new())),
        }
    }

    /// Replace the per-`UserMessage` event sequence the harness
    /// replays. The script is cloned per session so a test may
    /// mutate it between turns.
    pub async fn set_script(&self, events: Vec<HarnessOutbound>) {
        let mut inner = self.inner.lock().await;
        inner.script.events = events;
    }

    /// Set the delay between receiving a `UserMessage` and emitting
    /// its first scripted event. Used by concurrency tests to widen
    /// the window in which competing streams can interleave.
    pub async fn set_initial_delay(&self, delay: Duration) {
        let mut inner = self.inner.lock().await;
        inner.script.initial_delay = delay;
    }

    /// Set the delay between consecutive scripted events of one
    /// `UserMessage`. The stress test uses this to model a realistic
    /// "5 text chunks at 50ms each" stream.
    pub async fn set_chunk_delay(&self, delay: Duration) {
        let mut inner = self.inner.lock().await;
        inner.script.chunk_delay = delay;
    }

    /// Install a response gate. Subsequent `UserMessage`s block on
    /// this `Notify` before emitting any events. Returns a
    /// [`ResponseGate`] handle the test uses to release them.
    pub async fn install_response_gate(&self) -> ResponseGate {
        let notify = Arc::new(Notify::new());
        let mut inner = self.inner.lock().await;
        inner.gate = Some(Arc::clone(&notify));
        ResponseGate { notify }
    }

    /// Snapshot of every [`SessionInit`] the harness has observed.
    pub async fn session_inits(&self) -> Vec<SessionInit> {
        self.inner.lock().await.session_inits.clone()
    }

    /// Convenience: snapshot of the partitioned `agent_id`s observed
    /// across all sessions, in arrival order.
    pub async fn observed_agent_ids(&self) -> Vec<Option<String>> {
        self.inner
            .lock()
            .await
            .session_inits
            .iter()
            .map(|s| s.agent_id.clone())
            .collect()
    }

    /// Number of sessions this harness has opened.
    pub async fn session_count(&self) -> usize {
        self.inner.lock().await.session_inits.len()
    }

    /// Configure the harness to fail every `open_session` call after
    /// the first `limit` successful ones with
    /// [`HarnessError::CapacityExhausted`]. Phase 6 integration
    /// tests use this to drive the server's clean
    /// `harness_capacity_exhausted` 503 mapping without needing a
    /// real upstream harness with a saturated WS-slot semaphore.
    pub async fn set_capacity_limit(&self, limit: usize) {
        let mut inner = self.inner.lock().await;
        inner.capacity_limit = Some(limit);
    }
}

impl Default for FakeHarness {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle returned from [`FakeHarness::install_response_gate`]. Drop
/// it to leave the gate latched closed; call [`Self::release_all`]
/// to let every queued response proceed.
pub struct ResponseGate {
    notify: Arc<Notify>,
}

impl ResponseGate {
    /// Wake every waiter currently blocked on the gate AND every
    /// future waiter (by leaving the permit available). Used by
    /// queue-tests to unstick the held first turn after the second
    /// turn has joined the queue.
    pub fn release_all(&self) {
        self.notify.notify_waiters();
        self.notify.notify_one();
    }
}

#[async_trait]
impl HarnessLink for FakeHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        let session_init = build_session_init(&config);
        let (script, gate, session_id) = {
            let mut inner = self.inner.lock().await;
            // Phase-6 capacity-exhaustion stub. Refusing BEFORE we
            // record the session_init keeps the observable count of
            // accepted sessions equal to the configured limit, which
            // is what integration tests want to assert.
            if let Some(limit) = inner.capacity_limit {
                if inner.session_inits.len() >= limit {
                    return Err(anyhow::Error::new(HarnessError::CapacityExhausted)
                        .context("FakeHarness: capacity_limit reached"));
                }
            }
            inner.session_inits.push(session_init.clone());
            inner.next_session_id += 1;
            let session_id = format!("fake-session-{}", inner.next_session_id);
            (inner.script.clone(), inner.gate.clone(), session_id)
        };

        let (events_tx, _) = broadcast::channel(DEFAULT_EVENT_CHANNEL_CAPACITY);
        let (raw_events_tx, _) = broadcast::channel(8);
        let (commands_tx, mut commands_rx) =
            mpsc::channel::<HarnessInbound>(DEFAULT_COMMAND_CHANNEL_CAPACITY);

        // Producer task: drain inbound commands and replay the
        // configured event script for every `UserMessage`. The
        // optional gate lets a test hold the first response open
        // until two competing senders have joined the queue.
        let events_tx_for_task = events_tx.clone();
        tokio::spawn(async move {
            while let Some(cmd) = commands_rx.recv().await {
                let HarnessInbound::UserMessage(_) = cmd else {
                    continue;
                };

                if let Some(gate) = gate.as_ref() {
                    gate.notified().await;
                }

                if !script.initial_delay.is_zero() {
                    tokio::time::sleep(script.initial_delay).await;
                }

                for (idx, evt) in script.events.iter().enumerate() {
                    if idx > 0 && !script.chunk_delay.is_zero() {
                        tokio::time::sleep(script.chunk_delay).await;
                    }
                    let event: HarnessOutbound = evt.clone();
                    if events_tx_for_task.send(event).is_err() {
                        // Receivers all dropped — abort this turn.
                        break;
                    }
                }
            }
        });

        Ok(HarnessSession {
            session_id,
            events_tx,
            raw_events_tx,
            commands_tx,
        })
    }

    async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use aura_protocol::{
        AssistantMessageEnd, FilesChanged, MessageAttachment, SessionUsage, TextDelta, UserMessage,
    };

    use super::*;
    use crate::{SessionBridge, SessionBridgeTurn};

    fn text_delta(text: &str) -> HarnessOutbound {
        HarnessOutbound::TextDelta(TextDelta {
            text: text.to_string(),
        })
    }

    fn assistant_end() -> HarnessOutbound {
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        })
    }

    fn turn(content: &str) -> SessionBridgeTurn {
        SessionBridgeTurn {
            content: content.to_string(),
            tool_hints: None,
            attachments: None::<Vec<MessageAttachment>>,
        }
    }

    #[tokio::test]
    async fn open_session_records_session_init_with_agent_id() {
        let fake = FakeHarness::new();
        fake.set_script(vec![text_delta("hi"), assistant_end()]).await;

        let cfg = SessionConfig {
            agent_id: Some("template::partition-a".into()),
            template_agent_id: Some("template".into()),
            ..Default::default()
        };
        let started = SessionBridge::open_and_send_user_message(&fake, cfg, turn("hello"))
            .await
            .expect("session bridge open");
        let _ = started; // keep handles alive

        let inits = fake.session_inits().await;
        assert_eq!(inits.len(), 1);
        assert_eq!(inits[0].agent_id.as_deref(), Some("template::partition-a"));
        assert_eq!(inits[0].template_agent_id.as_deref(), Some("template"));
    }

    #[tokio::test]
    async fn scripted_events_are_replayed_in_order() {
        let fake = FakeHarness::new();
        fake.set_script(vec![text_delta("a"), text_delta("b"), assistant_end()])
            .await;

        let cfg = SessionConfig {
            agent_id: Some("t::1".into()),
            ..Default::default()
        };
        let mut started = SessionBridge::open_and_send_user_message(&fake, cfg, turn("hi"))
            .await
            .expect("open");
        let mut got = Vec::new();
        for _ in 0..3 {
            let evt = tokio::time::timeout(Duration::from_secs(2), started.events_rx.recv())
                .await
                .expect("script event")
                .expect("recv");
            got.push(evt);
        }
        assert!(matches!(got[0], HarnessOutbound::TextDelta(ref t) if t.text == "a"));
        assert!(matches!(got[1], HarnessOutbound::TextDelta(ref t) if t.text == "b"));
        assert!(matches!(got[2], HarnessOutbound::AssistantMessageEnd(_)));
    }

    #[tokio::test]
    async fn initial_delay_pushes_first_event_back() {
        let fake = FakeHarness::new();
        fake.set_script(vec![text_delta("after-delay"), assistant_end()])
            .await;
        fake.set_initial_delay(Duration::from_millis(80)).await;

        let cfg = SessionConfig {
            agent_id: Some("t::1".into()),
            ..Default::default()
        };
        let started_at = Instant::now();
        let mut started =
            SessionBridge::open_and_send_user_message(&fake, cfg, turn("hi"))
                .await
                .expect("open");
        let _evt = started.events_rx.recv().await.expect("first event");
        let elapsed = started_at.elapsed();
        assert!(
            elapsed >= Duration::from_millis(70),
            "first event should observe the configured initial delay; elapsed={elapsed:?}"
        );
    }

    #[tokio::test]
    async fn response_gate_holds_first_turn_until_released() {
        let fake = FakeHarness::new();
        fake.set_script(vec![text_delta("released"), assistant_end()])
            .await;
        let gate = fake.install_response_gate().await;

        let cfg = SessionConfig {
            agent_id: Some("t::1".into()),
            ..Default::default()
        };
        let mut started = SessionBridge::open_and_send_user_message(&fake, cfg, turn("hi"))
            .await
            .expect("open");

        // Without releasing the gate the first event must NOT arrive.
        let early = tokio::time::timeout(Duration::from_millis(80), started.events_rx.recv()).await;
        assert!(
            early.is_err(),
            "gated turn must not emit before release; got {early:?}"
        );

        gate.release_all();
        let evt = tokio::time::timeout(Duration::from_secs(2), started.events_rx.recv())
            .await
            .expect("release should let the event through")
            .expect("recv");
        assert!(matches!(evt, HarnessOutbound::TextDelta(ref t) if t.text == "released"));
    }

    #[allow(dead_code)]
    fn _unused_user_message(_: UserMessage) {}
}
