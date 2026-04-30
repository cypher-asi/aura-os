//! Phase-5 stress test: confirms that 32 concurrent chat partitions
//! sustain parallel throughput within the harness WS slot cap, and
//! that cross-partition latency stays bounded as load increases.
//!
//! Run with:
//!     cargo test -p aura-os-server --test concurrent_agents_stress_test --release \
//!                -- --include-ignored
//!
//! Marked `#[ignore]` so `cargo test` keeps running fast on CI; flip
//! the include flag (or pass `concurrent_agents_stress_32_partitions`
//! by name) when you want to exercise the parallel envelope directly.

use std::time::{Duration, Instant};

use aura_os_core::{harness_agent_id, AgentId, AgentInstanceId};
use aura_os_harness::test_support::FakeHarness;
use aura_os_harness::{
    AssistantMessageEnd, FilesChanged, HarnessOutbound, SessionBridge, SessionBridgeStarted,
    SessionBridgeTurn, SessionConfig, SessionUsage, TextDelta,
};
use futures_util::future::join_all;

/// Number of concurrent chat partitions exercised by the stress test.
/// Sized below the harness WS slot cap (128) with comfortable margin
/// so the test exercises real parallelism without flaking on machines
/// with tight ulimits.
const PARTITION_COUNT: usize = 32;

/// Number of `TextDelta` chunks every fake-harness session emits per
/// turn before the terminal `AssistantMessageEnd`. Combined with
/// [`CHUNK_DELAY`] this models a realistic streaming response.
const CHUNKS_PER_TURN: usize = 5;

/// Inter-chunk delay applied to every scripted text delta. A
/// single-stream turn therefore takes roughly
/// `CHUNKS_PER_TURN * CHUNK_DELAY` plus the initial-delay budget.
const CHUNK_DELAY: Duration = Duration::from_millis(50);

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

async fn drain_until_end(mut started: SessionBridgeStarted) -> Result<(), String> {
    let timeout = Duration::from_secs(10);
    let deadline = Instant::now() + timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err("session drained past timeout".into());
        }
        let remaining = deadline - now;
        match tokio::time::timeout(remaining, started.events_rx.recv()).await {
            Ok(Ok(HarnessOutbound::AssistantMessageEnd(_))) => return Ok(()),
            Ok(Ok(HarnessOutbound::Error(err))) => {
                if err.code == "agent_busy"
                    || err.code == "queue_full"
                    || err.code == "turn_in_progress"
                {
                    return Err(format!(
                        "harness emitted disallowed concurrency error: code={}, message={}",
                        err.code, err.message
                    ));
                }
                return Err(format!(
                    "harness emitted unexpected error: code={}, message={}",
                    err.code, err.message
                ));
            }
            Ok(Ok(_other)) => continue,
            Ok(Err(_lag)) => continue,
            Err(_) => return Err("recv timed out".into()),
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn concurrent_agents_stress_32_partitions() {
    let fake = FakeHarness::new();
    let mut script = Vec::with_capacity(CHUNKS_PER_TURN + 1);
    for i in 0..CHUNKS_PER_TURN {
        script.push(text_delta(&format!("chunk-{i}")));
    }
    script.push(assistant_end());
    fake.set_script(script).await;
    fake.set_chunk_delay(CHUNK_DELAY).await;

    let template = AgentId::new();
    let instance_ids: Vec<AgentInstanceId> = (0..PARTITION_COUNT)
        .map(|_| AgentInstanceId::new())
        .collect();

    // Single-stream baseline: open one session, wait for it to finish.
    // We use this number to compare against the parallel batch below.
    let baseline_started = SessionBridge::open_and_send_user_message(
        &fake,
        SessionConfig {
            agent_id: Some(harness_agent_id(&template, Some(&instance_ids[0]))),
            template_agent_id: Some(template.to_string()),
            ..Default::default()
        },
        turn("baseline"),
    )
    .await
    .expect("baseline session open");
    let baseline_started_at = Instant::now();
    drain_until_end(baseline_started)
        .await
        .expect("baseline session drained cleanly");
    let single_stream_duration = baseline_started_at.elapsed();
    let ideal_parallel = single_stream_duration;
    let parallel_budget = ideal_parallel * 2;

    // Parallel batch: open all PARTITION_COUNT sessions concurrently
    // and wait for every one to drain. Asserting the wall-clock budget
    // proves that nothing in the harness or the test scaffold
    // serializes turns across partitions.
    let parallel_started_at = Instant::now();
    let opens = (0..PARTITION_COUNT).map(|i| {
        let fake = fake.clone();
        let template = template;
        let instance = instance_ids[i];
        async move {
            let cfg = SessionConfig {
                agent_id: Some(harness_agent_id(&template, Some(&instance))),
                template_agent_id: Some(template.to_string()),
                ..Default::default()
            };
            SessionBridge::open_and_send_user_message(&fake, cfg, turn(&format!("parallel-{i}")))
                .await
                .map_err(|e| format!("open partition {i}: {e}"))
        }
    });
    let started_sessions: Vec<_> = join_all(opens)
        .await
        .into_iter()
        .collect::<Result<_, _>>()
        .expect("every partition opened cleanly");
    let drains = started_sessions
        .into_iter()
        .enumerate()
        .map(|(i, s)| async move {
            drain_until_end(s)
                .await
                .map_err(|e| format!("partition {i}: {e}"))
        });
    let outcomes = join_all(drains).await;
    let parallel_wall = parallel_started_at.elapsed();

    // Diagnostic print so failures can correlate timing in CI logs.
    eprintln!(
        "[stress] partitions={PARTITION_COUNT} chunks_per_turn={CHUNKS_PER_TURN} chunk_delay={CHUNK_DELAY:?}",
    );
    eprintln!(
        "[stress] baseline_single_stream={single_stream_duration:?} parallel_wall={parallel_wall:?} ideal={ideal_parallel:?} budget={parallel_budget:?}",
    );

    for outcome in &outcomes {
        if let Err(e) = outcome {
            panic!("stress partition failed: {e}");
        }
    }

    let observed_agent_ids = fake.observed_agent_ids().await;
    assert!(
        observed_agent_ids.len() >= PARTITION_COUNT + 1,
        "fake harness must have seen at least {} SessionInits (1 baseline + {} parallel), got {}",
        PARTITION_COUNT + 1,
        PARTITION_COUNT,
        observed_agent_ids.len(),
    );

    assert!(
        parallel_wall <= parallel_budget,
        "wall-clock {parallel_wall:?} exceeded 2x single-stream budget {parallel_budget:?} (ideal {ideal_parallel:?}); concurrency contract regressed",
    );
}
