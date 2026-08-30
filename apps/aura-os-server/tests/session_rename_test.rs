//! End-to-end coverage for user-authored session titles.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_storage::{CreateProjectAgentRequest, CreateSessionRequest};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn rename_session_trims_and_persists_the_title() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let project_agent = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Rename Agent".into(),
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
                summary_of_previous_context: Some("Generated title".into()),
            },
        )
        .await
        .expect("create session");
    let title_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}/title",
        project_agent.id, session.id
    );

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &title_uri,
            Some(serde_json::json!({ "title": "  User chosen title  " })),
        ))
        .await
        .expect("rename request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        storage
            .get_session(&session.id, TEST_JWT)
            .await
            .expect("read renamed session")
            .summary_of_previous_context
            .as_deref(),
        Some("User chosen title")
    );

    let detail_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}",
        project_agent.id, session.id
    );
    let response = app
        .clone()
        .oneshot(json_request("GET", &detail_uri, None))
        .await
        .expect("get renamed session");
    assert_eq!(
        response_json(response).await["summary_of_previous_context"],
        "User chosen title"
    );

    let response = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &title_uri,
            Some(serde_json::json!({ "title": "   " })),
        ))
        .await
        .expect("empty title request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let wrong_project_uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/title",
        uuid::Uuid::new_v4(),
        project_agent.id,
        session.id
    );
    let response = app
        .oneshot(json_request(
            "PUT",
            &wrong_project_uri,
            Some(serde_json::json!({ "title": "Wrong route" })),
        ))
        .await
        .expect("wrong project request");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rename_session_rejects_titles_over_the_limit() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/title",
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
    );
    let response = app
        .oneshot(json_request(
            "PUT",
            &uri,
            Some(serde_json::json!({ "title": "x".repeat(121) })),
        ))
        .await
        .expect("long title request");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
