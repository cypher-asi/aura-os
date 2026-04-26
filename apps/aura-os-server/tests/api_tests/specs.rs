use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

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

    let req = json_request(
        "GET",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
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
async fn delete_spec_with_associated_tasks_returns_conflict() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "Spec With Tasks",
            "markdownContents": "# Spec",
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
            "title": "Blocking Task",
            "description": "Prevents spec deletion",
            "status": "pending",
            "order_index": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let task = response_json(resp).await;
    let task_id = task["task_id"].as_str().unwrap().to_string();

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let body = response_json(resp).await;
    assert_eq!(body["code"], "conflict");
    let msg = body["error"].as_str().unwrap_or_default();
    assert!(
        msg.contains("1 associated task"),
        "expected conflict message to mention the associated task, got: {msg}"
    );

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["spec_id"], spec_id);

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/tasks/{task_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = json_request(
        "DELETE",
        &format!("/api/projects/{project_id}/specs/{spec_id}"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}
