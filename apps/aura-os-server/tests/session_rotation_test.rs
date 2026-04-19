//! Integration test for stale-active session retirement.
//!
//! When a chat reset creates a new session, any lingering `active` sessions
//! for the same agent instance must be flipped to `completed` so the
//! sidekick stops rendering historical sessions as spinning/in-progress.

mod common;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_storage::{CreateProjectAgentRequest, CreateSessionRequest};

use common::*;

const TEST_JWT: &str = "test-token";

#[tokio::test]
async fn reset_session_retires_prior_active_sessions() {
    let (app, _state, storage, _db) = build_test_app_with_storage().await;

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

    let s1 = storage
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
        .expect("create s1");
    let s2 = storage
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
        .expect("create s2");

    // Sanity: both are stored as active before we reset.
    let before = storage.list_sessions(&pa.id, TEST_JWT).await.unwrap();
    assert_eq!(before.len(), 2);
    for s in &before {
        assert_eq!(s.status.as_deref(), Some("active"));
    }

    let uri = format!("/api/projects/{project_id}/agents/{pa_id}/reset-session", pa_id = pa.id);
    let resp = app.clone().oneshot(json_request("POST", &uri, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let after = storage.list_sessions(&pa.id, TEST_JWT).await.unwrap();

    // One brand-new active session from the reset, plus the two prior
    // sessions now flipped to completed.
    assert_eq!(after.len(), 3, "reset should create exactly one new session");

    let active_ids: Vec<&str> = after
        .iter()
        .filter(|s| s.status.as_deref() == Some("active"))
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(active_ids.len(), 1, "only the new session should be active");
    assert!(
        !active_ids.contains(&s1.id.as_str()) && !active_ids.contains(&s2.id.as_str()),
        "the newly-active session should not be one of the prior sessions",
    );

    for s in after.iter().filter(|s| s.id == s1.id || s.id == s2.id) {
        assert_eq!(s.status.as_deref(), Some("completed"));
        assert!(s.ended_at.is_some(), "retired sessions must have ended_at");
    }
}
