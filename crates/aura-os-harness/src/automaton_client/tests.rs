use super::{
    normalize_automaton_event, AutomatonStartParams, AutomatonStartResult, WsReaderHandle,
};
use aura_protocol::{AgentPermissionsWire, AgentScopeWire, CapabilityWire};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Spawns a task that never completes on its own, returns a
/// [`WsReaderHandle`] wired to its `AbortHandle`, and an
/// [`Arc<AtomicBool>`] that flips to `true` if the task runs its
/// `Drop` guard (i.e. was aborted). Lets the tests assert
/// aborted-vs-still-running without racing a time-based sleep.
async fn spawn_cancel_probe() -> (WsReaderHandle, Arc<AtomicBool>) {
    struct AbortFlag(Arc<AtomicBool>);
    impl Drop for AbortFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    let flag = Arc::new(AtomicBool::new(false));
    let task_flag = flag.clone();
    let task = tokio::spawn(async move {
        let _guard = AbortFlag(task_flag);
        // Hold until aborted.
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
    // Yield so the task is actually scheduled before we return.
    tokio::task::yield_now().await;
    (WsReaderHandle::new(task.abort_handle()), flag)
}

#[tokio::test]
async fn ws_reader_handle_cancel_aborts_spawned_task() {
    let (handle, flag) = spawn_cancel_probe().await;
    assert!(!flag.load(Ordering::SeqCst));
    handle.cancel();
    // Give tokio a chance to run the abort.
    for _ in 0..10 {
        if flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        flag.load(Ordering::SeqCst),
        "cancel() should have aborted the spawned reader task"
    );
}

#[tokio::test]
async fn ws_reader_handle_drop_aborts_spawned_task() {
    let (handle, flag) = spawn_cancel_probe().await;
    assert!(!flag.load(Ordering::SeqCst));
    drop(handle);
    for _ in 0..10 {
        if flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        flag.load(Ordering::SeqCst),
        "dropping the last WsReaderHandle should abort the spawned reader task"
    );
}

#[tokio::test]
async fn ws_reader_handle_clone_keeps_task_alive_until_last_drop() {
    let (handle, flag) = spawn_cancel_probe().await;
    let clone = handle.clone();
    drop(handle);
    // The clone still holds the Arc -- the inner `AbortHandle`
    // must not have been dropped yet, so the task keeps running.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert!(
        !flag.load(Ordering::SeqCst),
        "cloned WsReaderHandle must keep the reader alive when other clones drop"
    );
    drop(clone);
    for _ in 0..10 {
        if flag.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        flag.load(Ordering::SeqCst),
        "dropping the last clone should abort the spawned reader task"
    );
}

#[test]
fn automaton_start_result_accepts_ws_url_alias() {
    let result: AutomatonStartResult = serde_json::from_value(serde_json::json!({
        "id": "auto-123",
        "ws_url": "/stream/automaton/auto-123",
    }))
    .expect("start result should deserialize");

    assert_eq!(result.automaton_id, "auto-123");
    assert_eq!(result.event_stream_url, "/stream/automaton/auto-123");
}

#[test]
fn automaton_start_params_serializes_agent_permissions() {
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: None,
        aura_agent_id: None,
        template_agent_id: None,
        auth_token: None,
        model: None,
        system_prompt: None,
        provider_overrides: None,
        user_id: None,
        intent_classifier: None,
        max_turns: None,
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire {
            scope: AgentScopeWire::default(),
            capabilities: vec![CapabilityWire::InvokeProcess],
        },
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: None,
        aura_session_id: None,
    };

    let value = serde_json::to_value(params).expect("serialize params");

    assert_eq!(
        value["agent_permissions"]["capabilities"][0]["type"],
        "invokeProcess"
    );
}

#[test]
fn automaton_start_params_serializes_proxy_identity_context() {
    let params = AutomatonStartParams {
        project_id: "project-1".into(),
        agent_id: Some("template-1::instance-1".into()),
        aura_agent_id: Some("template-1".into()),
        template_agent_id: Some("template-1".into()),
        auth_token: Some("jwt".into()),
        model: Some("aura-claude-opus-4-7".into()),
        system_prompt: Some("project-aware prompt".into()),
        provider_overrides: Some(aura_protocol::SessionModelOverrides {
            default_model: Some("aura-claude-opus-4-7".into()),
            fallback_model: None,
            prompt_caching_enabled: Some(true),
        }),
        user_id: Some("user-1".into()),
        intent_classifier: None,
        max_turns: Some(40),
        workspace_root: None,
        task_id: None,
        git_repo_url: None,
        git_branch: None,
        installed_tools: None,
        installed_integrations: None,
        agent_permissions: AgentPermissionsWire::default(),
        prior_failure: None,
        work_log: Vec::new(),
        aura_org_id: Some("org-1".into()),
        aura_session_id: Some("session-1".into()),
    };

    let value = serde_json::to_value(params).expect("serialize params");

    assert_eq!(value["project_id"], "project-1");
    assert_eq!(value["agent_id"], "template-1::instance-1");
    assert_eq!(value["aura_agent_id"], "template-1");
    assert_eq!(value["template_agent_id"], "template-1");
    assert_eq!(value["aura_org_id"], "org-1");
    assert_eq!(value["aura_session_id"], "session-1");
    assert_eq!(value["auth_token"], "jwt");
    assert_eq!(value["model"], "aura-claude-opus-4-7");
    assert_eq!(value["system_prompt"], "project-aware prompt");
    assert_eq!(
        value["provider_overrides"]["default_model"],
        "aura-claude-opus-4-7"
    );
    assert_eq!(value["provider_overrides"]["prompt_caching_enabled"], true);
    assert_eq!(value["user_id"], "user-1");
    assert_eq!(value["max_turns"], 40);
}

#[test]
fn normalize_automaton_event_promotes_git_sync_milestones() {
    let event = normalize_automaton_event(serde_json::json!({
        "type": "sync_milestone",
        "summary": "Committed and pushed",
        "milestone": {
            "kind": "git_pushed",
            "commit_sha": "abc12345",
            "branch": "main",
            "remote": "origin",
            "push_id": "push-1",
            "commits": ["abc12345"],
        }
    }));

    assert_eq!(event["type"], "git_pushed");
    assert_eq!(event["commit_sha"], "abc12345");
    assert_eq!(event["branch"], "main");
    assert_eq!(event["remote"], "origin");
    assert_eq!(event["push_id"], "push-1");
    assert_eq!(event["summary"], "Committed and pushed");
}
