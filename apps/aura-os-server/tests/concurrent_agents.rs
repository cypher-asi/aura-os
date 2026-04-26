//! Phase 5 integration tests for the per-instance partitioning + per-partition
//! turn-slot contracts established by Phases 0-3 of the
//! robust-concurrent-agent-infra plan.
//!
//! These tests deliberately do NOT spin up the full HTTP server. Phase 5
//! concerns the concurrency primitives that the chat handler stitches
//! together, not the route plumbing or auth/storage scaffolding around
//! them. The relevant primitives are:
//!
//! * `aura_os_harness::test_support::FakeHarness` — implements `HarnessLink`
//!   and records every `SessionInit` it sees, so we can assert that two
//!   parallel callers landed on distinct partition `agent_id`s.
//! * `aura_os_server::handlers_test_support::evaluate_partition_busy` —
//!   the synchronous predicate behind `chat::busy::reject_if_partition_busy`,
//!   reachable here without an `AppState`.
//! * `aura_os_server::handlers_test_support::acquire_turn_slot` /
//!   `MAX_PENDING_TURNS` / `TurnSlotQueueFull` — the per-partition queue
//!   the chat handler holds for the duration of one user turn, exposed
//!   through the same `chat_pub` re-export pattern used elsewhere in
//!   `tests/`.
//!
//! Driving these primitives directly lets us pin the concurrency
//! contract without dragging in axum / project-service / agent-service
//! state, and keeps the assertions tight enough to be CI-stable.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aura_os_core::{harness_agent_id, AgentId, AgentInstanceId, ProjectId};
use aura_os_harness::test_support::FakeHarness;
use aura_os_harness::{
    AssistantMessageEnd, FilesChanged, HarnessOutbound, SessionBridge, SessionBridgeError,
    SessionBridgeStarted, SessionBridgeTurn, SessionConfig, SessionUsage, TextDelta,
};
use aura_os_server::handlers_test_support::{
    acquire_turn_slot, build_active_automaton_for_test, evaluate_partition_busy,
    fresh_turn_slot_state, ActiveAutomaton, MAX_PENDING_TURNS,
};

// ---------------------------------------------------------------------------
// Shared FakeHarness scripting helpers.
// ---------------------------------------------------------------------------

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

fn cfg_for(template: &AgentId, instance: Option<&AgentInstanceId>) -> SessionConfig {
    SessionConfig {
        agent_id: Some(harness_agent_id(template, instance)),
        template_agent_id: Some(template.to_string()),
        ..Default::default()
    }
}

/// Receive events from a session until we observe the first `TextDelta`,
/// returning `Some(elapsed)` when the delta arrives within `timeout`.
async fn first_text_delta_at(
    started: &mut SessionBridgeStarted,
    started_at: Instant,
    timeout: Duration,
) -> Option<Duration> {
    let deadline = started_at + timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return None;
        }
        let remaining = deadline - now;
        match tokio::time::timeout(remaining, started.events_rx.recv()).await {
            Ok(Ok(HarnessOutbound::TextDelta(_))) => return Some(started_at.elapsed()),
            Ok(Ok(_)) => continue,
            Ok(Err(_)) => return None,
            Err(_) => return None,
        }
    }
}

// ---------------------------------------------------------------------------
// 1a) Two distinct agent templates run interleaved, not serialized.
// ---------------------------------------------------------------------------

