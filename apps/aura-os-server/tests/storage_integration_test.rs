//! Comprehensive integration tests for the aura-os-storage client.
//!
//! Each test mirrors a canonical production usage pattern from aura-app:
//! how the server, session service, task service, and persistence layer
//! interact with aura-storage through the `StorageClient`.
//!
//! Tests use the in-memory mock storage server (same routes as the real
//! aura-storage service), accessed via `StorageClient::with_base_url`.

use aura_os_storage::testutil::start_mock_storage;
use aura_os_storage::types::UpdateSpecRequest;
use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, CreateSpecRequest,
    CreateTaskRequest, StorageClient, StorageTaskFileChangeSummary, TransitionTaskRequest,
    UpdateProjectAgentRequest, UpdateSessionRequest, UpdateTaskRequest,
};

const JWT: &str = "test-token";

async fn client() -> StorageClient {
    let (url, _db) = start_mock_storage().await;
    StorageClient::with_base_url(&url)
}

// =========================================================================
// Health
// =========================================================================

#[tokio::test]
async fn health_check_succeeds() {
    let sc = client().await;
    sc.health_check().await.expect("health check should pass");
}

// =========================================================================
// Project Agents — full CRUD lifecycle
// =========================================================================

#[tokio::test]
async fn project_agent_create_list_get_update_delete() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let pa = sc
        .create_project_agent(
            &pid,
            JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Aura Chat Agent".into(),
                org_id: None,
                role: Some("developer".into()),
                personality: Some("helpful".into()),
                system_prompt: Some("You are a helpful assistant.".into()),
                skills: Some(vec!["code".into(), "plan".into()]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    assert!(!pa.id.is_empty());
    assert_eq!(pa.name.as_deref(), Some("Aura Chat Agent"));
    assert_eq!(pa.project_id.as_deref(), Some(pid.as_str()));

    let agents = sc
        .list_project_agents(&pid, JWT)
        .await
        .expect("list project agents");
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].id, pa.id);

    let fetched = sc
        .get_project_agent(&pa.id, JWT)
        .await
        .expect("get project agent");
    assert_eq!(fetched.id, pa.id);

    sc.update_project_agent_status(
        &pa.id,
        JWT,
        &UpdateProjectAgentRequest {
            status: "working".into(),
        },
    )
    .await
    .expect("update status");
}

// =========================================================================
// Sessions — lifecycle matching resolve_chat_session
// =========================================================================

#[tokio::test]
async fn session_create_list_get_update() {
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
        .expect("create session");

    assert!(!session.id.is_empty());
    assert_eq!(session.status.as_deref(), Some("active"));

    let sessions = sc.list_sessions(&pai, JWT).await.expect("list sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, session.id);

    let fetched = sc.get_session(&session.id, JWT).await.expect("get session");
    assert_eq!(fetched.id, session.id);

    sc.update_session(
        &session.id,
        JWT,
        &UpdateSessionRequest {
            status: Some("rolled_over".into()),
            total_input_tokens: Some(0),
            total_output_tokens: Some(0),
            context_usage_estimate: Some(0.85),
            summary_of_previous_context: None,
            ended_at: Some(chrono::Utc::now().to_rfc3339()),
            tasks_worked_count: Some(3),
        },
    )
    .await
    .expect("update session");

    let updated = sc.get_session(&session.id, JWT).await.unwrap();
    assert_eq!(updated.status.as_deref(), Some("rolled_over"));
    assert_eq!(updated.tasks_worked_count, Some(3));
}

#[tokio::test]
async fn resolve_chat_session_pattern() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let pid = uuid::Uuid::new_v4().to_string();

    let sessions = sc.list_sessions(&pai, JWT).await.unwrap();
    assert!(sessions.is_empty(), "fresh agent has no sessions");

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

    let probe = sc.list_events(&session.id, JWT, Some(1), None).await;
    assert!(probe.is_ok(), "probe should succeed even with no events");
    assert!(probe.unwrap().is_empty());
}

// =========================================================================
// Events — full chat persistence cycle
// =========================================================================

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

// =========================================================================
// Specs — full CRUD
// =========================================================================

