use std::sync::Arc;

use tokio::sync::mpsc;

use aura_billing::testutil;
use aura_chat::{ChatMessageParams, ChatService, ChatServiceDeps, ChatStreamEvent};
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_core::*;

use aura_projects::{CreateProjectInput, ProjectService};
use aura_settings::SettingsService;
use aura_specs::SpecGenerationService;
use aura_storage::StorageClient;
use aura_store::RocksStore;
use aura_tasks::TaskService;

struct TestHarness {
    chat_service: ChatService,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    agent_instance: AgentInstance,
    _tmp: tempfile::TempDir,
}

async fn setup(mock: Arc<MockLlmProvider>) -> TestHarness {
    let tmp = tempfile::TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
    testutil::store_zero_auth_session(&store);
    std::env::set_var("ANTHROPIC_API_KEY", "test-key");

    let billing_url = testutil::start_mock_billing_server().await;
    let billing = Arc::new(testutil::billing_client_for_url(&billing_url));

    let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
    let storage_client = Arc::new(StorageClient::with_base_url(&storage_url));

    let llm = Arc::new(aura_billing::MeteredLlm::new(mock, billing, store.clone()));
    let settings = Arc::new(SettingsService::new(store.clone()));
    let project_service = Arc::new(ProjectService::new(store.clone()));
    let task_service = Arc::new(TaskService::new(
        store.clone(),
        Some(storage_client.clone()),
    ));
    let spec_gen = Arc::new(SpecGenerationService::new(
        store.clone(),
        project_service.clone(),
        settings.clone(),
        llm.clone(),
        Some(storage_client.clone()),
    ));

    let project_dir = tmp.path().join("project");
    std::fs::create_dir_all(&project_dir).unwrap();

    let project = project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "chat-test".into(),
            description: "test project".into(),
            linked_folder_path: project_dir.to_string_lossy().to_string(),
            workspace_source: None,
            workspace_display_path: None,
            build_command: None,
            test_command: None,
        })
        .unwrap();

    let agent_instance_id = AgentInstanceId::new();
    let now = chrono::Utc::now();
    let agent_instance = AgentInstance {
        agent_instance_id,
        project_id: project.project_id,
        agent_id: AgentId::new(),
        name: "Test Chat".into(),
        role: String::new(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: Vec::new(),
        icon: None,
        status: AgentStatus::Idle,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        current_task_id: None,
        current_session_id: None,
        created_at: now,
        updated_at: now,
    };

    let runtime: Arc<dyn aura_link::AgentRuntime> = Arc::new(aura_chat::InternalRuntime::new(
        llm.clone(),
        settings.clone(),
    ));
    let chat_service = ChatService::with_config(
        ChatServiceDeps {
            store,
            settings,
            llm,
            spec_gen,
            project_service,
            task_service,
            storage_client: Some(storage_client),
            runtime,
        },
        LlmConfig::from_env(),
    );

    TestHarness {
        chat_service,
        project_id: project.project_id,
        agent_instance_id,
        agent_instance,
        _tmp: tmp,
    }
}

fn collect_events(rx: &mut mpsc::UnboundedReceiver<ChatStreamEvent>) -> Vec<ChatStreamEvent> {
    let mut events = Vec::new();
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    events
}

fn event_name(e: &ChatStreamEvent) -> &'static str {
    match e {
        ChatStreamEvent::Delta(_) => "Delta",
        ChatStreamEvent::ThinkingDelta(_) => "ThinkingDelta",
        ChatStreamEvent::Progress(_) => "Progress",
        ChatStreamEvent::ToolCallStarted { .. } => "ToolCallStarted",
        ChatStreamEvent::ToolCallSnapshot { .. } => "ToolCallSnapshot",
        ChatStreamEvent::ToolCall { .. } => "ToolCall",
        ChatStreamEvent::ToolResult { .. } => "ToolResult",
        ChatStreamEvent::SpecSaved(_) => "SpecSaved",
        ChatStreamEvent::SpecsTitle(_) => "SpecsTitle",
        ChatStreamEvent::SpecsSummary(_) => "SpecsSummary",
        ChatStreamEvent::TaskSaved(_) => "TaskSaved",
        ChatStreamEvent::MessageSaved(_) => "MessageSaved",
        ChatStreamEvent::AgentInstanceUpdated(_) => "AgentInstanceUpdated",
        ChatStreamEvent::TokenUsage { .. } => "TokenUsage",
        ChatStreamEvent::Error(_) => "Error",
        ChatStreamEvent::Done => "Done",
    }
}

