// Agentic executor E2E integration tests.
//
// Validates engine execution flows using mock LLM + mock storage.

mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use tokio::sync::{mpsc, Mutex};

    use aura_billing::testutil;
    use aura_claude::mock::{MockLlmProvider, MockResponse};
    use aura_core::*;
    use aura_engine::{DevLoopEngine, EngineEvent, LoopOutcome};

    #[derive(Default)]
    struct CannedTurnRuntime;

    #[async_trait::async_trait]
    impl aura_link::AgentRuntime for CannedTurnRuntime {
        async fn execute_turn(
            &self,
            request: aura_link::TurnRequest,
        ) -> Result<aura_link::TurnResult, aura_link::RuntimeError> {
            let tool_calls = vec![aura_link::ToolCall {
                id: "auto_done".into(),
                name: "task_done".into(),
                input: serde_json::json!({"notes": "Auto-completed by test runtime"}),
            }];
            let _results = request.executor.execute(&tool_calls).await;

            Ok(aura_link::TurnResult {
                text: "Task completed by test runtime.".into(),
                thinking: String::new(),
                usage: aura_link::TotalUsage {
                    input_tokens: 100,
                    output_tokens: 50,
                },
                iterations_run: 1,
                timed_out: false,
                insufficient_credits: false,
                llm_error: None,
            })
        }
    }

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
        store: Arc<RocksStore>,
        storage_client: Arc<StorageClient>,
        project_id: ProjectId,
        spec_id: String,
        _tmp: tempfile::TempDir,
    }

    async fn setup(mock: Arc<MockLlmProvider>) -> TestHarness {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        testutil::store_zero_auth_session(&store);
        std::env::set_var("ANTHROPIC_API_KEY", "test-key");

        let billing_state = Arc::new(tokio::sync::Mutex::new(testutil::MockBillingState::new(
            10_000_000,
        )));
        let billing_url = testutil::start_stateful_mock_billing_server(billing_state).await;
        let billing = Arc::new(testutil::billing_client_for_url(&billing_url));

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
            SessionService::new(store.clone(), 0.8, 200_000)
                .with_storage_client(Some(storage_client.clone())),
        );
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        let runtime: Arc<dyn aura_link::AgentRuntime> = Arc::new(
            CannedTurnRuntime::default(),
        );
        let engine = Arc::new(
            DevLoopEngine::new(
                store.clone(),
                settings,
                llm,
                project_service.clone(),
                task_service,
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
                name: "executor-test".into(),
                description: "test".into(),
                linked_folder_path: project_dir.to_string_lossy().to_string(),
                workspace_source: None,
                workspace_display_path: None,
                build_command: None,
                test_command: None,
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

    async fn create_task(h: &TestHarness, title: &str, status: &str) -> String {
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

    async fn create_task_with_deps(h: &TestHarness, title: &str, deps: Vec<String>) -> String {
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
                    status: Some("ready".into()),
                    order_index: Some(1),
                    dependency_ids: Some(deps),
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
    async fn test_execute_task_agentic_simple() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
            "Completed simple task",
        )
        .with_tokens(200, 80)]));
        let mut h = setup(mock.clone()).await;

        create_task(&h, "Add enum definition", "ready").await;

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
        assert!(mock.call_count() >= 1, "LLM should have been called");
    }

    #[tokio::test]
    async fn test_execute_task_agentic_with_deps() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("Dep task done").with_tokens(150, 60),
            MockResponse::text("Main task done with deps").with_tokens(200, 80),
        ]));
        let mut h = setup(mock).await;

        let dep_id = create_task(&h, "Create base types", "ready").await;
        create_task_with_deps(&h, "Implement service using base types", vec![dep_id]).await;

        let handle = h.engine.clone().start(h.project_id, None).await.unwrap();
        let outcome = handle.wait().await.unwrap();

        let events = collect_events(&mut h.event_rx);
        let completed_count = events
            .iter()
            .filter(|e| matches!(e, EngineEvent::TaskCompleted { .. }))
            .count();

        assert!(
            matches!(outcome, LoopOutcome::AllTasksComplete),
            "expected AllTasksComplete, got {outcome:?}"
        );
        assert!(completed_count >= 1, "at least one task should complete");
    }

    #[tokio::test]
    async fn test_shell_task_execution() {
        let mock = Arc::new(MockLlmProvider::new());
        let mut h = setup(mock).await;

        let task_id_str = create_task(&h, "Run cargo --version", "ready").await;

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
        assert!(events
            .iter()
            .any(|e| matches!(e, EngineEvent::BuildVerificationStarted { .. })));
    }

    #[tokio::test]
    async fn test_build_fix_loop() {
        let mut responses = Vec::new();
        for i in 0..50 {
            responses.push(MockResponse::text(format!("Response {i}")).with_tokens(200, 80));
        }
        let mock = Arc::new(MockLlmProvider::with_responses(responses));

        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        testutil::store_zero_auth_session(&store);
        std::env::set_var("ANTHROPIC_API_KEY", "test-key");

        let billing_state = Arc::new(tokio::sync::Mutex::new(testutil::MockBillingState::new(
            10_000_000,
        )));
        let billing_url = testutil::start_stateful_mock_billing_server(billing_state).await;
        let billing = Arc::new(testutil::billing_client_for_url(&billing_url));

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
            SessionService::new(store.clone(), 0.8, 200_000)
                .with_storage_client(Some(storage_client.clone())),
        );
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();

        let project_dir = tmp.path().join("project");
        std::fs::create_dir_all(&project_dir).unwrap();

        let runtime: Arc<dyn aura_link::AgentRuntime> = Arc::new(
            CannedTurnRuntime::default(),
        );
        let engine = Arc::new(
            DevLoopEngine::new(
                store.clone(),
                settings,
                llm,
                project_service.clone(),
                task_service,
                agent_instance_service,
                session_service,
                event_tx,
                runtime,
            )
            .with_storage_client(Some(storage_client.clone())),
        );

        let project = project_service
            .create_project(CreateProjectInput {
                org_id: OrgId::new(),
                name: "build-fix-test".into(),
                description: "test".into(),
                linked_folder_path: project_dir.to_string_lossy().to_string(),
                workspace_source: None,
                workspace_display_path: None,
                build_command: Some("echo fail && exit 1".into()),
                test_command: None,
            })
            .unwrap();

        let jwt = store.get_jwt().unwrap();
        let pid = project.project_id.to_string();

        let spec = storage_client
            .create_spec(
                &pid,
                &jwt,
                &CreateSpecRequest {
                    title: "Build fix spec".into(),
                    order_index: Some(0),
                    markdown_contents: Some("Build test".into()),
                },
            )
            .await
            .unwrap();

        storage_client
            .create_task(
                &pid,
                &jwt,
                &CreateTaskRequest {
                    spec_id: spec.id,
                    title: "Implement feature that needs build fix".into(),
                    description: Some("A feature implementation".into()),
                    status: Some("ready".into()),
                    order_index: Some(0),
                    dependency_ids: None,
                },
            )
            .await
            .unwrap();

        let handle = engine
            .clone()
            .start(project.project_id, None)
            .await
            .unwrap();
        // The loop may exhaust mock responses if retries exceed our budget; either outcome is fine.
        let _outcome = handle.wait().await;

        let events = collect_events(&mut event_rx);

        let has_build_event = events.iter().any(|e| {
            matches!(
                e,
                EngineEvent::BuildVerificationStarted { .. }
                    | EngineEvent::BuildVerificationFailed { .. }
                    | EngineEvent::BuildFixAttempt { .. }
            )
        });
        assert!(
            has_build_event,
            "expected at least one build verification event"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, EngineEvent::LoopFinished { .. })),
            "loop should finish"
        );
    }
}
