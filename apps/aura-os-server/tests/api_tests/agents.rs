use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

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
