//! Integration test for DELETE /api/projects/:p/agents/:a/sessions/:s.
//!
//! Uses the in-memory mock storage server so we exercise the full proxy:
//! aura-os-server handler → StorageClient::delete_session → mock storage
//! DELETE /api/sessions/:id.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_storage::{CreateProjectAgentRequest, CreateSessionRequest};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn delete_session_removes_session_from_storage() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

    // Seed: project agent + session in the mock storage.
    let project_id = uuid::Uuid::new_v4().to_string();
    let agent_id = uuid::Uuid::new_v4().to_string();

    let pa = storage
        .create_project_agent(
            &project_id,
            TEST_JWT,
            &CreateProjectAgentRequest {
                agent_id,
                name: "Test Agent".into(),
                org_id: None,
                role: Some("developer".into()),
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
        .expect("create project agent");

    let session = storage
        .create_session(
            &pa.id,
            TEST_JWT,
            &CreateSessionRequest {
                project_id: project_id.clone(),
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
    assert_eq!(
        storage.list_sessions(&pa.id, TEST_JWT).await.unwrap().len(),
        1,
    );

    // Act: DELETE via the server route.
    let uri = format!(
        "/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}",
        pa_id = pa.id,
        session_id = session.id,
    );
    let req = json_request("DELETE", &uri, None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert: session is gone from storage.
    let sessions = storage.list_sessions(&pa.id, TEST_JWT).await.unwrap();
    assert!(sessions.is_empty(), "session should be removed");

    // A follow-up GET should now 404 at the proxy.
    let get_uri = format!(
        "/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}",
        pa_id = pa.id,
        session_id = session.id,
    );
    let resp = app.clone().oneshot(json_request("GET", &get_uri, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_session_returns_404_for_unknown_id() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;

    let project_id = uuid::Uuid::new_v4().to_string();
    let pa_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();

    let uri =
        format!("/api/projects/{project_id}/agents/{pa_id}/sessions/{session_id}");
    let resp = app.clone().oneshot(json_request("DELETE", &uri, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
