//! End-to-end coverage for durable conversation snoozing.

mod common;

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use tower::ServiceExt;

use aura_os_storage::{CreateProjectAgentRequest, CreateSessionRequest};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn snooze_and_wake_session_persist_future_state() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let project_agent = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Snooze Agent".into(),
                org_id: None,
                role: Some("assistant".into()),
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                instance_role: None,
                source: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");
    let session = storage
        .create_session(
            &project_agent.id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.clone(),
                org_id: None,
                model: None,
                status: Some("completed".into()),
                context_usage_estimate: None,
                summary_of_previous_context: Some("Follow up later".into()),
            },
        )
        .await
        .expect("create session");
    let snooze_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}/snooze",
        project_agent.id, session.id
    );
    let wake_at = (Utc::now() + Duration::hours(2)).to_rfc3339();

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &snooze_uri,
            Some(serde_json::json!({ "snoozedUntil": wake_at })),
        ))
        .await
        .expect("snooze request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(storage
        .get_session(&session.id, TEST_JWT)
        .await
        .expect("read snoozed session")
        .snoozed_until
        .is_some());

    let detail_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}",
        project_agent.id, session.id
    );
    let response = app
        .clone()
        .oneshot(json_request("GET", &detail_uri, None))
        .await
        .expect("get snoozed session");
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response_json(response).await["snoozed_until"].is_string());

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &snooze_uri,
            Some(serde_json::json!({ "snoozedUntil": Utc::now() })),
        ))
        .await
        .expect("past snooze request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &snooze_uri,
            Some(serde_json::json!({ "wake": true })),
        ))
        .await
        .expect("wake request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(storage
        .get_session(&session.id, TEST_JWT)
        .await
        .expect("read awake session")
        .snoozed_until
        .is_none());

    let wrong_project_uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/snooze",
        uuid::Uuid::new_v4(),
        project_agent.id,
        session.id
    );
    let response = app
        .oneshot(json_request(
            "PUT",
            &wrong_project_uri,
            Some(serde_json::json!({ "wake": true })),
        ))
        .await
        .expect("wrong project request");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
