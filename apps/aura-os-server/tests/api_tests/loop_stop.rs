use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

#[tokio::test]
async fn loop_stop_without_running_is_idempotent() {
    // Stopping with nothing in the registry is a no-op that returns the
    // current (empty) status instead of a 4xx. This keeps the UI unstuck
    // when the harness has already self-terminated or another client raced
    // us to stop.
    let (app, _, _db) = build_test_app();

    let pid = ProjectId::new();
    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["running"], false);
    assert_eq!(body["paused"], false);
    assert_eq!(
        body["active_agent_instances"]
            .as_array()
            .map(|items| items.len()),
        Some(0)
    );
}

#[tokio::test]
async fn loop_status_includes_active_loop_engineering_contract() {
    use aura_os_core::AgentInstanceId;
    use aura_os_server::ActiveAutomaton;

    let (app, state, _db) = build_test_app();

    let pid = ProjectId::new();
    let aiid = AgentInstanceId::new();
    let contract = serde_json::json!({
        "goal": "Fix checkout flakes and prove the regression is gone",
        "successCriteria": ["Checkout passes", "Regression test covers it"],
        "verifierCommands": [
            {
                "label": "Checkout test",
                "command": "npm test -- checkout",
                "expectedOutcome": "passes"
            }
        ],
        "maxIterations": 5,
        "approvalPolicy": "apply_within_workspace",
        "learning": {
            "captureTrace": true,
            "proposeEvals": true,
            "proposeSkills": true,
            "summarizeRegressions": true
        }
    });
    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            (pid, aiid),
            ActiveAutomaton {
                automaton_id: "auto-loop-engineering".into(),
                project_id: pid,
                template_agent_id: AgentId::new(),
                loop_engineering: Some(contract),
                harness_base_url: "http://127.0.0.1:1".to_string(),
                harness_auth_token: None,
                paused: false,
                alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
                forwarder: None,
                ws_reader_handle: None,
                loop_handle: None,
                last_forwarder_event_at: std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0)),
                session_id: None,
            },
        );
    }

    let req = json_request("GET", &format!("/api/projects/{pid}/loop/status"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;

    assert_eq!(body["running"], true);
    assert_eq!(
        body["loop_engineering"]["goal"],
        "Fix checkout flakes and prove the regression is gone"
    );
    assert_eq!(body["loop_engineering"]["maxIterations"], 5);
    assert_eq!(
        body["loop_engineering"]["verifierCommands"][0]["command"],
        "npm test -- checkout"
    );
}

#[tokio::test]
async fn loop_stop_clears_registry_even_when_harness_unreachable() {
    // If the registry has a live entry but the harness at harness_base_url
    // is unreachable, `client.stop()` errors. The handler should still
    // remove the registry entry, emit `loop_stopped`, and return 200 so the
    // UI returns to the Run state instead of getting stuck on Pause/Stop.
    use aura_os_core::AgentInstanceId;
    use aura_os_server::ActiveAutomaton;

    let (app, state, _db) = build_test_app();

    let pid = ProjectId::new();
    let aiid = AgentInstanceId::new();
    // Point at a port nothing is listening on so the harness stop call fails.
    let unreachable_harness = "http://127.0.0.1:1".to_string();
    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            (pid, aiid),
            ActiveAutomaton {
                automaton_id: "auto-1".into(),
                project_id: pid,
                template_agent_id: AgentId::new(),
                loop_engineering: None,
                harness_base_url: unreachable_harness,
                harness_auth_token: None,
                paused: false,
                alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                forwarder: None,
                ws_reader_handle: None,
                loop_handle: None,
                last_forwarder_event_at: std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0)),
                session_id: None,
            },
        );
    }

    let mut event_rx = state.event_broadcast.subscribe();

    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["running"], false);
    assert_eq!(
        body["active_agent_instances"]
            .as_array()
            .map(|items| items.len()),
        Some(0)
    );

    {
        let reg = state.automaton_registry.lock().await;
        assert!(reg.is_empty(), "registry should be cleared after stop");
    }

    let event = tokio::time::timeout(std::time::Duration::from_secs(1), event_rx.recv())
        .await
        .expect("loop_stopped event should be emitted")
        .expect("broadcast channel should yield an event");
    assert_eq!(event["type"], "loop_stopped");
    assert_eq!(event["project_id"], pid.to_string());
    assert_eq!(event["agent_instance_id"], aiid.to_string());
}

