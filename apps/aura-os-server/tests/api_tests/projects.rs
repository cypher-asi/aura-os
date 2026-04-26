use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

#[tokio::test]
async fn project_crud() {
    let (app, _, _db) = build_test_app_with_mocks().await;

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

    let req = json_request("GET", &format!("/api/projects?org_id={}", org_id), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body.as_array().unwrap().len(), 1);

    let req = json_request("GET", &format!("/api/projects/{project_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["name"], "Test Project");

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
