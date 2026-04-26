//! Chat event and task event persistence cycles.

use aura_os_storage::{CreateSessionEventRequest, CreateSessionRequest};

use super::{client, JWT};

#[tokio::test]
async fn chat_event_persistence_full_cycle() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let pid = uuid::Uuid::new_v4().to_string();

    let session = sc
        .create_session(
            &pai,
            JWT,
            &CreateSessionRequest {
                project_id: pid.clone(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    let event_payloads = vec![
        (
            "user_message",
            "user",
            serde_json::json!({"text": "Create a hello world spec"}),
        ),
        (
            "assistant_message_start",
            "agent",
            serde_json::json!({"message_id": "m-1", "seq": 0}),
        ),
        (
            "thinking_delta",
            "agent",
            serde_json::json!({"message_id": "m-1", "thinking": "Planning...", "seq": 1}),
        ),
        (
            "text_delta",
            "agent",
            serde_json::json!({"message_id": "m-1", "text": "I'll create a spec.", "seq": 2}),
        ),
        (
            "tool_use_start",
            "agent",
            serde_json::json!({"message_id": "m-1", "id": "tc-1", "name": "create_spec", "seq": 3}),
        ),
        (
            "tool_result",
            "agent",
            serde_json::json!({"message_id": "m-1", "tool_use_id": "tc-1", "name": "create_spec", "result": "{\"ok\":true}", "is_error": false, "seq": 4}),
        ),
        (
            "assistant_message_end",
            "agent",
            serde_json::json!({
                "message_id": "m-1",
                "text": "I've created the spec.",
                "thinking": "Planning...",
                "content_blocks": [
                    {"type": "text", "text": "I've created the spec."},
                    {"type": "tool_use", "id": "tc-1", "name": "create_spec", "input": {"title": "Hello World"}}
                ],
                "usage": {"input_tokens": 500, "output_tokens": 200},
                "stop_reason": "end_turn",
                "seq": 5
            }),
        ),
    ];

    for (event_type, sender, content) in &event_payloads {
        sc.create_event(
            &session.id,
            JWT,
            &CreateSessionEventRequest {
                event_type: event_type.to_string(),
                sender: Some(sender.to_string()),
                project_id: Some(pid.clone()),
                agent_id: Some(pai.clone()),
                org_id: None,
                user_id: None,
                content: Some(content.clone()),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .unwrap_or_else(|e| panic!("persist {event_type} failed: {e}"));
    }

    let events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert_eq!(events.len(), 7);

    let types: Vec<&str> = events
        .iter()
        .filter_map(|e| e.event_type.as_deref())
        .collect();
    assert_eq!(
        types,
        vec![
            "user_message",
            "assistant_message_start",
            "thinking_delta",
            "text_delta",
            "tool_use_start",
            "tool_result",
            "assistant_message_end",
        ]
    );

    for evt in &events {
        assert_eq!(evt.session_id.as_deref(), Some(session.id.as_str()));
        assert!(evt.created_at.is_some());
    }

    let with_limit = sc.list_events(&session.id, JWT, Some(2), None).await;
    assert!(
        with_limit.is_ok(),
        "list_events with limit should not error"
    );
}

#[tokio::test]
async fn list_events_without_explicit_limit_fetches_full_history_across_pages() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let pid = uuid::Uuid::new_v4().to_string();

    let session = sc
        .create_session(
            &pai,
            JWT,
            &CreateSessionRequest {
                project_id: pid.clone(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    for seq in 0..125 {
        sc.create_event(
            &session.id,
            JWT,
            &CreateSessionEventRequest {
                event_type: "text_delta".into(),
                sender: Some("agent".into()),
                project_id: Some(pid.clone()),
                agent_id: Some(pai.clone()),
                org_id: None,
                user_id: None,
                content: Some(serde_json::json!({
                    "message_id": "m-1",
                    "text": format!("chunk-{seq}"),
                    "seq": seq,
                })),
                session_id: Some(session.id.clone()),
            },
        )
        .await
        .unwrap();
    }

    let all_events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert_eq!(all_events.len(), 125);

    let first_page = sc
        .list_events(&session.id, JWT, Some(100), None)
        .await
        .unwrap();
    assert_eq!(first_page.len(), 100);
}

#[tokio::test]
async fn task_event_persistence() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let pid = uuid::Uuid::new_v4().to_string();
    let task_id = uuid::Uuid::new_v4().to_string();

    let session = sc
        .create_session(
            &pai,
            JWT,
            &CreateSessionRequest {
                project_id: pid.clone(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    sc.create_event(&session.id, JWT, &CreateSessionEventRequest {
        event_type: "task_output".into(), sender: Some("agent".into()),
        project_id: Some(pid.clone()), agent_id: Some(pai.clone()),
        org_id: None, user_id: None,
        content: Some(serde_json::json!({"task_id": task_id, "text": "Implemented the feature.\nAll tests pass.", "input_tokens": 1200, "output_tokens": 800})),
        session_id: Some(session.id.clone()),
    }).await.unwrap();

    sc.create_event(&session.id, JWT, &CreateSessionEventRequest {
        event_type: "task_steps".into(), sender: Some("agent".into()),
        project_id: Some(pid.clone()), agent_id: Some(pai.clone()),
        org_id: None, user_id: None,
        content: Some(serde_json::json!({
            "task_id": task_id,
            "build_steps": [{"kind": "build", "command": "cargo build"}],
            "test_steps": [{"kind": "test", "command": "cargo test", "tests": [{"name": "test_1", "status": "passed"}]}],
        })),
        session_id: Some(session.id.clone()),
    }).await.unwrap();

    let events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].event_type.as_deref(), Some("task_output"));
    assert_eq!(events[1].event_type.as_deref(), Some("task_steps"));
}