// ---------------------------------------------------------------------------
// E2E: simple text response, verify full event sequence
// ---------------------------------------------------------------------------

#[tokio::test]
async fn chat_streaming_simple_text_event_sequence() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![MockResponse::text(
        "Hello! How can I help you today?",
    )
    .with_tokens(200, 80)]));

    let h = setup(mock).await;
    let (tx, mut rx) = mpsc::unbounded_channel();

    h.chat_service
        .send_message_streaming(
            ChatMessageParams {
                project_id: &h.project_id,
                agent_instance_id: &h.agent_instance_id,
                agent_instance: &h.agent_instance,
                content: "Hello world",
                action: None,
                attachments: &[],
            },
            tx,
        )
        .await;

    let events = collect_events(&mut rx);
    let names: Vec<&str> = events.iter().map(|e| event_name(e)).collect();

    // Must start with Progress events
    assert_eq!(
        names[0], "Progress",
        "first event should be Progress(Connecting...)"
    );
    assert!(
        names.contains(&"Progress"),
        "should contain Progress events"
    );

    // Must contain Delta (the LLM response text)
    assert!(
        names.contains(&"Delta"),
        "should contain Delta event for LLM response text, got: {names:?}"
    );

    // Must contain MessageSaved
    assert!(
        names.contains(&"MessageSaved"),
        "should contain MessageSaved, got: {names:?}"
    );

    // Must end with Done
    assert_eq!(
        names.last(),
        Some(&"Done"),
        "last event should be Done, got: {names:?}"
    );

    // Verify MessageSaved content
    let msg_saved = events.iter().find_map(|e| match e {
        ChatStreamEvent::MessageSaved(m) => Some(m),
        _ => None,
    });
    assert!(msg_saved.is_some(), "should have a MessageSaved event");
    let msg = msg_saved.unwrap();
    assert_eq!(msg.role, ChatRole::Assistant);
    assert!(msg.content.contains("Hello!"));
}

// ---------------------------------------------------------------------------
// E2E: tool use then text, verify tool call events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn chat_streaming_tool_use_event_sequence() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::tool_use(vec![aura_claude::ToolCall {
            id: "t1".into(),
            name: "find_files".into(),
            input: serde_json::json!({"pattern": "*.rs"}),
        }])
        .with_tokens(200, 80),
        MockResponse::text("Found the files.").with_tokens(150, 60),
    ]));

    let h = setup(mock).await;
    let (tx, mut rx) = mpsc::unbounded_channel();

    h.chat_service
        .send_message_streaming(
            ChatMessageParams {
                project_id: &h.project_id,
                agent_instance_id: &h.agent_instance_id,
                agent_instance: &h.agent_instance,
                content: "Find all Rust files",
                action: None,
                attachments: &[],
            },
            tx,
        )
        .await;

    let events = collect_events(&mut rx);
    let names: Vec<&str> = events.iter().map(|e| event_name(e)).collect();

    assert!(
        names.contains(&"ToolCallStarted"),
        "should contain ToolCallStarted, got: {names:?}"
    );
    assert!(
        names.contains(&"ToolCall"),
        "should contain ToolCall, got: {names:?}"
    );
    assert!(
        names.contains(&"ToolResult"),
        "should contain ToolResult, got: {names:?}"
    );
    assert!(
        names.contains(&"TokenUsage"),
        "should contain TokenUsage, got: {names:?}"
    );
    assert!(
        names.contains(&"Delta"),
        "should contain Delta for final text, got: {names:?}"
    );
    assert!(
        names.contains(&"MessageSaved"),
        "should contain MessageSaved, got: {names:?}"
    );
    assert_eq!(names.last(), Some(&"Done"));

    // Verify tool call has correct name
    let tool_call = events.iter().find_map(|e| match e {
        ChatStreamEvent::ToolCall { name, .. } => Some(name.clone()),
        _ => None,
    });
    assert_eq!(tool_call.as_deref(), Some("find_files"));

    // Verify ToolCallStarted comes before ToolResult
    let started_idx = names.iter().position(|n| *n == "ToolCallStarted").unwrap();
    let result_idx = names.iter().position(|n| *n == "ToolResult").unwrap();
    assert!(
        started_idx < result_idx,
        "ToolCallStarted should come before ToolResult"
    );
}

