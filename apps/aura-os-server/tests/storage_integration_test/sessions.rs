//! Session lifecycle, resolve_chat_session pattern, and rollover.

use aura_os_storage::{CreateSessionEventRequest, CreateSessionRequest, UpdateSessionRequest};

use super::{client, JWT};

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
