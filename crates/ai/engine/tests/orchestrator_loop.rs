use std::sync::Arc;

use chrono::Utc;
use tokio::sync::mpsc;

use aura_billing::testutil;
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_core::*;
use aura_engine::{DevLoopEngine, EngineEvent, LoopOutcome};

use aura_agents::AgentInstanceService;
use aura_projects::{CreateProjectInput, ProjectService};
use aura_sessions::SessionService;
use aura_settings::SettingsService;
use aura_store::RocksStore;
use aura_tasks::TaskService;

struct TestHarness {
    engine: Arc<DevLoopEngine>,
    event_rx: mpsc::UnboundedReceiver<EngineEvent>,
    store: Arc<RocksStore>,
    project_id: ProjectId,
    spec_id: SpecId,
    _tmp: tempfile::TempDir,
}

async fn setup_with_auth(mock: Arc<MockLlmProvider>, store_auth: bool) -> TestHarness {
    let billing_url = testutil::start_mock_billing_server().await;
    let billing = Arc::new(testutil::billing_client_for_url(&billing_url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    if store_auth {
        testutil::store_zero_auth_session(&store);
    }

    std::env::set_var("ANTHROPIC_API_KEY", "test-key");

    let llm = Arc::new(aura_billing::MeteredLlm::new(mock, billing, store.clone()));
    let settings = Arc::new(SettingsService::new(store.clone()));
    let project_service = Arc::new(ProjectService::new(store.clone()));
    let task_service = Arc::new(TaskService::new(store.clone()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(store.clone()));
    let session_service = Arc::new(SessionService::new(store.clone(), 0.8, 200_000));
    let (event_tx, event_rx) = mpsc::unbounded_channel();

    let engine = Arc::new(DevLoopEngine::new(
        store.clone(),
        settings,
        llm,
        project_service.clone(),
        task_service.clone(),
        agent_instance_service,
        session_service,
        event_tx,
    ));

    let project_dir = tmp.path().join("project");
    std::fs::create_dir_all(&project_dir).unwrap();

    let project = project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "test-project".into(),
            description: "test".into(),
            linked_folder_path: project_dir.to_string_lossy().to_string(),
            build_command: None,
            test_command: None,
        })
        .unwrap();

    let spec_id = SpecId::new();
    let spec = Spec {
        spec_id,
        project_id: project.project_id,
        title: "Test spec".into(),
        order_index: 0,
        markdown_contents: "Test specification".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    store.put_spec(&spec).unwrap();

    TestHarness {
        engine,
        event_rx,
        store,
        project_id: project.project_id,
        spec_id,
        _tmp: tmp,
    }
}

async fn setup(mock: Arc<MockLlmProvider>) -> TestHarness {
    setup_with_auth(mock, true).await
}

fn make_task(project_id: ProjectId, spec_id: SpecId, title: &str, status: TaskStatus) -> Task {
    let now = Utc::now();
    Task {
        task_id: TaskId::new(),
        project_id,
        spec_id,
        title: title.into(),
        description: format!("Description for {title}"),
        status,
        order_index: 0,
        dependency_ids: vec![],
        parent_task_id: None,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: vec![],
        build_steps: vec![],
        test_steps: vec![],
        live_output: String::new(),
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: now,
        updated_at: now,
    }
}

fn collect_events(rx: &mut mpsc::UnboundedReceiver<EngineEvent>) -> Vec<EngineEvent> {
    let mut events = Vec::new();
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    events
}

/// The loop should pick up a single ready task, execute it with the mock LLM,
/// mark it Done, and finish with AllTasksComplete.
#[tokio::test]
async fn loop_completes_single_task() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("Task completed successfully"),
    ]));
    let mut h = setup(mock).await;

    let task = make_task(h.project_id, h.spec_id, "Implement feature A", TaskStatus::Ready);
    h.store.put_task(&task).unwrap();

    let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
    let outcome = handle.wait().await.unwrap();

    assert!(
        matches!(outcome, LoopOutcome::AllTasksComplete),
        "expected AllTasksComplete, got {outcome:?}"
    );

    let events = collect_events(&mut h.event_rx);
    assert!(events.iter().any(|e| matches!(e, EngineEvent::TaskStarted { .. })));
    assert!(events.iter().any(|e| matches!(e, EngineEvent::TaskCompleted { .. })));
    assert!(events.iter().any(|e| matches!(e, EngineEvent::LoopFinished { .. })));

    let stored = h.store.find_task_by_id(&task.task_id).unwrap().unwrap();
    assert_eq!(stored.status, TaskStatus::Done);
}

