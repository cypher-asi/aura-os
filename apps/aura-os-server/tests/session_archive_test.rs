//! End-to-end coverage for the reversible session archive resource.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_storage::{CreateProjectAgentRequest, CreateSessionRequest, SESSION_STATUS_ARCHIVED};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn archive_and_restore_session_persist_across_reads() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;
    let project_id = uuid::Uuid::new_v4().to_string();
    let project_agent = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Archive Agent".into(),
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
                summary_of_previous_context: Some("Keep this transcript".into()),
            },
        )
        .await
        .expect("create session");
    let archive_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}/archive",
        project_agent.id, session.id
    );

    let wrong_project_uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/archive",
        uuid::Uuid::new_v4(),
        project_agent.id,
        session.id
    );
    let response = app
        .clone()
        .oneshot(json_request("POST", &wrong_project_uri, None))
        .await
        .expect("wrong-project archive request");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(json_request("POST", &archive_uri, None))
        .await
        .expect("archive request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        storage
            .get_session(&session.id, TEST_JWT)
            .await
            .expect("read archived session")
            .status
            .as_deref(),
        Some(SESSION_STATUS_ARCHIVED)
    );

    let detail_uri = format!(
        "/api/projects/{project_id}/agents/{}/sessions/{}",
        project_agent.id, session.id
    );
    let response = app
        .clone()
        .oneshot(json_request("GET", &detail_uri, None))
        .await
        .expect("get archived session");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await["status"], "archived");

    let response = app
        .clone()
        .oneshot(json_request("DELETE", &archive_uri, None))
        .await
        .expect("restore request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        storage
            .get_session(&session.id, TEST_JWT)
            .await
            .expect("read restored session")
            .status
            .as_deref(),
        Some("completed")
    );

    // A repeated restore is idempotent and does not rewrite another status.
    let response = app
        .oneshot(json_request("DELETE", &archive_uri, None))
        .await
        .expect("repeat restore request");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        storage
            .get_session(&session.id, TEST_JWT)
            .await
            .expect("read repeatedly restored session")
            .status
            .as_deref(),
        Some("completed")
    );
}

#[tokio::test]
async fn archive_session_returns_not_found_for_unknown_session() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let uri = format!(
        "/api/projects/{}/agents/{}/sessions/{}/archive",
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
    );
    let response = app
        .oneshot(json_request("POST", &uri, None))
        .await
        .expect("archive request");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