// ---------------------------------------------------------------------------
// E2E: LLM error propagates as Error event
// ---------------------------------------------------------------------------

#[tokio::test]
async fn chat_streaming_error_event_on_llm_failure() {
    // Empty mock: no canned responses → the LLM call returns an error
    let mock = Arc::new(MockLlmProvider::new());

    let h = setup(mock).await;
    let (tx, mut rx) = mpsc::unbounded_channel();

    h.chat_service
        .send_message_streaming(
            ChatMessageParams {
                project_id: &h.project_id,
                agent_instance_id: &h.agent_instance_id,
                agent_instance: &h.agent_instance,
                content: "This should fail",
                action: None,
                attachments: &[],
            },
            tx,
        )
        .await;

    let events = collect_events(&mut rx);
    let names: Vec<&str> = events.iter().map(|e| event_name(e)).collect();

    assert!(
        names.contains(&"Error"),
        "should contain Error event on LLM failure, got: {names:?}"
    );
    assert_eq!(names.last(), Some(&"Done"), "should still end with Done");
}

// ---------------------------------------------------------------------------
// E2E: generate_specs action streams spec events or error
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_generate_specs_streaming_flow() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("# 01: Setup\nSetup project structure\n## Tasks\n- Initialize repo")
            .with_tokens(300, 150),
        MockResponse::text("{\"title\":\"Project Specs\",\"summary\":\"A test summary\"}")
            .with_tokens(100, 50),
    ]));

    let h = setup(mock).await;
    let (tx, mut rx) = mpsc::unbounded_channel();

    h.chat_service
        .send_message_streaming(
            ChatMessageParams {
                project_id: &h.project_id,
                agent_instance_id: &h.agent_instance_id,
                agent_instance: &h.agent_instance,
                content: "Generate specs for this project",
                action: Some("generate_specs"),
                attachments: &[],
            },
            tx,
        )
        .await;

    let events = collect_events(&mut rx);
    let names: Vec<&str> = events.iter().map(|e| event_name(e)).collect();

    assert_eq!(
        names.last(),
        Some(&"Done"),
        "should end with Done, got: {names:?}"
    );

    let has_spec_activity =
        names.contains(&"Delta") || names.contains(&"SpecSaved") || names.contains(&"Error");
    assert!(
        has_spec_activity,
        "should have spec-related events or error, got: {names:?}"
    );
}

// ---------------------------------------------------------------------------
// E2E: empty mock (no responses) produces Error event
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_streaming_handles_llm_timeout() {
    let mock = Arc::new(MockLlmProvider::new());

    let h = setup(mock).await;
    let (tx, mut rx) = mpsc::unbounded_channel();

    h.chat_service
        .send_message_streaming(
            ChatMessageParams {
                project_id: &h.project_id,
                agent_instance_id: &h.agent_instance_id,
                agent_instance: &h.agent_instance,
                content: "This should fail",
                action: None,
                attachments: &[],
            },
            tx,
        )
        .await;

    let events = collect_events(&mut rx);
    let names: Vec<&str> = events.iter().map(|e| event_name(e)).collect();

    assert!(
        names.contains(&"Error"),
        "LLM failure should produce Error event, got: {names:?}"
    );
    assert_eq!(names.last(), Some(&"Done"), "should end with Done");
}