/// Phase-5 1a: a fake harness that delays every first response by ~200ms
/// must still let two parallel callers — one per distinct template —
/// observe their first text deltas within ~250ms of each other.
///
/// The contract this proves: cross-partition traffic is NOT serialized
/// at the harness layer. Two distinct template ids hash to two
/// distinct partition `agent_id`s by `aura_os_core::harness_agent_id`,
/// so the harness's "one in-flight turn per agent_id" rule does not
/// apply.
#[tokio::test]
async fn concurrent_chat_distinct_agents() {
    let fake = FakeHarness::new();
    fake.set_script(vec![text_delta("hello"), assistant_end()])
        .await;
    fake.set_initial_delay(Duration::from_millis(200)).await;

    let template_a = AgentId::new();
    let template_b = AgentId::new();
    let instance_a = AgentInstanceId::new();
    let instance_b = AgentInstanceId::new();
    let cfg_a = cfg_for(&template_a, Some(&instance_a));
    let cfg_b = cfg_for(&template_b, Some(&instance_b));

    let started_at = Instant::now();
    let (mut sa, mut sb) = tokio::join!(
        async {
            SessionBridge::open_and_send_user_message(&fake, cfg_a, turn("hi-a"))
                .await
                .expect("open A")
        },
        async {
            SessionBridge::open_and_send_user_message(&fake, cfg_b, turn("hi-b"))
                .await
                .expect("open B")
        },
    );

    let (delta_a, delta_b) = tokio::join!(
        first_text_delta_at(&mut sa, started_at, Duration::from_secs(2)),
        first_text_delta_at(&mut sb, started_at, Duration::from_secs(2)),
    );
    let delta_a = delta_a.expect("A delta arrived");
    let delta_b = delta_b.expect("B delta arrived");

    let skew = if delta_a > delta_b {
        delta_a - delta_b
    } else {
        delta_b - delta_a
    };
    assert!(
        skew <= Duration::from_millis(250),
        "first deltas should arrive within ~250ms of each other, got skew={skew:?} (a={delta_a:?}, b={delta_b:?})"
    );

    let agent_ids = fake.observed_agent_ids().await;
    assert_eq!(agent_ids.len(), 2, "fake harness saw two SessionInits");
    assert_ne!(
        agent_ids[0], agent_ids[1],
        "two distinct templates must produce distinct partition agent_ids"
    );
}

// ---------------------------------------------------------------------------
// 1b) Two AgentInstances of the SAME template share a partition base
//     but emit distinct `agent_id`s and run interleaved.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn concurrent_chat_same_agent_multi_instance() {
    let fake = FakeHarness::new();
    fake.set_script(vec![text_delta("hi"), assistant_end()])
        .await;
    fake.set_initial_delay(Duration::from_millis(200)).await;

    let template = AgentId::new();
    let instance_a = AgentInstanceId::new();
    let instance_b = AgentInstanceId::new();
    let cfg_a = cfg_for(&template, Some(&instance_a));
    let cfg_b = cfg_for(&template, Some(&instance_b));

    let started_at = Instant::now();
    let (mut sa, mut sb) = tokio::join!(
        async {
            SessionBridge::open_and_send_user_message(&fake, cfg_a, turn("hi-a"))
                .await
                .expect("open A")
        },
        async {
            SessionBridge::open_and_send_user_message(&fake, cfg_b, turn("hi-b"))
                .await
                .expect("open B")
        },
    );

    let (delta_a, delta_b) = tokio::join!(
        first_text_delta_at(&mut sa, started_at, Duration::from_secs(2)),
        first_text_delta_at(&mut sb, started_at, Duration::from_secs(2)),
    );
    let delta_a = delta_a.expect("A delta arrived");
    let delta_b = delta_b.expect("B delta arrived");

    let skew = if delta_a > delta_b {
        delta_a - delta_b
    } else {
        delta_b - delta_a
    };
    assert!(
        skew <= Duration::from_millis(250),
        "two same-template instances must interleave, got skew={skew:?}"
    );

    let agent_ids = fake.observed_agent_ids().await;
    assert_eq!(agent_ids.len(), 2);
    assert_ne!(
        agent_ids[0], agent_ids[1],
        "two AgentInstances of one template must hash to distinct partition agent_ids"
    );
    let expected_a = harness_agent_id(&template, Some(&instance_a));
    let expected_b = harness_agent_id(&template, Some(&instance_b));
    let mut sorted = agent_ids
        .iter()
        .map(|s| s.clone().expect("agent_id populated"))
        .collect::<Vec<_>>();
    sorted.sort();
    let mut expected = vec![expected_a, expected_b];
    expected.sort();
    assert_eq!(
        sorted, expected,
        "observed agent_ids must equal the partitioned ids built by harness_agent_id"
    );
}

// ---------------------------------------------------------------------------
// 1c) Chat on AgentInstance B succeeds while AgentInstance A is
//     attached to an automaton; chat on AgentInstance A is rejected.
// ---------------------------------------------------------------------------