/// Sending Pause before any tasks run should yield a Paused or
/// AllTasksComplete outcome (depending on timing).
#[tokio::test]
async fn loop_pause_returns_paused_outcome() {
    let mock = Arc::new(MockLlmProvider::new());
    let mut h = setup(mock).await;

    let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
    handle.pause();
    let outcome = handle.wait().await.unwrap();

    assert!(
        matches!(outcome, LoopOutcome::Paused { .. } | LoopOutcome::AllTasksComplete),
        "expected Paused or AllTasksComplete (no tasks), got {outcome:?}"
    );

    let events = collect_events(&mut h.event_rx);
    assert!(events.iter().any(|e| {
        matches!(e, EngineEvent::LoopPaused { .. } | EngineEvent::LoopFinished { .. })
    }));
}

/// Sending Stop with pending tasks should yield Stopped (or complete if the
/// loop finished before the signal arrived).
#[tokio::test]
async fn loop_stop_returns_stopped_outcome() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("done 1"),
        MockResponse::text("done 2"),
    ]));
    let mut h = setup(mock).await;

    let t1 = make_task(h.project_id, h.spec_id, "Task 1", TaskStatus::Ready);
    let t2 = make_task(h.project_id, h.spec_id, "Task 2", TaskStatus::Ready);
    h.store.put_task(&t1).unwrap();
    h.store.put_task(&t2).unwrap();

    let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
    handle.stop();
    let outcome = handle.wait().await.unwrap();

    let is_valid = matches!(
        outcome,
        LoopOutcome::Stopped { .. } | LoopOutcome::AllTasksComplete
    );
    assert!(is_valid, "expected Stopped or AllTasksComplete, got {outcome:?}");

    let events = collect_events(&mut h.event_rx);
    assert!(events.iter().any(|e| {
        matches!(e, EngineEvent::LoopStopped { .. } | EngineEvent::LoopFinished { .. })
    }));
}

/// A task that starts in Failed status should be retried by the loop's
/// `try_retry_failed` logic and eventually executed.
#[tokio::test]
async fn loop_retries_failed_tasks() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("done on retry"),
    ]));
    let mut h = setup(mock).await;

    let task = make_task(h.project_id, h.spec_id, "Flaky task", TaskStatus::Failed);
    h.store.put_task(&task).unwrap();

    let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
    let outcome = handle.wait().await.unwrap();

    let events = collect_events(&mut h.event_rx);
    let has_retry_ready = events.iter().any(|e| {
        matches!(e, EngineEvent::TaskBecameReady { task_id, .. } if *task_id == task.task_id)
    });
    assert!(has_retry_ready, "expected TaskBecameReady for the failed task");

    assert!(
        matches!(outcome, LoopOutcome::AllTasksComplete | LoopOutcome::AllTasksBlocked),
        "expected AllTasksComplete or AllTasksBlocked, got {outcome:?}"
    );
}