#[tokio::test]
async fn spec_crud_lifecycle() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let spec1 = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "01: User Authentication".into(),
                org_id: None,
                order_index: Some(1),
                markdown_contents: Some("# User Auth\n\nLogin/register flow.".into()),
            },
        )
        .await
        .unwrap();

    let _spec2 = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "02: Dashboard".into(),
                org_id: None,
                order_index: Some(2),
                markdown_contents: Some("# Dashboard".into()),
            },
        )
        .await
        .unwrap();

    let specs = sc.list_specs(&pid, JWT).await.unwrap();
    assert_eq!(specs.len(), 2);

    let fetched = sc.get_spec(&spec1.id, JWT).await.unwrap();
    assert_eq!(fetched.title.as_deref(), Some("01: User Authentication"));
    assert_eq!(
        fetched.markdown_contents.as_deref(),
        Some("# User Auth\n\nLogin/register flow.")
    );

    sc.update_spec(
        &spec1.id,
        JWT,
        &UpdateSpecRequest {
            title: Some("01: Auth Updated".into()),
            order_index: Some(3),
            markdown_contents: Some("# Updated Auth".into()),
        },
    )
    .await
    .unwrap();

    let updated = sc.get_spec(&spec1.id, JWT).await.unwrap();
    assert_eq!(updated.title.as_deref(), Some("01: Auth Updated"));
    assert_eq!(updated.order_index, Some(3));
    assert_eq!(updated.markdown_contents.as_deref(), Some("# Updated Auth"));

    sc.delete_spec(&spec1.id, JWT).await.unwrap();
    let specs = sc.list_specs(&pid, JWT).await.unwrap();
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].title.as_deref(), Some("02: Dashboard"));
}

// =========================================================================
// Tasks — full lifecycle
// =========================================================================

#[tokio::test]
async fn task_crud_and_transition_lifecycle() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let spec = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "Spec for tasks".into(),
                org_id: None,
                order_index: Some(1),
                markdown_contents: None,
            },
        )
        .await
        .unwrap();

    let task = sc
        .create_task(
            &pid,
            JWT,
            &CreateTaskRequest {
                spec_id: spec.id.clone(),
                title: "Implement login form".into(),
                org_id: None,
                description: Some("Build the login component.".into()),
                status: Some("pending".into()),
                order_index: Some(1),
                dependency_ids: None,
                assigned_project_agent_id: None,
            },
        )
        .await
        .unwrap();

    let task2 = sc
        .create_task(
            &pid,
            JWT,
            &CreateTaskRequest {
                spec_id: spec.id.clone(),
                title: "Add validation".into(),
                org_id: None,
                description: Some("Form validation rules.".into()),
                status: Some("pending".into()),
                order_index: Some(2),
                dependency_ids: Some(vec![task.id.clone()]),
                assigned_project_agent_id: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(sc.list_tasks(&pid, JWT).await.unwrap().len(), 2);
    assert_eq!(
        sc.get_task(&task.id, JWT).await.unwrap().title.as_deref(),
        Some("Implement login form")
    );

    sc.update_task(
        &task.id,
        JWT,
        &UpdateTaskRequest {
            title: None,
            description: None,
            order_index: None,
            dependency_ids: None,
            execution_notes: Some("Done in 3 turns.".into()),
            files_changed: Some(vec![StorageTaskFileChangeSummary {
                op: "create".into(),
                path: "src/Login.tsx".into(),
                lines_added: 50,
                lines_removed: 0,
            }]),
            model: Some("claude-sonnet-4-20250514".into()),
            total_input_tokens: Some(15000),
            total_output_tokens: Some(8000),
            session_id: Some("session-1".into()),
            assigned_project_agent_id: Some("agent-1".into()),
        },
    )
    .await
    .unwrap();

    sc.transition_task(
        &task.id,
        JWT,
        &TransitionTaskRequest {
            status: "done".into(),
        },
    )
    .await
    .unwrap();

    let done_task = sc.get_task(&task.id, JWT).await.unwrap();
    assert_eq!(done_task.status.as_deref(), Some("done"));
    assert_eq!(
        done_task.execution_notes.as_deref(),
        Some("Done in 3 turns.")
    );

    sc.delete_task(&task.id, JWT).await.unwrap();
    sc.delete_task(&task2.id, JWT).await.unwrap();
    let remaining = sc.list_tasks(&pid, JWT).await.unwrap();
    assert!(remaining.is_empty(), "tasks should be deleted");
}

// =========================================================================
// End-to-end: project setup → chat → task execution
// =========================================================================

#[tokio::test]
async fn end_to_end_project_chat_and_task_flow() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    // 1. Create project agent
    let pa = sc
        .create_project_agent(
            &pid,
            JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Aura".into(),
                org_id: None,
                role: None,
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .unwrap();

    // 2. Create session
    let session = sc
        .create_session(
            &pa.id,
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

    // 3. Chat turn
    sc.create_event(
        &session.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "user_message".into(),
            sender: Some("user".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pa.id.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"text": "Create specs for a todo app"})),
            session_id: Some(session.id.clone()),
        },
    )
    .await
    .unwrap();

    sc.create_event(
        &session.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "assistant_message_end".into(),
            sender: Some("agent".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pa.id.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"text": "Created two specs.", "seq": 1})),
            session_id: Some(session.id.clone()),
        },
    )
    .await
    .unwrap();

    // 4. Create spec + task
    let spec = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "01: Core CRUD".into(),
                org_id: None,
                order_index: Some(1),
                markdown_contents: Some("# CRUD\n\nCreate, read, update, delete.".into()),
            },
        )
        .await
        .unwrap();

    let task = sc
        .create_task(
            &pid,
            JWT,
            &CreateTaskRequest {
                spec_id: spec.id.clone(),
                title: "Implement todo model".into(),
                org_id: None,
                description: Some("Create the Todo struct.".into()),
                status: Some("pending".into()),
                order_index: Some(1),
                dependency_ids: None,
                assigned_project_agent_id: None,
            },
        )
        .await
        .unwrap();

    // 5. Execute task
    sc.transition_task(
        &task.id,
        JWT,
        &TransitionTaskRequest {
            status: "in_progress".into(),
        },
    )
    .await
    .unwrap();

    sc.create_event(
        &session.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "task_output".into(),
            sender: Some("agent".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pa.id.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"task_id": task.id, "text": "Created Todo struct."})),
            session_id: Some(session.id.clone()),
        },
    )
    .await
    .unwrap();

    sc.transition_task(
        &task.id,
        JWT,
        &TransitionTaskRequest {
            status: "done".into(),
        },
    )
    .await
    .unwrap();

    // 6. Verify full state
    let events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert_eq!(events.len(), 3);

    let specs = sc.list_specs(&pid, JWT).await.unwrap();
    assert_eq!(specs.len(), 1);

    let final_task = sc.get_task(&task.id, JWT).await.unwrap();
    assert_eq!(final_task.status.as_deref(), Some("done"));
}