fn entry_for(template: AgentId, project_id: ProjectId, automaton_id: &str) -> ActiveAutomaton {
    build_active_automaton_for_test(template, project_id, automaton_id)
}

/// Phase-5 1c: the chat-vs-automation guard
/// (`chat::busy::reject_if_partition_busy` /
/// `evaluate_partition_busy`) refuses ONLY chat sends that target the
/// same `(project_id, agent_instance_id)` pair as a live automaton —
/// chat on a sibling instance of the same template is allowed.
///
/// This pins the post-Phase-1 partitioning behavior: the guard
/// matches by `(project_id, agent_instance_id)`, NOT just by
/// template, so two instances of one template coexist as
/// "automating" + "chatting" without any cross-partition collision.
#[tokio::test]
async fn chat_during_automation_isolated_instance() {
    let template = AgentId::new();
    let project = ProjectId::new();
    let instance_a = AgentInstanceId::new();
    let instance_b = AgentInstanceId::new();

    let mut registry = HashMap::new();
    registry.insert(
        (project, instance_a),
        entry_for(template, project, "auto-A"),
    );

    let busy_b = evaluate_partition_busy(&registry, &template, Some((&project, &instance_b)));
    assert!(
        busy_b.is_none(),
        "chat on a sibling instance must be allowed: got busy={busy_b:?}"
    );

    let busy_a = evaluate_partition_busy(&registry, &template, Some((&project, &instance_a)))
        .expect("chat on the automating instance must be refused");
    assert_eq!(busy_a.project_id, project);
    assert_eq!(busy_a.agent_instance_id, instance_a);
    assert_eq!(busy_a.automaton_id, "auto-A");

    // FakeHarness side: opening sessions on the two instances must
    // produce two distinct partition agent_ids. We open both even
    // though the busy guard above already proved the isolation; this
    // is the harness-level half of the same contract.
    let fake = FakeHarness::new();
    fake.set_script(vec![text_delta("ok"), assistant_end()])
        .await;
    let cfg_loop = cfg_for(&template, Some(&instance_a));
    let cfg_chat = cfg_for(&template, Some(&instance_b));
    let _loop_session = SessionBridge::open_and_send_user_message(&fake, cfg_loop, turn("loop"))
        .await
        .expect("loop session open");
    let _chat_session = SessionBridge::open_and_send_user_message(&fake, cfg_chat, turn("chat"))
        .await
        .expect("chat session open");
    let agent_ids = fake.observed_agent_ids().await;
    assert_eq!(agent_ids.len(), 2);
    assert_ne!(
        agent_ids[0], agent_ids[1],
        "automation + chat must hash to distinct partition agent_ids"
    );
}

// ---------------------------------------------------------------------------
// 1d) Same-partition turn queuing.
// ---------------------------------------------------------------------------

/// Phase-5 1d: a second user-message that arrives on the same
/// partition while the first turn is still in flight must observe
/// `TurnSlotAcquired { queued: true }` so the SSE forwarder can
/// prepend its `progress: queued` event before the first delta. This
/// mirrors the behavior tested at the SSE level by
/// `streaming::tests::back_to_back_partition_sends_queue_with_progress_event`,
/// but at the integration-test seam: callers wire their own slot
/// state and prove the same primitive externally.
#[tokio::test]
async fn same_partition_second_turn_queues() {
    let (slot, counter) = fresh_turn_slot_state();

    let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
        .await
        .expect("first acquire on a free slot");
    assert!(
        !first.queued,
        "first acquire on an empty slot must NOT report queued"
    );

    let slot_2 = Arc::clone(&slot);
    let counter_2 = Arc::clone(&counter);
    let second_handle = tokio::spawn(async move { acquire_turn_slot(slot_2, counter_2).await });

    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        !second_handle.is_finished(),
        "second send must wait while the first holds the slot"
    );
    assert_eq!(
        counter.load(Ordering::Acquire),
        2,
        "both acquirers must be counted while the second is queued"
    );

    drop(first.guard);

    let second = tokio::time::timeout(Duration::from_millis(500), second_handle)
        .await
        .expect("second acquire timed out")
        .expect("join handle")
        .expect("second acquire");
    assert!(
        second.queued,
        "second back-to-back send must observe queued = true"
    );
    drop(second.guard);
    assert_eq!(
        counter.load(Ordering::Acquire),
        0,
        "both guards dropped should leave the counter at zero"
    );
}

