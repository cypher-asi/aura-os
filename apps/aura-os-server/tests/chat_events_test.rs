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
            local_workspace_path: None,
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
                permissions: None,
                intent_classifier: None,
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
// 5. Reset doesn't re-inject prior session events into LLM context
// ---------------------------------------------------------------------------
//
// Regression: before the fix, "Clear session" only rotated the storage write
// target and cleared in-memory caches. The LLM-context loaders aggregated
// every past storage session, so a corrupted `tool_use` block left behind by
// a crashed harness (e.g. agent 1f7dabd9... S1 at messages.4.content.1) kept
// getting re-injected on cold starts / cache misses / page refreshes.
//
// The fix scopes LLM-context loads to the *current* storage session only
// (the one `resolve_chat_session(force_new=false)` picks). UI history
// endpoints still aggregate across sessions — those tests live elsewhere in
// this file and remain unchanged.

async fn create_session_with_user_event(
    storage: &StorageClient,
    project_agent_id: &str,
    project_id: &str,
    jwt: &str,
    text: &str,
) -> String {
    let session = storage
        .create_session(
            project_agent_id,
            jwt,
            &CreateSessionRequest {
                project_id: project_id.to_string(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");
    storage
        .create_event(
            &session.id,
            jwt,
            &CreateSessionEventRequest {
                event_type: "user_message".into(),
                sender: Some("user".into()),
                project_id: Some(project_id.to_string()),
                agent_id: Some(project_agent_id.to_string()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({ "text": text })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("create user event");
    session.id
}

#[tokio::test]
async fn current_session_loader_excludes_prior_sessions_for_agent() {
    let (_app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let project = state
        .project_service
        .create_project(CreateProjectInput {
            org_id: OrgId::new(),
            name: "Reset Scope Test".into(),
            description: "Regression for LLM context re-injection".into(),
            build_command: None,
            test_command: None,
            local_workspace_path: None,
        })
        .expect("create project");

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
                personality: None,
                system_prompt: None,
                skills: Some(vec![]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    // S_old: simulates a "corrupted" prior session the user has reset away from.
    let _s_old = create_session_with_user_event(
        &storage,
        &project_agent.id,
        &project.project_id.to_string(),
        jwt,
        "old session message (should NOT appear in LLM context)",
    )
    .await;

    // Ensure S_new gets a strictly-later started_at timestamp.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // S_new: the fresh session created by reset.
    let _s_new = create_session_with_user_event(
        &storage,
        &project_agent.id,
        &project.project_id.to_string(),
        jwt,
        "new session message (should appear in LLM context)",
    )
    .await;

    let history = aura_os_server::handlers_test_support::load_current_session_events_for_agent_pub(
        &state, &agent_id, jwt,
    )
    .await;

    assert_eq!(
        history.len(),
        1,
        "LLM context must contain exactly the current session's events, not aggregated history"
    );
    assert_eq!(history[0].role, ChatRole::User);
    assert_eq!(
        history[0].content, "new session message (should appear in LLM context)",
        "current-session loader returned events from a prior session"
    );
}

#[tokio::test]
async fn current_session_loader_excludes_prior_sessions_for_instance() {
    let (_app, state, storage, _db) = build_test_app_with_storage().await;
    let jwt = "test-token";

    let project_id = ProjectId::new();
    let agent_instance_id = AgentInstanceId::new();

    let _s_old = create_session_with_user_event(
        &storage,
        &agent_instance_id.to_string(),
        &project_id.to_string(),
        jwt,
        "old instance session (should NOT appear)",
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let _s_new = create_session_with_user_event(
        &storage,
        &agent_instance_id.to_string(),
        &project_id.to_string(),
        jwt,
        "new instance session (should appear)",
    )
    .await;

    let history =
        aura_os_server::handlers_test_support::load_current_session_events_for_instance_pub(
            &state,
            &agent_instance_id,
            jwt,
        )
        .await
        .expect("loader succeeds");

    assert_eq!(
        history.len(),
        1,
        "LLM context for instance must contain only the current session's events"
    );
    assert_eq!(history[0].role, ChatRole::User);
    assert_eq!(
        history[0].content, "new instance session (should appear)",
        "current-session instance loader returned events from a prior session"
    );
}

// ---------------------------------------------------------------------------
// 6. Dangling tool_use blocks are stripped from LLM-context conversions
// ---------------------------------------------------------------------------

fn make_assistant_event_with_blocks(content_blocks: Vec<ChatContentBlock>) -> SessionEvent {
    SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::new(),
        project_id: ProjectId::new(),
        role: ChatRole::Assistant,
        content: String::new(),
        content_blocks: Some(content_blocks),
        thinking: None,
        thinking_duration_ms: None,
        created_at: chrono::Utc::now(),
    }
}

#[tokio::test]
async fn super_agent_history_strips_dangling_tool_use_block() {
    // Mirrors the real-world corruption: an assistant turn emitted a
    // tool_use block and the harness crashed before the matching
    // tool_result landed in storage. Feeding this back into context trips
    // the Anthropic API 400 "tool_use ids were found without tool_result
    // blocks immediately after". The filter must drop the dangling block.
    let dangling_id = "tc-dangling";
    let matched_id = "tc-matched";

    let events = vec![
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role: ChatRole::User,
            content: "please do something".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: chrono::Utc::now(),
        },
        make_assistant_event_with_blocks(vec![
            ChatContentBlock::Text {
                text: "calling a tool".into(),
            },
            ChatContentBlock::ToolUse {
                id: matched_id.into(),
                name: "do_thing".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolUse {
                id: dangling_id.into(),
                name: "crashed_thing".into(),
                input: serde_json::json!({}),
            },
        ]),
        make_assistant_event_with_blocks(vec![ChatContentBlock::ToolResult {
            tool_use_id: matched_id.into(),
            content: "ok".into(),
            is_error: None,
        }]),
    ];

    let history =
        aura_os_server::handlers_test_support::session_events_to_agent_history_pub(&events);

    let serialized = serde_json::to_string(&history).unwrap();
    assert!(
        !serialized.contains(dangling_id),
        "dangling tool_use id must not survive into super-agent history, got: {serialized}"
    );
    assert!(
        serialized.contains(matched_id),
        "matched tool_use must still be present, got: {serialized}"
    );
}

#[tokio::test]
async fn conversation_history_strips_dangling_tool_use_block() {
    let dangling_id = "tc-dangling";
    let matched_id = "tc-matched";

    let events = vec![
        make_assistant_event_with_blocks(vec![
            ChatContentBlock::ToolUse {
                id: matched_id.into(),
                name: "ok_tool".into(),
                input: serde_json::json!({"a": 1}),
            },
            ChatContentBlock::ToolUse {
                id: dangling_id.into(),
                name: "crashed_tool".into(),
                input: serde_json::json!({"b": 2}),
            },
        ]),
        make_assistant_event_with_blocks(vec![ChatContentBlock::ToolResult {
            tool_use_id: matched_id.into(),
            content: "done".into(),
            is_error: None,
        }]),
    ];

    let history =
        aura_os_server::handlers_test_support::session_events_to_conversation_history_pub(&events);

    let joined: String = history
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        !joined.contains("crashed_tool"),
        "dangling tool_use must not appear in rendered harness history, got:\n{joined}"
    );
    assert!(
        joined.contains("ok_tool"),
        "matched tool_use should still be rendered, got:\n{joined}"
    );
}

// ---------------------------------------------------------------------------
// 7. System prompt includes project context
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7a. chat_persist_unavailable: POST /api/agents/:id/events/stream with no
//     project-agent binding returns HTTP 424 with the structured error shape
//     that `send_to_agent` parses.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_chat_stream_returns_424_when_no_project_binding() {
    use std::sync::Arc;

    use axum::routing::get;
    use axum::Router;
    use tokio::net::TcpListener;

    // Fake aura-network that 404s every agent GET. The chat handler maps a
    // 404 to `AgentError::NotFound` and then falls back to the local agent
    // shadow, so saving the shadow below is enough to resolve the agent.
    let net_app = Router::new().route(
        "/api/agents/:agent_id",
        get(|| async {
            (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({ "error": "not found" })),
            )
        }),
    );
    let net_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let net_addr = net_listener.local_addr().unwrap();
    let net_url = format!("http://{net_addr}");
    tokio::spawn(async move { axum::serve(net_listener, net_app).await.ok() });

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = Arc::new(aura_os_storage::StorageClient::with_base_url(&storage_url));
    let network = Arc::new(aura_os_network::NetworkClient::with_base_url(&net_url));

    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(aura_os_store::SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let (app, state) = build_test_app_from_store(
        store,
        store_dir.path().to_path_buf(),
        Some(network),
        Some(storage),
        None,
        None,
    );

    let agent_id = AgentId::new();
    let agent = Agent {
        agent_id,
        user_id: "u1".into(),
        org_id: None,
        name: "Lonely".into(),
        role: "dev".into(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: vec![],
        icon: None,
        machine_type: "local".into(),
        adapter_type: "aura_harness".into(),
        environment: "local_host".into(),
        // `local` auth_source bypasses the `require_credits_for_auth_source`
        // billing guard so the test doesn't need a billing mock.
        auth_source: "local".into(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: vec![],
        is_pinned: false,
        listing_status: Default::default(),
        expertise: vec![],
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    state.agent_service.save_agent_shadow(&agent).unwrap();

    let req = json_request(
        "POST",
        &format!("/api/agents/{agent_id}/events/stream"),
        Some(serde_json::json!({ "content": "ping" })),
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(
        resp.status(),
        axum::http::StatusCode::FAILED_DEPENDENCY,
        "chat_persist_unavailable must return HTTP 424"
    );

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["code"], "chat_persist_unavailable");
    let data = body
        .get("data")
        .expect("structured error body must include `data`");
    assert_eq!(data["code"], "chat_persist_unavailable");
    assert!(
        data["reason"].is_string(),
        "reason must be populated so send_to_agent can surface it"
    );
    assert!(data["upstream_status"].is_null());
    assert!(data["session_id"].is_null());
    assert!(data["project_id"].is_null());
    assert!(data["project_agent_id"].is_null());
}

// ---------------------------------------------------------------------------
// 7b. persist_user_message happy-path: writing succeeds and the returned
//     event has the expected wire shape (session_id / event_type).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn storage_persists_user_message_and_returns_it() {
    // This mirrors what `persist_user_message` does internally: create a
    // session, then create a `user_message` event on that session. It
    // exists so if the storage contract for chat user-turns changes
    // (field names, required keys), this test catches it before the
    // `send_to_agent` tool starts reporting silent successes again.
    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let storage = StorageClient::with_base_url(&storage_url);
    let jwt = "test-token";

    let session = storage
        .create_session(
            "pa-777",
            jwt,
            &CreateSessionRequest {
                project_id: "proj-777".into(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");

    let evt = storage
        .create_event(
            &session.id,
            jwt,
            &CreateSessionEventRequest {
                event_type: "user_message".into(),
                sender: Some("user".into()),
                project_id: Some("proj-777".into()),
                agent_id: Some("pa-777".into()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({
                    "message_id": "m-1",
                    "text": "hello",
                    "attachments": []
                })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .expect("persist_user_message shape accepted by storage");

    assert_eq!(evt.event_type.as_deref(), Some("user_message"));
    assert_eq!(evt.session_id.as_deref(), Some(session.id.as_str()));
    assert_eq!(evt.sender.as_deref(), Some("user"));
}

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
