use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

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

    let req = json_request(
        "GET",
        &format!("/api/projects/{project_id}/tasks/{task_id}"),
        None,
    );
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

#[tokio::test]
async fn create_task_without_spec_id_uses_manual_tasks_spec() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "title": "Manual board task",
            "description": "Created directly from the task board",
            "status": "backlog",
            "order_index": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let created = response_json(resp).await;
    assert_eq!(created["title"], "Manual board task");
    let spec_id = created["spec_id"]
        .as_str()
        .expect("manual task should receive a backing spec id");

    let req = json_request("GET", &format!("/api/projects/{project_id}/specs"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let specs = response_json(resp).await;
    let manual_specs: Vec<_> = specs
        .as_array()
        .unwrap()
        .iter()
        .filter(|spec| spec["title"] == "Manual Tasks")
        .collect();
    assert_eq!(manual_specs.len(), 1);
    assert_eq!(manual_specs[0]["spec_id"].as_str(), Some(spec_id));

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "title": "Second manual task",
            "status": "backlog",
            "order_index": 1
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let second = response_json(resp).await;
    assert_eq!(
        second["spec_id"].as_str(),
        Some(spec_id),
        "subsequent manual tasks should reuse the Manual Tasks spec"
    );
}

/// User-initiated "Re-do" of a previously completed task. Exercises
/// the dedicated `done -> ready` edge added in
/// `docs/migrations/2026-05-25-task-redo-transition.md` and verifies
/// that the handler also clears the persisted `attempts` counter so
/// the dev-loop's auto-retry budget starts fresh.
#[tokio::test]
async fn redo_resets_done_task_to_ready_and_clears_attempts() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "Redo Spec",
            "markdownContents": "# Spec",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let spec = response_json(resp).await;
    let spec_id = spec["spec_id"].as_str().unwrap().to_string();

    // Seed the task directly in the `done` state. The mock storage
    // accepts any starting status, which lets us test the redo edge
    // in isolation without driving the full ready -> in_progress ->
    // done lifecycle for every assertion.
    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks"),
        Some(serde_json::json!({
            "spec_id": spec_id.clone(),
            "title": "Done Task",
            "description": "Already finished",
            "status": "done",
            "order_index": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let done = response_json(resp).await;
    let done_task_id = done["task_id"].as_str().unwrap().to_string();
    assert_eq!(done["status"], "done");

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks/{done_task_id}/redo"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let redone = response_json(resp).await;
    assert_eq!(
        redone["status"], "ready",
        "redo must transition done -> ready"
    );
    assert_eq!(
        redone["attempts"], 0,
        "redo must reset the attempts counter so MAX_TASK_ATTEMPTS starts fresh"
    );
}

/// Ensures the redo handler still rejects unknown task ids with a
/// 404 (rather than surfacing the storage error verbatim) — guards
/// against the matcher in `redo_task` regressing to the catch-all
/// internal-error arm.
#[tokio::test]
async fn redo_unknown_task_returns_not_found() {
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();
    let unknown_task_id = TaskId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/tasks/{unknown_task_id}/redo"),
        None,
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_task_is_idempotent_on_title_within_spec() {
    // Regression: agents chain `generate specs → extract tasks → start
    // loop`, and the `extract_tasks` sub-session is prompted to "create
    // or update the project's tasks". Without server-side de-dup every
    // retry of that chain re-created every task with a fresh UUID, which
    // surfaced as duplicate rows in the task list UI. The handler now
    // treats `(project_id, spec_id, case-insensitive trimmed title)` as
    // an idempotency key and returns the existing task instead.
    let (app, _state, _storage, _db) = build_test_app_with_storage().await;
    let project_id = ProjectId::new();

    let req = json_request(
        "POST",
        &format!("/api/projects/{project_id}/specs"),
        Some(serde_json::json!({
            "title": "Dedupe Spec",
            "markdownContents": "# Spec",
            "orderIndex": 0
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let spec = response_json(resp).await;
    let spec_id = spec["spec_id"].as_str().unwrap().to_string();

    let make_task_req = |title: &str| {
        json_request(
            "POST",
            &format!("/api/projects/{project_id}/tasks"),
            Some(serde_json::json!({
                "spec_id": spec_id.clone(),
                "title": title,
                "description": "irrelevant",
                "status": "pending",
                "order_index": 0
            })),
        )
    };

    let resp = app
        .clone()
        .oneshot(make_task_req("Seed Task"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let first = response_json(resp).await;
    let first_id = first["task_id"].as_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(make_task_req("Seed Task"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let second = response_json(resp).await;
    assert_eq!(
        second["task_id"].as_str().unwrap(),
        first_id,
        "duplicate create_task call must return the existing task_id"
    );

    let resp = app
        .clone()
        .oneshot(make_task_req("  seed task  "))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let third = response_json(resp).await;
    assert_eq!(
        third["task_id"].as_str().unwrap(),
        first_id,
        "whitespace/case variations must still match the existing task"
    );

    let req = json_request("GET", &format!("/api/projects/{project_id}/tasks"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let listed = response_json(resp).await;
    let rows = listed.as_array().unwrap();
    assert_eq!(rows.len(), 1, "dedupe must not create additional rows");

    let resp = app
        .clone()
        .oneshot(make_task_req("Another Task"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let fourth = response_json(resp).await;
    assert_ne!(fourth["task_id"].as_str().unwrap(), first_id);
}
