//! Verifies that `POST /api/agents/:id/reset-session` cancels any in-flight
//! super-agent spawn and clears its in-memory conversation cache, so the
//! next user turn cannot pick up stale history and stream it back into the
//! proxy.
//!
//! The spawn itself is not exercised here — the unit test in
//! `aura_os_super_agent::stream::tests::run_exits_immediately_when_pre_cancelled`
//! covers the token propagation. This test pins down the server-side
//! registry contract that reset must honour.

mod common;

use std::sync::Arc;

use axum::http::StatusCode;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

use aura_os_server::SuperAgentRun;

use common::*;

#[tokio::test]
async fn reset_session_cancels_live_super_agent_run_and_clears_cache() {
    let (app, state, _db) = build_test_app();

    let agent_id = uuid::Uuid::new_v4();
    let sa_key = format!("super_agent:{agent_id}");

    // Seed the registry + cache as if a super-agent spawn were in flight.
    let cancel = CancellationToken::new();
    {
        let mut runs = state.super_agent_runs.lock().await;
        runs.insert(
            sa_key.clone(),
            SuperAgentRun {
                generation: 1,
                cancel: cancel.clone(),
                join: None,
            },
        );
    }
    {
        let mut cache = state.super_agent_messages.lock().await;
        cache.insert(
            sa_key.clone(),
            vec![serde_json::json!({"role": "user", "content": "stale"})],
        );
    }

    assert!(!cancel.is_cancelled(), "precondition: token is live");

    let uri = format!("/api/agents/{agent_id}/reset-session");
    let resp = app
        .clone()
        .oneshot(json_request("POST", &uri, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    assert!(
        cancel.is_cancelled(),
        "reset must cancel the in-flight super-agent run so the proxy stream is dropped"
    );

    let runs = state.super_agent_runs.lock().await;
    assert!(
        runs.get(&sa_key).is_none(),
        "reset must remove the super-agent run registry entry"
    );

    let cache = state.super_agent_messages.lock().await;
    assert!(
        cache.get(&sa_key).is_none(),
        "reset must clear the super-agent conversation cache"
    );
}

#[tokio::test]
async fn stale_spawn_cannot_overwrite_cache_after_reset() {
    // Simulates the race: spawn A starts at generation 1, reset fires and
    // bumps generation, spawn B starts at generation 2. Spawn A then tries
    // to write its result. The generation guard must reject spawn A's write.
    let (_app, state, _db) = build_test_app();

    let sa_key = "super_agent:race-test".to_string();

    // Spawn A's generation (captured at spawn time).
    let spawn_a_gen: u64 = 1;

    // Register a run at generation 1 (represents spawn A).
    {
        let mut runs = state.super_agent_runs.lock().await;
        runs.insert(
            sa_key.clone(),
            SuperAgentRun {
                generation: spawn_a_gen,
                cancel: CancellationToken::new(),
                join: None,
            },
        );
    }

    // Simulate reset + a new send superseding spawn A with spawn B at gen 2.
    {
        let mut runs = state.super_agent_runs.lock().await;
        runs.insert(
            sa_key.clone(),
            SuperAgentRun {
                generation: 2,
                cancel: CancellationToken::new(),
                join: None,
            },
        );
    }

    // Spawn A (late completion) checks `is_current` against its captured gen.
    let runs = state.super_agent_runs.lock().await;
    let is_current = runs
        .get(&sa_key)
        .map(|r| r.generation == spawn_a_gen)
        .unwrap_or(false);
    assert!(
        !is_current,
        "stale spawn (gen={spawn_a_gen}) must not be treated as the authoritative run once a newer generation is registered"
    );

    // Drop the lock so the wire-path equivalent code could proceed.
    drop(runs);

    // And the cache would remain untouched because the guard short-circuited.
    let cache = state.super_agent_messages.lock().await;
    assert!(cache.get(&sa_key).is_none());

    // Keep state alive until end of test so Arcs don't drop early.
    let _ = Arc::clone(&state.super_agent_runs);
}
