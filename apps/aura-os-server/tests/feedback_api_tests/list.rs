//! List endpoint: filtering and vote aggregate surfacing.

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mock::{
    build_test_app_with_feedback_network, response_status, seed_feed_event, FEEDBACK_EVENT_TYPE,
};

#[tokio::test]
async fn list_feedback_filters_to_feedback_event_type() {
    let seed = vec![
        seed_feed_event(
            "00000000-0000-0000-0000-00000000aaaa",
            "post",
            "2026-04-17T00:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000bbbb",
            FEEDBACK_EVENT_TYPE,
            "2026-04-17T01:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000cccc",
            "push",
            "2026-04-17T02:00:00Z",
        ),
        seed_feed_event(
            "00000000-0000-0000-0000-00000000dddd",
            FEEDBACK_EVENT_TYPE,
            "2026-04-17T03:00:00Z",
        ),
    ];
    let (app, _db) = build_test_app_with_feedback_network(seed).await;

    let req = json_request("GET", "/api/feedback", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);

    let body = response_json(resp).await;
    let items = body.as_array().expect("list is an array");
    assert_eq!(items.len(), 2, "only feedback event_type items surface");
    for item in items {
        assert_eq!(item["eventType"], FEEDBACK_EVENT_TYPE);
    }
    assert_eq!(items[0]["createdAt"], "2026-04-17T03:00:00Z");
    assert_eq!(items[1]["createdAt"], "2026-04-17T01:00:00Z");
}

#[tokio::test]
async fn list_feedback_rejects_unknown_sort() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request("GET", "/api/feedback?sort=spaghetti", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn list_surfaces_vote_aggregates_from_upstream() {
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
    app.clone().oneshot(up).await.unwrap();

    let list = json_request("GET", "/api/feedback", None);
    let resp = app.clone().oneshot(list).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::OK);
    let items = response_json(resp).await;
    let arr = items.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["upvotes"], 1);
    assert_eq!(arr[0]["voteScore"], 1);
    assert_eq!(arr[0]["viewerVote"], "up");
}
