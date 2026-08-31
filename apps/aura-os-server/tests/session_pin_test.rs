//! End-to-end coverage for durable conversation pinning.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_storage::{CreateProjectAgentRequest, CreateSessionRequest};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn pin_and_unpin_session_persist_stable_state() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let project_agent = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Pin Agent".into(),
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
                summary_of_previous_context: Some("Important thread".into()),
            },
        )
        .await
        .expect("create session");
    let pin_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}/pin",
        project_agent.id, session.id
    );

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &pin_uri,
            Some(serde_json::json!({ "pinned": true })),
        ))
        .await
        .expect("pin request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let first_pin = storage
        .get_session(&session.id, TEST_JWT)
        .await
        .expect("read pinned session")
        .pinned_at
        .expect("pin timestamp");

    let detail_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}",
        project_agent.id, session.id
    );
    let response = app
        .clone()
        .oneshot(json_request("GET", &detail_uri, None))
        .await
        .expect("get pinned session");
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response_json(response).await["pinned_at"].is_string());

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &pin_uri,
            Some(serde_json::json!({ "pinned": true })),
        ))
        .await
        .expect("repeat pin request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        storage
            .get_session(&session.id, TEST_JWT)
            .await
            .expect("read repeatedly pinned session")
            .pinned_at
            .as_deref(),
        Some(first_pin.as_str())
    );

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &pin_uri,
            Some(serde_json::json!({ "pinned": false })),
        ))
        .await
        .expect("unpin request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(storage
        .get_session(&session.id, TEST_JWT)
        .await
        .expect("read unpinned session")
        .pinned_at
        .is_none());

    let wrong_project_uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/pin",
        uuid::Uuid::new_v4(),
        project_agent.id,
        session.id
    );
    let response = app
        .oneshot(json_request(
            "PUT",
            &wrong_project_uri,
            Some(serde_json::json!({ "pinned": true })),
        ))
        .await
        .expect("wrong project request");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
