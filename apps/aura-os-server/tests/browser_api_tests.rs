use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use aura_os_core::ProjectId;

mod common;

use common::{build_test_app, json_request, response_json};

#[tokio::test]
async fn list_browsers_only_returns_sessions_owned_by_request_user() {
    let (app, state, _db) = build_test_app();

    let mine = state
        .browser_manager
        .spawn_for_owner("u1", aura_os_browser::SpawnOptions::new(1280, 800))
        .await
        .unwrap();
    state
        .browser_manager
        .spawn_for_owner("u2", aura_os_browser::SpawnOptions::new(1280, 800))
        .await
        .unwrap();

    let resp = app
        .clone()
        .oneshot(json_request("GET", "/api/browser", None))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    let sessions = body.as_array().expect("sessions array");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], mine.id.to_string());
}

#[tokio::test]
async fn delete_browser_rejects_sessions_owned_by_another_user() {
    let (app, state, _db) = build_test_app();

    let foreign = state
        .browser_manager
        .spawn_for_owner("u2", aura_os_browser::SpawnOptions::new(1280, 800))
        .await
        .unwrap();

    let resp = app
        .clone()
        .oneshot(json_request(
            "DELETE",
            &format!("/api/browser/{}", foreign.id),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    assert!(state.browser_manager.is_owned_by(foreign.id, "u2"));
}

#[tokio::test]
async fn spawn_browser_rejects_unknown_project_ids() {
    let (app, _state, _db) = build_test_app();
    let project_id = ProjectId::new();

    let resp = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/browser",
            Some(json!({
                "width": 1280,
                "height": 800,
                "project_id": project_id.to_string(),
            })),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_browser_settings_rejects_unknown_project_ids() {
    let (app, _state, _db) = build_test_app();
    let project_id = ProjectId::new();

    let resp = app
        .clone()
        .oneshot(json_request(
            "GET",
            &format!("/api/browser/projects/{}/settings", project_id),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn spawn_terminal_rejects_unknown_project_ids() {
    let (app, _state, _db) = build_test_app();
    let project_id = ProjectId::new();

    let resp = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/terminal",
            Some(json!({
                "cols": 80,
                "rows": 24,
                "project_id": project_id.to_string(),
            })),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
