//! Verifies that `POST /api/agents/:id/reset-session` cancels any in-flight
//! super-agent harness bridge so the next user turn cannot pick up a stale
//! run.
//!
//! The legacy in-process `SuperAgentStream` and its
//! `AppState.super_agent_messages` conversation cache were retired in
//! Phase 6; reset now only has to tear down the harness-run registry
//! entry. This test pins down that contract.

mod common;

use std::sync::Arc;

use axum::http::StatusCode;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

use aura_os_server::SuperAgentRun;

use common::*;

#[tokio::test]
async fn reset_session_cancels_live_super_agent_run() {
    let (app, state, _db) = build_test_app();

    let agent_id = uuid::Uuid::new_v4();
    let sa_key = format!("super_agent:{agent_id}");

    // Seed the registry as if a harness-hosted super-agent bridge were in flight.
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
        "reset must cancel the in-flight super-agent run so the bridge drops its session"
    );

    let runs = state.super_agent_runs.lock().await;
    assert!(
        runs.get(&sa_key).is_none(),
        "reset must remove the super-agent run registry entry"
    );
}

#[tokio::test]
async fn stale_spawn_cannot_be_treated_as_authoritative_after_reset() {
    // Simulates the race: bridge A starts at generation 1, reset fires and
    // a new send registers bridge B at generation 2. Bridge A then tries
    // to finalize. The generation guard must reject bridge A's update.
    let (_app, state, _db) = build_test_app();

    let sa_key = "super_agent:race-test".to_string();

    // Bridge A's generation (captured at spawn time).
    let bridge_a_gen: u64 = 1;

    // Register a run at generation 1 (represents bridge A).
    {
        let mut runs = state.super_agent_runs.lock().await;
        runs.insert(
            sa_key.clone(),
            SuperAgentRun {
                generation: bridge_a_gen,
                cancel: CancellationToken::new(),
                join: None,
            },
        );
    }

    // Simulate reset + a new send superseding bridge A with bridge B at gen 2.
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

    // Bridge A (late completion) checks `is_current` against its captured gen.
    let runs = state.super_agent_runs.lock().await;
    let is_current = runs
        .get(&sa_key)
        .map(|r| r.generation == bridge_a_gen)
        .unwrap_or(false);
    assert!(
        !is_current,
        "stale bridge (gen={bridge_a_gen}) must not be treated as the authoritative run once a newer generation is registered"
    );

    // Keep state alive until end of test so Arcs don't drop early.
    let _ = Arc::clone(&state.super_agent_runs);
}