/// A task whose title triggers `extract_shell_command` should bypass the LLM
/// and run the command directly.  `cargo --version` is safe and cross-platform
/// for any environment that can build this crate.
#[tokio::test]
async fn loop_completes_shell_task() {
    let mock = Arc::new(MockLlmProvider::new());
    let mut h = setup(mock).await;

    let task = make_task(
        h.project_id, h.spec_id,
        "Run cargo --version",
        TaskStatus::Ready,
    );
    h.store.put_task(&task).unwrap();

    let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
    let outcome = handle.wait().await.unwrap();

    assert!(
        matches!(outcome, LoopOutcome::AllTasksComplete),
        "expected AllTasksComplete for shell task, got {outcome:?}"
    );

    let stored = h.store.find_task_by_id(&task.task_id).unwrap().unwrap();
    assert_eq!(stored.status, TaskStatus::Done);

    let events = collect_events(&mut h.event_rx);
    assert!(
        events.iter().any(|e| matches!(e, EngineEvent::BuildVerificationStarted { .. })),
        "shell task should emit BuildVerificationStarted"
    );
    assert!(
        events.iter().any(|e| matches!(e, EngineEvent::BuildVerificationPassed { .. })),
        "shell task should emit BuildVerificationPassed"
    );
}

/// A task with a build command configured on the project should trigger
/// `verify_and_fix_build` after agentic execution.
#[tokio::test]
async fn loop_runs_build_verification_when_configured() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("Task completed successfully"),
    ]));
    let billing_url = testutil::start_mock_billing_server().await;
    let billing = Arc::new(testutil::billing_client_for_url(&billing_url));
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    testutil::store_zero_auth_session(&store);

    std::env::set_var("ANTHROPIC_API_KEY", "test-key");

    let llm = Arc::new(aura_billing::MeteredLlm::new(mock, billing, store.clone()));
    let settings = Arc::new(SettingsService::new(store.clone()));
    let project_service = Arc::new(ProjectService::new(store.clone()));
    let task_service = Arc::new(TaskService::new(store.clone()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(store.clone()));
    let session_service = Arc::new(SessionService::new(store.clone(), 0.8, 200_000));
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();

    let engine = Arc::new(DevLoopEngine::new(
        store.clone(), settings, llm,
        project_service.clone(), task_service.clone(),
        agent_instance_service, session_service, event_tx,
    ));

    let project_dir = tmp.path().join("project");
    std::fs::create_dir_all(&project_dir).unwrap();

    let project = project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "build-test-project".into(),
            description: "test".into(),
            linked_folder_path: project_dir.to_string_lossy().to_string(),
            build_command: Some("cargo --version".into()),
            test_command: None,
        })
        .unwrap();

    let spec_id = SpecId::new();
    let spec = Spec {
        spec_id,
        project_id: project.project_id,
        title: "Test spec".into(),
        order_index: 0,
        markdown_contents: "Test specification".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    store.put_spec(&spec).unwrap();

    let task = make_task(project.project_id, spec_id, "Implement feature A", TaskStatus::Ready);
    store.put_task(&task).unwrap();

    let handle = engine.clone().start(project.project_id, None).await.unwrap();
    let outcome = handle.wait().await.unwrap();

    assert!(
        matches!(outcome, LoopOutcome::AllTasksComplete),
        "expected AllTasksComplete, got {outcome:?}"
    );

    let events = collect_events(&mut event_rx);
    assert!(
        events.iter().any(|e| matches!(e, EngineEvent::BuildVerificationStarted { .. })),
        "should trigger build verification"
    );
    assert!(
        events.iter().any(|e| matches!(e, EngineEvent::BuildVerificationPassed { .. })),
        "build verification should pass"
    );
}

/// When there is no billing auth token, the LLM pre-flight check flags
/// credits as exhausted. The loop should detect this and stop early.
#[tokio::test]
async fn loop_stops_on_credits_exhausted() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("unreachable"),
    ]));
    let mut h = setup_with_auth(mock, false).await;

    let task = make_task(h.project_id, h.spec_id, "Task that needs credits", TaskStatus::Ready);
    h.store.put_task(&task).unwrap();

    let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
    let outcome = handle.wait().await.unwrap();

    assert!(
        matches!(outcome, LoopOutcome::AllTasksBlocked),
        "expected AllTasksBlocked due to credits exhaustion, got {outcome:?}"
    );

    let events = collect_events(&mut h.event_rx);
    assert!(events.iter().any(|e| matches!(e, EngineEvent::LoopFinished { .. })));
}