// =========================================================================
// Session rollover pattern
// =========================================================================

#[tokio::test]
async fn session_rollover_pattern() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let pid = uuid::Uuid::new_v4().to_string();

    let s1 = sc
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

    sc.create_event(
        &s1.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "user_message".into(),
            sender: Some("user".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pai.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"text": "session 1 message"})),
            session_id: Some(s1.id.clone()),
        },
    )
    .await
    .unwrap();

    sc.update_session(
        &s1.id,
        JWT,
        &UpdateSessionRequest {
            status: Some("rolled_over".into()),
            total_input_tokens: Some(0),
            total_output_tokens: Some(0),
            context_usage_estimate: Some(0.52),
            summary_of_previous_context: None,
            ended_at: Some(chrono::Utc::now().to_rfc3339()),
            tasks_worked_count: None,
        },
    )
    .await
    .unwrap();

    let s2 = sc
        .create_session(
            &pai,
            JWT,
            &CreateSessionRequest {
                project_id: pid.clone(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: Some("Previously discussed project setup.".into()),
            },
        )
        .await
        .unwrap();

    sc.create_event(
        &s2.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "user_message".into(),
            sender: Some("user".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pai.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"text": "session 2 message"})),
            session_id: Some(s2.id.clone()),
        },
    )
    .await
    .unwrap();

    let sessions = sc.list_sessions(&pai, JWT).await.unwrap();
    assert_eq!(sessions.len(), 2);

    let s1_events = sc.list_events(&s1.id, JWT, None, None).await.unwrap();
    let s2_events = sc.list_events(&s2.id, JWT, None, None).await.unwrap();
    assert_eq!(s1_events.len(), 1);
    assert_eq!(s2_events.len(), 1);

    let mut all = Vec::new();
    for s in &sessions {
        all.extend(sc.list_events(&s.id, JWT, None, None).await.unwrap());
    }
    assert_eq!(all.len(), 2);
}

// =========================================================================
// Error cases
// =========================================================================

#[tokio::test]
async fn get_nonexistent_entities_return_errors() {
    let sc = client().await;
    assert!(sc.get_session("nonexistent", JWT).await.is_err());
    assert!(sc.get_task("nonexistent", JWT).await.is_err());
    assert!(sc.get_spec("nonexistent", JWT).await.is_err());
    assert!(sc.get_project_agent("nonexistent", JWT).await.is_err());
}

#[tokio::test]
async fn empty_id_rejected_by_validation() {
    let sc = client().await;
    assert!(sc
        .create_spec(
            "",
            JWT,
            &CreateSpecRequest {
                title: "test".into(),
                org_id: None,
                order_index: None,
                markdown_contents: None,
            }
        )
        .await
        .is_err());
    assert!(sc.list_sessions("", JWT).await.is_err());
    assert!(sc.list_events("", JWT, None, None).await.is_err());
}

#[tokio::test]
async fn list_events_empty_session_returns_empty() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let session = sc
        .create_session(
            &pai,
            JWT,
            &CreateSessionRequest {
                project_id: "p1".into(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    let events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert!(events.is_empty());
}