/// Regression: a Stop must publish `LoopEnded` synchronously on the
/// calling task (via the registry entry's `Arc<LoopHandle>`) before
/// the forwarder finishes unwinding. Previously the only path to
/// `LoopEnded` was the `Drop` impl on the forwarder's clone, which
/// fires after the forwarder task unwinds — under a rapid Stop+Start
/// cycle that race let the new `LoopOpened` land on the client ahead
/// of the late `LoopEnded` for the previous loop instance, leaving
/// the UI anchored to a stale activity row and the AutomationBar
/// play-button ring spinning forever.
#[tokio::test]
async fn loop_stop_publishes_loop_ended_synchronously() {
    use aura_os_core::{AgentInstanceId, UserId};
    use aura_os_events::{DomainEvent, LoopId, LoopKind, SubscriptionFilter, Topic};
    use aura_os_server::ActiveAutomaton;

    let (app, state, _db) = build_test_app();

    let pid = ProjectId::new();
    let aiid = AgentInstanceId::new();
    let template_agent_id = AgentId::new();

    // Subscribe to the typed event hub BEFORE we open the LoopHandle
    // so we observe both the `LoopOpened` and the post-Stop
    // `LoopEnded`.
    let (_guard, mut rx) = state
        .event_hub
        .subscribe(SubscriptionFilter::empty().with_topic(Topic::Project(pid)));

    // Open a real registry entry; the LoopHandle is the field
    // `abort_and_remove` must consume for the synchronous
    // `mark_cancelled` to fire.
    let loop_handle = std::sync::Arc::new(state.loop_registry.open(LoopId::new(
        UserId::new(),
        Some(pid),
        Some(aiid),
        template_agent_id,
        LoopKind::Automation,
    )));

    // Drain the `LoopOpened` that fires inline from `open()` above so
    // the next event we observe is unambiguously the one Stop emits.
    let opened = tokio::time::timeout(std::time::Duration::from_millis(250), rx.recv())
        .await
        .expect("LoopOpened should land within 250ms")
        .expect("event hub subscription should yield an event");
    assert!(
        matches!(opened.as_ref(), DomainEvent::LoopOpened(_)),
        "expected LoopOpened from registry.open(), got: {:?}",
        opened.as_ref()
    );

    let unreachable_harness = "http://127.0.0.1:1".to_string();
    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            (pid, aiid),
            ActiveAutomaton {
                automaton_id: "auto-1".into(),
                project_id: pid,
                template_agent_id,
                loop_engineering: None,
                harness_base_url: unreachable_harness,
                harness_auth_token: None,
                paused: false,
                alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
                forwarder: None,
                ws_reader_handle: None,
                loop_handle: Some(loop_handle.clone()),
                last_forwarder_event_at: std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0)),
                session_id: None,
            },
        );
    }

    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // `LoopEnded` must arrive promptly — it is published by
    // `abort_and_remove` on the calling task, NOT on the (absent in
    // this test) forwarder's drop path. A timeout means the fix
    // regressed back to relying on `Drop`.
    let event = tokio::time::timeout(std::time::Duration::from_millis(250), rx.recv())
        .await
        .expect("LoopEnded must be emitted within 250ms of Stop")
        .expect("event hub subscription should yield an event");
    match event.as_ref() {
        DomainEvent::LoopEnded(payload) => {
            assert_eq!(payload.loop_id.project_id, Some(pid));
            assert_eq!(payload.loop_id.agent_instance_id, Some(aiid));
        }
        other => panic!("expected LoopEnded, got: {other:?}"),
    }

    // And the registry entry must be gone (existing invariant).
    {
        let reg = state.automaton_registry.lock().await;
        assert!(reg.is_empty(), "registry should be cleared after stop");
    }
}
