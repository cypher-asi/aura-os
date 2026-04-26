//! Comment round-trip and validation.

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mock::{build_test_app_with_feedback_network, response_status};

#[tokio::test]
async fn feedback_comment_round_trip() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "Please add dark mode",
            "category": "feature_request",
            "status": "not_started",
            "product": "aura",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    assert_eq!(response_status(&created), StatusCode::CREATED);
    let post = response_json(created).await;
    let post_id = post["id"].as_str().unwrap().to_string();

    let add_comment = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/comments"),
        Some(json!({"content": "agreed"})),
    );
    let resp = app.clone().oneshot(add_comment).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["content"], "agreed");

    let list = json_request("GET", &format!("/api/feedback/{post_id}/comments"), None);
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let items = response_json(resp).await;
    let array = items.as_array().expect("array");
    assert_eq!(array.len(), 1);
    assert_eq!(array[0]["content"], "agreed");
}

#[tokio::test]
async fn add_comment_rejects_empty_content() {
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

    let req = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/comments"),
        Some(json!({"content": "   "})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}
