mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;
use aura_os_projects::CreateProjectInput;
use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, StorageClient,
    StorageSessionEvent,
};

use common::*;

// ---------------------------------------------------------------------------
// 1. Storage client: create and list events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn storage_create_and_list_events() {
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = StorageClient::with_base_url(&storage_url);
    let jwt = "test-token";

    let session = storage
        .create_session(
            "agent-1",
            jwt,
            &CreateSessionRequest {
                project_id: "proj-1".into(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    let user_evt = storage
        .create_event(
            &session.id,
            jwt,
            &CreateSessionEventRequest {
                event_type: "user_message".into(),
                sender: Some("user".into()),
                project_id: Some("proj-1".into()),
                agent_id: Some("agent-1".into()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({"text": "Hello, create a spec"})),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("create user event");

    assert_eq!(
        user_evt.event_type.as_deref(),
        Some("user_message"),
        "event_type should be user_message"
    );

    let assistant_evt = storage
        .create_event(
            &session.id,
            jwt,
            &CreateSessionEventRequest {
                event_type: "assistant_message_end".into(),
                sender: Some("agent".into()),
                project_id: Some("proj-1".into()),
                agent_id: Some("agent-1".into()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({
                    "text": "I'll create a Hello World spec for you.",
                    "thinking": "Let me plan this...",
                    "content_blocks": [
                        {"type": "text", "text": "I'll create a Hello World spec for you."},
                        {"type": "tool_use", "id": "tc-1", "name": "create_spec",
                         "input": {"title": "Hello World", "markdown_contents": "# Hello World"}}
                    ]
                })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("create assistant event");

    assert_eq!(
        assistant_evt.event_type.as_deref(),
        Some("assistant_message_end")
    );

    let events = storage
        .list_events(&session.id, jwt, None, None)
        .await
        .expect("list events");

    assert_eq!(events.len(), 2, "should have 2 events");
    assert_eq!(events[0].event_type.as_deref(), Some("user_message"));
    assert_eq!(
        events[1].event_type.as_deref(),
        Some("assistant_message_end")
    );
}

// ---------------------------------------------------------------------------
// 2. events_to_session_history reconstruction
// ---------------------------------------------------------------------------

#[tokio::test]
async fn events_to_session_history_reconstructs_correctly() {
    let now = chrono::Utc::now().to_rfc3339();
    let events = vec![
        StorageSessionEvent {
            id: "evt-1".into(),
            session_id: Some("s1".into()),
            user_id: None,
            agent_id: Some("agent-1".into()),
            sender: Some("user".into()),
            project_id: Some("proj-1".into()),
            org_id: None,
            event_type: Some("user_message".into()),
            content: Some(serde_json::json!({"text": "Create a spec please"})),
            created_at: Some(now.clone()),
        },
        StorageSessionEvent {
            id: "evt-skip".into(),
            session_id: Some("s1".into()),
            user_id: None,
            agent_id: Some("agent-1".into()),
            sender: Some("agent".into()),
            project_id: Some("proj-1".into()),
            org_id: None,
            event_type: Some("text_delta".into()),
            content: Some(serde_json::json!({"text": "I'll"})),
            created_at: Some(now.clone()),
        },
        StorageSessionEvent {
            id: "evt-2".into(),
            session_id: Some("s1".into()),
            user_id: None,
            agent_id: Some("agent-1".into()),
            sender: Some("agent".into()),
            project_id: Some("proj-1".into()),
            org_id: None,
            event_type: Some("assistant_message_end".into()),
            content: Some(serde_json::json!({
                "text": "I'll create the spec now.",
                "thinking": "Planning the spec structure..."
            })),
            created_at: Some(now.clone()),
        },
        StorageSessionEvent {
            id: "evt-3".into(),
            session_id: Some("s1".into()),
            user_id: None,
            agent_id: Some("agent-1".into()),
            sender: Some("agent".into()),
            project_id: Some("proj-1".into()),
            org_id: None,
            event_type: Some("task_output".into()),
            content: Some(serde_json::json!({"text": "Task completed successfully."})),
            created_at: Some(now.clone()),
        },
    ];

    let reconstructed = aura_os_server::handlers_test_support::events_to_session_history_pub(
        &events, "agent-1", "proj-1",
    );

    assert_eq!(reconstructed.len(), 3, "text_delta should be skipped");
    assert_eq!(reconstructed[0].role, ChatRole::User);
    assert_eq!(reconstructed[0].content, "Create a spec please");
    assert_eq!(reconstructed[1].role, ChatRole::Assistant);
    assert_eq!(reconstructed[1].content, "I'll create the spec now.");
    assert_eq!(
        reconstructed[1].thinking.as_deref(),
        Some("Planning the spec structure...")
    );
    assert_eq!(reconstructed[2].role, ChatRole::Assistant);
    assert_eq!(reconstructed[2].content, "Task completed successfully.");
}

// ---------------------------------------------------------------------------
// 3. session_events_to_conversation_history
// ---------------------------------------------------------------------------

#[tokio::test]
async fn session_events_to_conversation_history_correct_roles() {
    let now = chrono::Utc::now();
    let events = vec![
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role: ChatRole::User,
            content: "Hello".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
        },
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role: ChatRole::Assistant,
            content: "Hi there!".into(),
            content_blocks: None,
            thinking: Some("thinking...".into()),
            thinking_duration_ms: None,
            created_at: now,
        },
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role: ChatRole::System,
            content: "system message".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
        },
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role: ChatRole::Assistant,
            content: String::new(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
        },
    ];

    let history =
        aura_os_server::handlers_test_support::session_events_to_conversation_history_pub(&events);

    assert_eq!(
        history.len(),
        2,
        "system role and empty content should be filtered"
    );
    assert_eq!(history[0].role, "user");
    assert_eq!(history[0].content, "Hello");
    assert_eq!(history[1].role, "assistant");
    assert_eq!(history[1].content, "Hi there!");
}

// ---------------------------------------------------------------------------
// 4. Renamed API routes return SessionEvent shape
// ---------------------------------------------------------------------------

#[tokio::test]
async fn events_endpoint_returns_session_event_shape() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = storage
        .create_session(
            &aid.to_string(),
            jwt,
            &CreateSessionRequest {
                project_id: pid.to_string(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    storage
        .create_event(
            &session.id,
            jwt,
            &CreateSessionEventRequest {
                event_type: "user_message".into(),
                sender: Some("user".into()),
                project_id: Some(pid.to_string()),
                agent_id: Some(aid.to_string()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({"text": "Hello"})),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .unwrap();

    let url = format!(
        "/api/projects/{}/agents/{}/sessions/{}/events",
        pid, aid, session.id
    );
    let req = json_request("GET", &url, None);
    let resp = app.clone().oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let arr = body.as_array().expect("response should be an array");
    assert!(!arr.is_empty(), "should have at least one event");

    let first = &arr[0];
    assert!(
        first.get("event_id").is_some(),
        "should have event_id field (not message_id): {first}"
    );
    assert!(first.get("role").is_some(), "should have role field");
    assert!(first.get("content").is_some(), "should have content field");
}

#[tokio::test]
async fn standalone_agent_events_support_recent_window() {
    let (app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Agent History".into(),
            description: "Project for agent history tests".into(),
            build_command: None,
            test_command: None,
        })
        .expect("create local project");

    let agent_id = AgentId::new();
    let project_agent = storage
        .create_project_agent(
            &project.project_id.to_string(),
            jwt,
            &CreateProjectAgentRequest {
                agent_id: agent_id.to_string(),
                name: "Logos".into(),
                org_id: None,
                role: Some("Researcher".into()),
                personality: Some("Detailed".into()),
                system_prompt: Some("Investigate everything".into()),
                skills: Some(vec![]),
                icon: None,
                harness: None,
            },
        )
        .await
        .expect("create project agent");

    let session = storage
        .create_session(
            &project_agent.id,
            jwt,
            &CreateSessionRequest {
                project_id: project.project_id.to_string(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    for idx in 0..5 {
        storage
            .create_event(
                &session.id,
                jwt,
                &CreateSessionEventRequest {
                    event_type: "assistant_message_end".into(),
                    sender: Some("agent".into()),
                    project_id: Some(project.project_id.to_string()),
                    agent_id: Some(project_agent.id.clone()),
                    org_id: None,
                    user_id: None,
                    content: Some(serde_json::json!({
                        "text": format!("Event {idx}"),
                    })),
                    session_id: Some(session.id.clone()),
                },
            )
            .await
            .expect("create history event");
    }

    let req = json_request(
        "GET",
        &format!("/api/agents/{agent_id}/events?limit=2&offset=1"),
        None,
    );
    let resp = app
        .clone()
        .oneshot(req)
        .await
        .expect("request should succeed");

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let arr = body.as_array().expect("response should be an array");
    assert_eq!(arr.len(), 2, "recent window should contain 2 events");
    assert_eq!(arr[0]["content"], "Event 2");
    assert_eq!(arr[1]["content"], "Event 3");
}

// ---------------------------------------------------------------------------
// 5. System prompt includes project context
// ---------------------------------------------------------------------------

#[tokio::test]
async fn system_prompt_includes_project_context() {
    let prompt = aura_os_server::handlers_test_support::build_project_system_prompt_for_test(
        "test-project-id",
        "My Project",
        "A test project for integration testing",
        "You are a helpful assistant.",
    );

    assert!(
        prompt.contains("<project_context>"),
        "should contain project_context tag"
    );
    assert!(
        prompt.contains("test-project-id"),
        "should contain project_id"
    );
    assert!(prompt.contains("My Project"), "should contain project name");
    assert!(
        prompt.contains("A test project for integration testing"),
        "should contain description"
    );
    assert!(
        prompt.contains("You are a helpful assistant."),
        "should contain agent prompt"
    );
    assert!(
        prompt.contains("project_id"),
        "should instruct model about project_id"
    );
}
