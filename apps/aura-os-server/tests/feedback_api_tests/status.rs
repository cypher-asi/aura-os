//! Status PATCH forwarding to aura-network.

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mock::{build_test_app_with_feedback_network, response_status};

#[tokio::test]
async fn status_update_rejects_unknown_status() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "PATCH",
        "/api/feedback/any-id/status",
        Some(json!({"status": "schrodinger"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn status_update_merges_status_into_metadata() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "something",
            "category": "bug",
            "status": "not_started",
            "product": "aura",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    let post_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let patch = json_request(
        "PATCH",
        &format!("/api/feedback/{post_id}/status"),
        Some(json!({"status": "in_progress"})),
    );
    let resp = app.clone().oneshot(patch).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["status"], "in_progress");
    assert_eq!(body["category"], "bug", "category is preserved");
}
