//! Vote POST forwarding to aura-network and aggregate responses.

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mock::{build_test_app_with_feedback_network, response_status};

#[tokio::test]
async fn cast_vote_rejects_unknown_value() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "POST",
        "/api/feedback/any-id/vote",
        Some(json!({"vote": "sideways"})),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn cast_vote_toggle_flow_up_down_none() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let create = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "vote me",
            "category": "feature_request",
            "status": "not_started",
            "product": "aura",
        })),
    );
    let created = app.clone().oneshot(create).await.unwrap();
    let post_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let up = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "up"})),
    );
    let resp = app.clone().oneshot(up).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let summary = response_json(resp).await;
    assert_eq!(summary["upvotes"], 1);
    assert_eq!(summary["downvotes"], 0);
    assert_eq!(summary["voteScore"], 1);
    assert_eq!(summary["viewerVote"], "up");

    let down = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "down"})),
    );
    let resp = app.clone().oneshot(down).await.unwrap();
    let summary = response_json(resp).await;
    assert_eq!(summary["upvotes"], 0);
    assert_eq!(summary["downvotes"], 1);
    assert_eq!(summary["voteScore"], -1);
    assert_eq!(summary["viewerVote"], "down");

    let none = json_request(
        "POST",
        &format!("/api/feedback/{post_id}/vote"),
        Some(json!({"vote": "none"})),
    );
    let resp = app.clone().oneshot(none).await.unwrap();
    let summary = response_json(resp).await;
    assert_eq!(summary["upvotes"], 0);
    assert_eq!(summary["downvotes"], 0);
    assert_eq!(summary["voteScore"], 0);
    assert_eq!(summary["viewerVote"], "none");
}
