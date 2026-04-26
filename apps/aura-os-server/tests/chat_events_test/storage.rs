//! Storage client: create and list session events.

use aura_os_storage::{CreateSessionEventRequest, CreateSessionRequest, StorageClient};

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

/// 7b. persist_user_message happy-path: writing succeeds and the returned
///     event has the expected wire shape (session_id / event_type).
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
