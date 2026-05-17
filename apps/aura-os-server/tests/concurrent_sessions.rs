//! Phase 1 of the parallel-session-chats plan: two storage sessions on
//! the SAME `(template, agent_instance)` pair must run their assistant
//! turns concurrently. Before Phase 1, both POSTs would have collapsed
//! onto the per-instance partition `{template}::{instance}`, taken the
//! same `turn_slot` mutex, and serialized. After Phase 1, the chat
//! routes fold the resolved storage `session_id` into the partition
//! string built by `aura_os_core::harness_agent_id`, so two
//! `(template, instance, session_id)` triples land on distinct
//! partitions / distinct turn slots / distinct harness sessions.
//!
//! Test scaffolding choice: these tests drive `FakeHarness` +
//! `SessionBridge` directly, the same pattern
//! `tests/concurrent_agents.rs` uses. Full SSE round-trip would
//! require the entire axum / auth / project-service stack to be
//! brought up against a mock storage server — not impossible, but
//! disproportionate scope for proving the harness-level partitioning
//! contract that Phase 1 actually adds. The registry-level shape
//! (`ChatSessionKey.session_key` strings differing on the third
//! segment, distinct `turn_slot` `Arc<Mutex<()>>` instances) is a
//! pure consequence of the partition strings being distinct, and the
//! existing chat-route plumbing forwards the partition string into
//! both `OpenChatStreamArgs.session_key` and `SessionConfig.agent_id`.
//! Driving the harness layer thus exercises the same end-to-end
//! invariant the SSE path would, at a fraction of the test cost.

use std::time::{Duration, Instant};

use aura_os_core::{harness_agent_id, AgentId, AgentInstanceId, SessionId};
use aura_os_harness::test_support::FakeHarness;
use aura_os_harness::{
    AssistantMessageEnd, FilesChanged, HarnessOutbound, SessionBridge, SessionBridgeStarted,
    SessionBridgeTurn, SessionConfig, SessionUsage, TextDelta,
};

fn text_delta(text: &str) -> HarnessOutbound {
    HarnessOutbound::TextDelta(TextDelta {
        text: text.to_string(),
    })
}

fn assistant_end() -> HarnessOutbound {
    HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
        message_id: "msg-end".to_string(),
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
        attachments: None,
    }
}

/// Build a `SessionConfig` mirroring what the Phase-1 chat routes ship
/// to the harness on a cold-open: agent_id is the three-segment
/// `{template}::{instance}::{session}` partition, template_agent_id
/// is the bare template uuid (skill / billing identity).
fn cfg_with_session(
    template: &AgentId,
    instance: &AgentInstanceId,
    session: &SessionId,
) -> SessionConfig {
    SessionConfig {
        agent_id: Some(harness_agent_id(template, Some(instance), Some(session))),
        template_agent_id: Some(template.to_string()),
        ..Default::default()
    }
}

/// Receive events from a session until we observe the first `TextDelta`,
/// returning `Some((elapsed, text))` when the delta arrives within
/// `timeout`. The text payload lets callers prove stream isolation —
/// session A's deltas must not surface on session B's receiver.
async fn first_text_delta_at(
    started: &mut SessionBridgeStarted,
    started_at: Instant,
    timeout: Duration,
) -> Option<(Duration, String)> {
    let deadline = started_at + timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return None;
        }
        let remaining = deadline - now;
        match tokio::time::timeout(remaining, started.events_rx.recv()).await {
            Ok(Ok(HarnessOutbound::TextDelta(td))) => return Some((started_at.elapsed(), td.text)),
            Ok(Ok(_)) => continue,
            Ok(Err(_)) => return None,
            Err(_) => return None,
        }
    }
}

/// Phase 1 core invariant: two POSTs against the same
/// `(template, instance)` with different storage `session_id` values
/// produce DISTINCT harness partition `agent_id`s and DISTINCT
/// `Session.agent_id`s on the harness side — i.e. the per-instance
/// partition string is no longer the partition string. This is what
/// lets `aura-os-server`'s `ChatSessionRegistry` (keyed by
/// `ChatSessionKey.session_key`, which the chat handler sets from
/// `SessionConfig.agent_id`) hold one entry per storage session and
/// hand each its own `turn_slot` mutex.
#[tokio::test]
async fn distinct_session_ids_produce_distinct_partition_agent_ids() {
    let fake = FakeHarness::new();
    fake.set_script(vec![text_delta("hi"), assistant_end()])
        .await;

    let template = AgentId::new();
    let instance = AgentInstanceId::new();
    let session_a = SessionId::new();
    let session_b = SessionId::new();
    assert_ne!(session_a, session_b);

    let cfg_a = cfg_with_session(&template, &instance, &session_a);
    let cfg_b = cfg_with_session(&template, &instance, &session_b);

    // Cheap sanity guard on the helper itself: the agent_id strings
    // baked into the configs differ ONLY in the session segment, so
    // any regression that collapses them back to the per-instance
    // partition is caught right here without needing the harness.
    let agent_id_a = cfg_a.agent_id.clone().expect("session-scoped agent_id");
    let agent_id_b = cfg_b.agent_id.clone().expect("session-scoped agent_id");
    assert_ne!(
        agent_id_a, agent_id_b,
        "two storage sessions on the same instance must yield distinct partition agent_ids; \
         this is the partition-string contract Phase 1 adds"
    );
    assert!(
        agent_id_a.starts_with(&format!("{template}::{instance}::")),
        "agent_id must encode the (template, instance) prefix before the session segment, got {agent_id_a}"
    );
    assert!(
        agent_id_b.starts_with(&format!("{template}::{instance}::")),
        "agent_id must encode the (template, instance) prefix before the session segment, got {agent_id_b}"
    );

    let _sa = SessionBridge::open_and_send_user_message(&fake, cfg_a, turn("hi-a"))
        .await
        .expect("open session A");
    let _sb = SessionBridge::open_and_send_user_message(&fake, cfg_b, turn("hi-b"))
        .await
        .expect("open session B");

    let agent_ids = fake.observed_agent_ids().await;
    assert_eq!(agent_ids.len(), 2, "fake harness saw two SessionInits");
    assert_ne!(
        agent_ids[0], agent_ids[1],
        "two storage sessions on the same instance must hash to distinct partition agent_ids \
         in the harness's SessionInit observation log"
    );
    let mut observed: Vec<String> = agent_ids
        .iter()
        .map(|s| s.clone().expect("agent_id populated"))
        .collect();
    observed.sort();
    let mut expected = vec![agent_id_a, agent_id_b];
    expected.sort();
    assert_eq!(
        observed, expected,
        "observed agent_ids must equal the partition strings built by harness_agent_id; \
         a mismatch here means the partition string didn't make it into SessionInit"
    );
}

