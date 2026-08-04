//! End-to-end contract coverage for the read-only cross-session Recall MVP.
//!
//! The mock storage service deliberately requires `AURA_STORAGE_TEST_USER_ID`
//! to simulate JWT-derived ownership. Production never sends that query
//! parameter; aura-storage derives ownership from the JWT itself.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::AgentId;
use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, StorageClient,
};

use common::*;

async fn seed_project_agent(storage: &StorageClient, project_id: &str) -> String {
    storage
        .create_project_agent(
            project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: AgentId::new().to_string(),
                name: "Recall Agent".into(),
                org_id: None,
                role: Some("Researcher".into()),
                instance_role: None,
                source: None,
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
        .expect("create project agent")
        .id
}

async fn seed_session(
    storage: &StorageClient,
    project_agent_id: &str,
    project_id: &str,
    status: &str,
    event_type: &str,
    content: serde_json::Value,
) -> String {
    let session = storage
        .create_session(
            project_agent_id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.into(),
                org_id: None,
                model: None,
                status: Some(status.into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .expect("create session");
    storage
        .create_event(
            &session.id,
            TEST_JWT,
            &CreateSessionEventRequest {
                session_id: Some(session.id.clone()),
                user_id: None,
                agent_id: Some(project_agent_id.into()),
                sender: Some("user".into()),
                project_id: Some(project_id.into()),
                org_id: None,
                event_type: event_type.into(),
                content: Some(content),
            },
        )
        .await
        .expect("create session event");
    session.id
}

async fn stamp_owner(db: &aura_os_storage::testutil::SharedDb, session_id: &str, user_id: &str) {
    db.lock()
        .await
        .session_users
        .insert(session_id.into(), user_id.into());
}

#[tokio::test]
async fn recall_returns_only_safe_completed_owned_conversation_text() {
    let (app, _state, storage, db, _dir) = build_test_app_with_storage_db().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let project_agent_id = seed_project_agent(&storage, &project_id).await;
    let owner = uuid::Uuid::new_v4().to_string();
    let other_user = uuid::Uuid::new_v4().to_string();

    let safe = seed_session(
        &storage,
        &project_agent_id,
        &project_id,
        "completed",
        "user_message",
        serde_json::json!({ "text": "Needle: authentication refresh uses the new rotation flow." }),
    )
    .await;
    let secret = seed_session(
        &storage,
        &project_agent_id,
        &project_id,
        "completed",
        "user_message",
        serde_json::json!({
            "text": (["needle sk_", "live_", "abcdefghijklmnopqrstuvwxyz"].concat())
        }),
    )
    .await;
    let attachment = seed_session(
        &storage,
        &project_agent_id,
        &project_id,
        "completed",
        "user_message",
        serde_json::json!({
            "text": "needle image caption",
            "content_blocks": [{ "type": "image", "media_type": "image/png", "data": "needle_base64_attachment" }]
        }),
    )
    .await;
    let tool = seed_session(
        &storage,
        &project_agent_id,
        &project_id,
        "completed",
        "task_output",
        serde_json::json!({ "text": "needle_tool_result_must_not_be_recalled" }),
    )
    .await;
    let active = seed_session(
        &storage,
        &project_agent_id,
        &project_id,
        "active",
        "user_message",
        serde_json::json!({ "text": "needle_active_chat_must_not_be_recalled" }),
    )
    .await;
    let another_users_session = seed_session(
        &storage,
        &project_agent_id,
        &project_id,
        "completed",
        "user_message",
        serde_json::json!({ "text": "needle_other_user_must_not_leak" }),
    )
    .await;

    for session_id in [&safe, &secret, &attachment, &tool, &active] {
        stamp_owner(&db, session_id, &owner).await;
    }
    stamp_owner(&db, &another_users_session, &other_user).await;

    std::env::set_var("AURA_STORAGE_TEST_USER_ID", &owner);
    let response = app
        .oneshot(json_request(
            "GET",
            "/api/me/sessions/search?q=needle",
            None,
        ))
        .await
        .expect("request");
    std::env::remove_var("AURA_STORAGE_TEST_USER_ID");

    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let results = body["results"].as_array().expect("results array");
    assert_eq!(
        results.len(),
        1,
        "only the safe completed source is eligible"
    );
    assert_eq!(results[0]["sessionId"].as_str(), Some(safe.as_str()));
    assert!(results[0]["eventId"].as_str().is_some());
    assert!(results[0]["agentId"].as_str().is_some());
    assert!(results[0]["occurredAt"].as_str().is_some());

    let rendered = body.to_string();
    for forbidden in [
        "sk_live_",
        "needle_base64_attachment",
        "needle_tool_result_must_not_be_recalled",
        "needle_active_chat_must_not_be_recalled",
        "needle_other_user_must_not_leak",
    ] {
        assert!(!rendered.contains(forbidden), "Recall leaked {forbidden}");
    }
}
