// Engine orchestrator loop integration tests.
//
// Uses the mock storage server from `aura_storage::testutil` to seed tasks
// and specs, replacing the old RocksDB-based `store.put_task` / `store.put_spec`.

mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use tokio::sync::{mpsc, Mutex};

    use aura_billing::testutil;
    use aura_claude::mock::{MockLlmProvider, MockResponse};
    use aura_core::*;
    use aura_engine::{DevLoopEngine, EngineEvent, LoopOutcome};

    use aura_agents::AgentInstanceService;
    use aura_projects::{CreateProjectInput, ProjectService};
    use aura_sessions::SessionService;
    use aura_settings::SettingsService;
    use aura_storage::{CreateSpecRequest, CreateTaskRequest, StorageClient};
    use aura_store::RocksStore;
    use aura_tasks::TaskService;

    struct TestHarness {
        engine: Arc<DevLoopEngine>,
        event_rx: mpsc::UnboundedReceiver<EngineEvent>,
        #[allow(dead_code)] // kept for JWT access and future assertions
        store: Arc<RocksStore>,
        storage_client: Arc<StorageClient>,
        project_id: ProjectId,
        spec_id: String,
        _tmp: tempfile::TempDir,
    }

    struct SetupConfig {
        zero_balance: bool,
        build_command: Option<String>,
        test_command: Option<String>,
        rollover_threshold: f64,
        model_context_window: u64,
    }

    impl Default for SetupConfig {
        fn default() -> Self {
            Self {
                zero_balance: false,
                build_command: None,
                test_command: None,
                rollover_threshold: 0.8,
                model_context_window: 200_000,
            }
        }
    }

    /// Start a mock storage server + billing, wire everything together.
    async fn setup_with_config(mock: Arc<MockLlmProvider>, cfg: SetupConfig) -> TestHarness {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());

        // JWT is always needed for storage operations
        testutil::store_zero_auth_session(&store);

        // Safe for parallel tests: all tests set the same idempotent value.
        std::env::set_var("ANTHROPIC_API_KEY", "test-key");

        // Billing: use stateful mock so we can control balance
        let billing_state = Arc::new(tokio::sync::Mutex::new(testutil::MockBillingState::new(
            if cfg.zero_balance { 0 } else { 10_000_000 },
        )));
        let billing_url = testutil::start_stateful_mock_billing_server(billing_state).await;
        let billing = Arc::new(testutil::billing_client_for_url(&billing_url));

        // Storage: mock HTTP server
        let (storage_url, _mock_db) = aura_storage::testutil::start_mock_storage().await;
        let storage_client = Arc::new(StorageClient::with_base_url(&storage_url));

        let llm = Arc::new(aura_billing::MeteredLlm::new(mock, billing, store.clone()));
        let settings = Arc::new(SettingsService::new(store.clone()));
        let project_service = Arc::new(ProjectService::new(store.clone()));
        let task_service = Arc::new(TaskService::new(
            store.clone(),
            Some(storage_client.clone()),
        ));
        let runtime_agent_state = Arc::new(Mutex::new(HashMap::new()));
        let agent_instance_service = Arc::new(AgentInstanceService::new(
            store.clone(),
            Some(storage_client.clone()),
            runtime_agent_state,
            None,
        ));
        let session_service = Arc::new(
            SessionService::new(
                store.clone(),
                cfg.rollover_threshold,
                cfg.model_context_window,
            )
            .with_storage_client(Some(storage_client.clone())),
        );
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        let runtime: Arc<dyn aura_link::AgentRuntime> = Arc::new(
            aura_chat::InternalRuntime::new(llm.clone(), settings.clone()),
        );
        let engine = Arc::new(
            DevLoopEngine::new(
                store.clone(),
                settings,
                llm,
                project_service.clone(),
                task_service.clone(),
                agent_instance_service,
                session_service,
                event_tx,
                runtime,
            )
            .with_storage_client(Some(storage_client.clone())),
        );

        let project_dir = tmp.path().join("project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let project = project_service
            .create_project(CreateProjectInput {
                org_id: OrgId::new(),
                name: "test-project".into(),
                description: "test".into(),
                linked_folder_path: project_dir.to_string_lossy().to_string(),
                workspace_source: None,
                workspace_display_path: None,
                build_command: cfg.build_command,
                test_command: cfg.test_command,
            })
            .unwrap();

        let jwt = store.get_jwt().unwrap();
        let pid = project.project_id.to_string();

        let spec = storage_client
            .create_spec(
                &pid,
                &jwt,
                &CreateSpecRequest {
                    title: "Test spec".into(),
                    order_index: Some(0),
                    markdown_contents: Some("Test specification".into()),
                },
            )
            .await
            .unwrap();

        TestHarness {
            engine,
            event_rx,
            store,
            storage_client,
            project_id: project.project_id,
            spec_id: spec.id,
            _tmp: tmp,
        }
    }

    async fn setup_with_billing(mock: Arc<MockLlmProvider>, zero_balance: bool) -> TestHarness {
        setup_with_config(
            mock,
            SetupConfig {
                zero_balance,
                ..Default::default()
            },
        )
        .await
    }

    async fn setup(mock: Arc<MockLlmProvider>) -> TestHarness {
        setup_with_billing(mock, false).await
    }

    /// Create a task in mock storage with the given status string.
    async fn create_storage_task(h: &TestHarness, title: &str, status: &str) -> String {
        let jwt = h.store.get_jwt().unwrap();
        let task = h
            .storage_client
            .create_task(
                &h.project_id.to_string(),
                &jwt,
                &CreateTaskRequest {
                    spec_id: h.spec_id.clone(),
                    title: title.into(),
                    description: Some(format!("Description for {title}")),
                    status: Some(status.into()),
                    order_index: Some(0),
                    dependency_ids: None,
                },
            )
            .await
            .unwrap();
        task.id
    }

    fn collect_events(rx: &mut mpsc::UnboundedReceiver<EngineEvent>) -> Vec<EngineEvent> {
        let mut events = Vec::new();
        while let Ok(e) = rx.try_recv() {
            events.push(e);
        }
        events
    }

    #[tokio::test]
    async fn loop_completes_single_task() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
            "Task completed successfully",
        )]));
        let mut h = setup(mock).await;

        let task_id_str = create_storage_task(&h, "Implement feature A", "ready").await;

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        assert!(
            matches!(outcome, LoopOutcome::AllTasksComplete),
            "expected AllTasksComplete, got {outcome:?}"
        );

        let events = collect_events(&mut h.event_rx);
        assert!(events
            .iter()
            .any(|e| matches!(e, EngineEvent::TaskStarted { .. })));
        assert!(events
            .iter()
            .any(|e| matches!(e, EngineEvent::TaskCompleted { .. })));
        assert!(events
            .iter()
            .any(|e| matches!(e, EngineEvent::LoopFinished { .. })));

        let jwt = h.store.get_jwt().unwrap();
        let stored = h.storage_client.get_task(&task_id_str, &jwt).await.unwrap();
        assert_eq!(stored.status.as_deref(), Some("done"));
    }

    #[tokio::test]
    async fn loop_pause_returns_paused_outcome() {
        let mock = Arc::new(MockLlmProvider::new());
        let mut h = setup(mock).await;

        // No tasks: loop may complete before seeing the pause signal (timing-dependent).
        // We accept either outcome; the important thing is it doesn't hang or error.
        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        handle.pause();
        let outcome = handle.wait().await.expect("loop should complete");

        assert!(
            matches!(
                outcome,
                LoopOutcome::Paused { .. } | LoopOutcome::AllTasksComplete
            ),
            "expected Paused or AllTasksComplete, got {outcome:?}"
        );

        let events = collect_events(&mut h.event_rx);
        assert!(events.iter().any(|e| {
            matches!(
                e,
                EngineEvent::LoopPaused { .. } | EngineEvent::LoopFinished { .. }
            )
        }));
    }

    #[tokio::test]
    async fn loop_stop_returns_stopped_outcome() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("done 1"),
            MockResponse::text("done 2"),
        ]));
        let mut h = setup(mock).await;

        create_storage_task(&h, "Task 1", "ready").await;
        create_storage_task(&h, "Task 2", "ready").await;

        // Stop is non-blocking; the loop may complete all tasks before processing
        // the signal (timing-dependent).
        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        handle.stop();
        let outcome = handle.wait().await.expect("loop should complete");

        let is_valid = matches!(
            outcome,
            LoopOutcome::Stopped { .. } | LoopOutcome::AllTasksComplete
        );
        assert!(
            is_valid,
            "expected Stopped or AllTasksComplete, got {outcome:?}"
        );

        let events = collect_events(&mut h.event_rx);
        assert!(events.iter().any(|e| {
            matches!(
                e,
                EngineEvent::LoopStopped { .. } | EngineEvent::LoopFinished { .. }
            )
        }));
    }

    #[tokio::test]
    async fn loop_retries_failed_tasks() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
            "done on retry",
        )]));
        let mut h = setup(mock).await;

        create_storage_task(&h, "Flaky task", "failed").await;

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        let events = collect_events(&mut h.event_rx);
        let has_retry_ready = events
            .iter()
            .any(|e| matches!(e, EngineEvent::TaskBecameReady { .. }));
        assert!(
            has_retry_ready,
            "expected TaskBecameReady for the failed task"
        );

        assert!(
            matches!(
                outcome,
                LoopOutcome::AllTasksComplete | LoopOutcome::AllTasksBlocked
            ),
            "expected AllTasksComplete or AllTasksBlocked, got {outcome:?}"
        );
    }

    #[tokio::test]
    async fn loop_completes_shell_task() {
        let mock = Arc::new(MockLlmProvider::new());
        let mut h = setup(mock).await;

        let task_id_str = create_storage_task(&h, "Run cargo --version", "ready").await;

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        assert!(
            matches!(outcome, LoopOutcome::AllTasksComplete),
            "expected AllTasksComplete for shell task, got {outcome:?}"
        );

        let jwt = h.store.get_jwt().unwrap();
        let stored = h.storage_client.get_task(&task_id_str, &jwt).await.unwrap();
        assert_eq!(stored.status.as_deref(), Some("done"));

        let events = collect_events(&mut h.event_rx);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, EngineEvent::BuildVerificationStarted { .. })),
            "shell task should emit BuildVerificationStarted"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, EngineEvent::BuildVerificationPassed { .. })),
            "shell task should emit BuildVerificationPassed"
        );
    }

    #[tokio::test]
    async fn loop_runs_build_verification_when_configured() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
            "Task completed successfully",
        )]));

        let mut h = setup_with_config(
            mock,
            SetupConfig {
                build_command: Some("cargo --version".into()),
                ..Default::default()
            },
        )
        .await;

        create_storage_task(&h, "Implement feature A", "ready").await;

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        assert!(
            matches!(outcome, LoopOutcome::AllTasksComplete),
            "expected AllTasksComplete, got {outcome:?}"
        );

        let events = collect_events(&mut h.event_rx);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, EngineEvent::BuildVerificationStarted { .. })),
            "should trigger build verification"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, EngineEvent::BuildVerificationPassed { .. })),
            "build verification should pass"
        );
    }

    #[tokio::test]
    async fn loop_triggers_session_rollover() {
        // High token counts on task responses ensure context_usage_estimate exceeds the
        // rollover threshold (0.01 of 10k window = 100 tokens).
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("Task 1 done").with_tokens(5_000, 5_000),
            MockResponse::text("Summary after task 1").with_tokens(100, 50),
            MockResponse::text("Task 2 done").with_tokens(5_000, 5_000),
            MockResponse::text("Summary after task 2").with_tokens(100, 50),
            MockResponse::text("Task 3 done").with_tokens(5_000, 5_000),
            MockResponse::text("Extra summary").with_tokens(100, 50),
            MockResponse::text("Extra response").with_tokens(100, 50),
        ]));

        let mut h = setup_with_config(
            mock,
            SetupConfig {
                rollover_threshold: 0.01,
                model_context_window: 10_000,
                ..Default::default()
            },
        )
        .await;

        for i in 0..3 {
            let jwt = h.store.get_jwt().unwrap();
            h.storage_client
                .create_task(
                    &h.project_id.to_string(),
                    &jwt,
                    &CreateTaskRequest {
                        spec_id: h.spec_id.clone(),
                        title: format!("Task {}", i + 1),
                        description: Some(format!("Task {} desc", i + 1)),
                        status: Some("ready".into()),
                        order_index: Some(i),
                        dependency_ids: None,
                    },
                )
                .await
                .unwrap();
        }

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        assert!(
            matches!(outcome, LoopOutcome::AllTasksComplete),
            "expected AllTasksComplete, got {outcome:?}"
        );

        let events = collect_events(&mut h.event_rx);

        let rollover_count = events
            .iter()
            .filter(|e| matches!(e, EngineEvent::SessionRolledOver { .. }))
            .count();
        assert!(
            rollover_count >= 1,
            "expected at least one SessionRolledOver event, got {rollover_count}"
        );

        let tasks_completed = events
            .iter()
            .filter(|e| matches!(e, EngineEvent::TaskCompleted { .. }))
            .count();
        assert!(
            tasks_completed >= 2,
            "expected at least 2 tasks completed despite rollover, got {tasks_completed}"
        );
    }

    #[tokio::test]
    async fn loop_stops_on_credits_exhausted() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
            "unreachable",
        )]));
        let mut h = setup_with_billing(mock, true).await;

        create_storage_task(&h, "Task that needs credits", "ready").await;

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        assert!(
            matches!(outcome, LoopOutcome::AllTasksBlocked),
            "expected AllTasksBlocked due to credits exhaustion, got {outcome:?}"
        );

        let events = collect_events(&mut h.event_rx);
        assert!(events
            .iter()
            .any(|e| matches!(e, EngineEvent::LoopFinished { .. })));
    }
}
