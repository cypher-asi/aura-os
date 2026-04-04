mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use aura_os_core::*;

use common::*;

// ---------------------------------------------------------------------------
// Project Endpoint Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_crud() {
    let (app, _, _db) = build_test_app_with_mocks().await;

    // Create
    let org_id = OrgId::new();
    let req = json_request(
        "POST",
        "/api/projects",
        Some(serde_json::json!({
            "org_id": org_id,
            "name": "Test Project",
            "description": "A test"
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
            "description": "desc"
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

#[tokio::test]
async fn spec_routes_support_storage_backed_crud() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "API Spec",
            "markdownContents": "# API Spec",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = response_json(resp).await;
    let spec_id = created["spec_id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "API Spec");

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["spec_id"], spec_id);

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs/{spec_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let fetched = response_json(resp).await;
    assert_eq!(fetched["title"], "API Spec");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        Some(serde_json::json!({
            "title": "Updated API Spec",
            "markdownContents": "# Updated API Spec"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["title"], "Updated API Spec");
    assert_eq!(updated["markdown_contents"], "# Updated API Spec");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        Some(serde_json::json!({
            "markdown_contents": "# Updated Via Snake Case",
            "order_index": 3
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["markdown_contents"], "# Updated Via Snake Case");
    assert_eq!(updated["order_index"], 3);

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert!(listed.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn task_routes_support_storage_backed_crud_and_state_changes() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "Task Parent Spec",
            "markdownContents": "# Parent",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let spec = response_json(resp).await;
    let spec_id = spec["spec_id"].as_str().unwrap().to_string();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "spec_id": spec_id.clone(),
            "title": "Primary Task",
            "description": "Initial description",
            "status": "pending",
            "order_index": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = response_json(resp).await;
    let task_id = created["task_id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "Primary Task");
    assert_eq!(created["status"], "pending");

    let req = json_request("GET", &format!("/api/projects/{project_id}/tasks"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);

    let req = json_request("GET", &format!("/api/projects/{project_id}/tasks/{task_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let fetched = response_json(resp).await;
    assert_eq!(fetched["description"], "Initial description");

    let req = json_request(
        "PUT",
        &format!("/api/projects/{project_id}/tasks/{task_id}"),
        Some(serde_json::json!({
            "title": "Primary Task Updated",
            "description": "Updated description"
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = response_json(resp).await;
    assert_eq!(updated["title"], "Primary Task Updated");
    assert_eq!(updated["description"], "Updated description");

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks/{task_id}/transition"),
        Some(serde_json::json!({ "new_status": "ready" })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let transitioned = response_json(resp).await;
    assert_eq!(transitioned["status"], "ready");

    let req = json_request(
        "GET",
        &format!("/api/projects/{project_id}/specs/{spec_id}/tasks"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let by_spec = response_json(resp).await;
    assert_eq!(by_spec.as_array().unwrap().len(), 1);
    assert_eq!(by_spec[0]["task_id"], task_id);

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "spec_id": spec_id.clone(),
            "title": "Retry Task",
            "description": "Should return to ready",
            "status": "failed",
            "order_index": 1
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let failed = response_json(resp).await;
    let failed_task_id = failed["task_id"].as_str().unwrap().to_string();
    assert_eq!(failed["status"], "failed");

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks/{failed_task_id}/retry"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let retried = response_json(resp).await;
    assert_eq!(retried["status"], "ready");

    for task_id in [&task_id, &failed_task_id] {
        let req = json_request(
            "DELETE",
            &format!("/api/projects/{project_id}/tasks/{task_id}"),
            None,
        );
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    let req = json_request("GET", &format!("/api/projects/{project_id}/tasks"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert!(listed.as_array().unwrap().is_empty());
}

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