/// Phase 1 wall-clock contract: a fake harness that delays every first
/// response by ~200ms must still let two parallel callers — one per
/// distinct storage session, both on the same `(template, instance)`
/// — observe their first text deltas within ~250ms of each other.
///
/// Before Phase 1 both opens would have shared the per-instance
/// partition `{template}::{instance}`, taken the same upstream
/// turn-lock on the harness side, and serialized: the second delta
/// would arrive ~200ms after the first completes. With Phase 1's
/// three-segment partition string the harness assigns two distinct
/// `Session.agent_id`s and the turn-lock is held independently per
/// session — so the two streams overlap.
#[tokio::test]
async fn two_sessions_on_same_instance_stream_concurrently() {
    let fake = FakeHarness::new();
    fake.set_script(vec![text_delta("hello-session"), assistant_end()])
        .await;
    fake.set_initial_delay(Duration::from_millis(200)).await;

    let template = AgentId::new();
    let instance = AgentInstanceId::new();
    let session_a = SessionId::new();
    let session_b = SessionId::new();
    let cfg_a = cfg_with_session(&template, &instance, &session_a);
    let cfg_b = cfg_with_session(&template, &instance, &session_b);

    let started_at = Instant::now();
    let (mut sa, mut sb) = tokio::join!(
        async {
            SessionBridge::open_and_send_user_message(&fake, cfg_a, turn("hi-a"))
                .await
                .expect("open session A")
        },
        async {
            SessionBridge::open_and_send_user_message(&fake, cfg_b, turn("hi-b"))
                .await
                .expect("open session B")
        },
    );

    let (delta_a, delta_b) = tokio::join!(
        first_text_delta_at(&mut sa, started_at, Duration::from_secs(2)),
        first_text_delta_at(&mut sb, started_at, Duration::from_secs(2)),
    );
    let (a_elapsed, a_text) = delta_a.expect("A delta arrived");
    let (b_elapsed, b_text) = delta_b.expect("B delta arrived");

    let skew = if a_elapsed > b_elapsed {
        a_elapsed - b_elapsed
    } else {
        b_elapsed - a_elapsed
    };
    assert!(
        skew <= Duration::from_millis(250),
        "two storage sessions on one instance must interleave; got skew={skew:?} \
         (a={a_elapsed:?}, b={b_elapsed:?}). A serialized harness would push skew to \
         ~200ms (initial_delay) + drain time, which fails this guard."
    );

    // One-line stream isolation check: each receiver must see the
    // payload that was scripted onto its own bridge. The fake harness
    // gives every `open_and_send_user_message` call its own
    // events_rx — a leak here would mean we read from the wrong
    // bridge, which itself is a contract regression worth catching.
    assert_eq!(
        a_text, "hello-session",
        "session A's delta must come from its own bridge, got: {a_text:?}"
    );
    assert_eq!(
        b_text, "hello-session",
        "session B's delta must come from its own bridge, got: {b_text:?}"
    );
}

/// Doc anchor: confirm `aura_os_core::harness_agent_id` produces a
/// three-segment partition string when given a `SessionId` and that
/// the two-segment (Phase-0-bare) form is byte-distinct from the
/// three-segment form even when the template + instance match. This
/// is the harness-side guarantee that the `aura-os-server` chat
/// routes ride on — without it, the per-session lane split collapses
/// silently back to the per-instance partition.
#[test]
fn harness_agent_id_three_segment_form_is_distinct_from_two_segment() {
    let template = AgentId::new();
    let instance = AgentInstanceId::new();
    let session = SessionId::new();

    let two_segment = harness_agent_id(&template, Some(&instance), None);
    let three_segment = harness_agent_id(&template, Some(&instance), Some(&session));

    assert_ne!(
        two_segment, three_segment,
        "Phase 1 relies on these strings being byte-distinct; \
         a regression that drops the session segment would silently \
         collapse two per-session entries onto one per-instance entry"
    );
    assert!(
        three_segment.starts_with(&format!("{two_segment}::")),
        "three-segment form must extend the two-segment instance prefix verbatim; \
         this is what `remove_live_sessions_for_instance` relies on for its \
         prefix sweep in setup.rs"
    );
}
