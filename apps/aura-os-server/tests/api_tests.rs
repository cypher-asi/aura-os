mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use aura_os_core::*;

use common::*;

// ---------------------------------------------------------------------------
// Settings Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn settings_api_key_lifecycle() {
    let (app, _, _db) = build_test_app();
    // GET returns ApiKeyInfo { configured: bool }.
    let req = json_request("GET", "/api/settings/api-key", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(
        body["configured"].is_boolean(),
        "expected configured field: {}",
        body
    );
}

// ---------------------------------------------------------------------------
// Project Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_crud() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    // Create a temp dir for the project linked folder
    let project_dir = tempfile::tempdir().unwrap();

    // Create
    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "Test Project",
            "description": "A test",
            "linked_folder_path": project_dir.path().to_string_lossy()
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let project_id = body["project_id"].as_str().unwrap().to_string();
    assert_eq!(body["name"], "Test Project");

    // List (org-scoped; no org_id returns empty)
    let req = json_request("GET", &format!("/api/projects?org_id={}", org_id), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 1);

    // Get
    let req = json_request("GET", &format!("/api/projects/{project_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Test Project");

    // Update
    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}"),
        Some(serde_json::json!({"name": "Updated Name"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Updated Name");

    // Archive (returns project from network; archive status not yet supported on network)
    let req = json_request("POST", &format!("/api/projects/{project_id}/archive"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert!(body.get("project_id").is_some() || body.get("name").is_some());
}

#[tokio::test]
async fn project_not_found() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "network_error");
}

#[tokio::test]
async fn project_create_invalid_name() {
    let (app, _, _db) = build_test_app();

    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "",
            "description": "desc",
            "linked_folder_path": "."
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

// ---------------------------------------------------------------------------
// Task/Progress Endpoint Tests
// ---------------------------------------------------------------------------

// task_list_and_progress test removed -- requires seeding tasks via local RocksDB
// which was removed in Phase 5e. Will be rewritten with aura-storage mock in Phase 9e.

// ---------------------------------------------------------------------------
// Agent Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn agent_list_empty() {
    let (app, _state, _db) = build_test_app_with_mocks().await;

    let pid = ProjectId::new();
    // Project agents come from storage only; mock storage returns empty list.
    let req = json_request("GET", &format!("/api/projects/{pid}/agents"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn agent_not_found() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    let pid = ProjectId::new();
    let aid = AgentId::new();
    let req = json_request("GET", &format!("/api/projects/{pid}/agents/{aid}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Bad UUID in path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn bad_uuid_returns_400() {
    let (app, _, _db) = build_test_app();

    let req = json_request("GET", "/api/projects/not-a-uuid", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Dev Loop - no API key
// ---------------------------------------------------------------------------

#[tokio::test]
async fn loop_stop_without_running() {
    let (app, _, _db) = build_test_app();

    let pid = ProjectId::new();
    let req = json_request("POST", &format!("/api/projects/{pid}/loop/stop"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// Error format consistency
// ---------------------------------------------------------------------------

#[tokio::test]
async fn error_format_has_error_and_code() {
    let (app, _, _db) = build_test_app();

    let fake_id = ProjectId::new();
    let req = json_request("GET", &format!("/api/projects/{fake_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    let body = response_json(resp).await;

    assert!(body["error"].is_string());
    assert!(body["code"].is_string());
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cors_headers_present() {
    let (app, _, _db) = build_test_app();

    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/projects")
        .header("Origin", "http://localhost:3000")
        .header("Access-Control-Request-Method", "GET")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert!(resp.headers().contains_key("access-control-allow-origin"));
    assert_eq!(
        resp.headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:3000")
    );
    assert_eq!(
        resp.headers()
            .get("access-control-allow-credentials")
            .and_then(|value| value.to_str().ok()),
        Some("true")
    );
}