/// Phase-5 1d follow-on: a third concurrent caller on the same
/// partition must be rejected with `TurnSlotQueueFull`, which the
/// chat handler maps to `ApiError::agent_busy { reason: "queue full" }`.
#[tokio::test]
async fn same_partition_third_turn_rejects() {
    let (slot, counter) = fresh_turn_slot_state();

    let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
        .await
        .expect("first acquire");
    let slot_2 = Arc::clone(&slot);
    let counter_2 = Arc::clone(&counter);
    let second_handle = tokio::spawn(async move { acquire_turn_slot(slot_2, counter_2).await });

    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(
        counter.load(Ordering::Acquire),
        MAX_PENDING_TURNS,
        "two acquirers must occupy the slot before the bound trips"
    );

    let third = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter)).await;
    assert!(
        third.is_err(),
        "third concurrent acquire must surface TurnSlotQueueFull (got {third:?})",
        third = third.as_ref().err()
    );
    assert_eq!(
        counter.load(Ordering::Acquire),
        MAX_PENDING_TURNS,
        "rejected acquire must roll back its counter increment"
    );

    drop(first.guard);
    let second = second_handle
        .await
        .expect("second join")
        .expect("second acquire");
    drop(second.guard);
    assert_eq!(counter.load(Ordering::Acquire), 0);
}

// ---------------------------------------------------------------------------
// Phase 6: harness_capacity_exhausted end-to-end via FakeHarness.
// ---------------------------------------------------------------------------

/// Phase-6: when the upstream WS-slot semaphore rejects a new session,
/// the server-side `SessionBridge` must surface the typed
/// `SessionBridgeError::CapacityExhausted` variant. This is the bridge
/// layer the HTTP handlers (chat / runtime / specs / extraction) feed
/// into `chat::errors::map_harness_error_to_api`, which then maps
/// onto `ApiError::harness_capacity_exhausted` (status 503,
/// `code: "harness_capacity_exhausted"`, structured `configured_cap`
/// + `retry_after_seconds`). Driving that from a real HTTP request
/// would require the full app scaffolding; pinning the bridge-level
/// contract here keeps the assertion tight while still proving the
/// harness → bridge → handler path stays connected.
#[tokio::test]
async fn fake_harness_capacity_exhausted_surfaces_typed_session_bridge_error() {
    let fake = FakeHarness::new();
    fake.set_script(vec![text_delta("ok"), assistant_end()])
        .await;
    fake.set_capacity_limit(1).await;

    let template = AgentId::new();
    let instance_a = AgentInstanceId::new();
    let instance_b = AgentInstanceId::new();

    let _ok = SessionBridge::open_and_send_user_message(
        &fake,
        cfg_for(&template, Some(&instance_a)),
        turn("first"),
    )
    .await
    .expect("first session under the cap must succeed");

    let result = SessionBridge::open_and_send_user_message(
        &fake,
        cfg_for(&template, Some(&instance_b)),
        turn("second"),
    )
    .await;

    let err = match result {
        Ok(_) => panic!(
            "second session must be refused once the cap is hit — \
             FakeHarness::set_capacity_limit regression"
        ),
        Err(err) => err,
    };
    match err {
        SessionBridgeError::CapacityExhausted(message) => {
            assert!(
                !message.is_empty(),
                "CapacityExhausted variant must carry a non-empty diagnostic, got: {message}"
            );
        }
        other => panic!(
            "expected SessionBridgeError::CapacityExhausted, got {other:?} — \
             this regression would cause the server to leak a generic 502 \
             instead of the structured 503 mapped by \
             ApiError::harness_capacity_exhausted"
        ),
    }

    assert_eq!(
        fake.session_count().await,
        1,
        "FakeHarness must record exactly the sessions it accepted (= cap)"
    );
}
