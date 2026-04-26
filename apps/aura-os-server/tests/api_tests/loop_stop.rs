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
                harness_base_url: unreachable_harness,
                paused: false,
                alive: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                forwarder: None,
                current_task_id: None,
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
