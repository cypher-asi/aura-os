//! Feedback creation: validation and round-trip plus get_feedback filtering.

use axum::http::StatusCode;
use serde_json::json;
use tower::ServiceExt;

use super::common::*;
use super::mock::{
    build_test_app_with_feedback_network, response_status, seed_feed_event, FEEDBACK_EVENT_TYPE,
};

#[tokio::test]
async fn create_feedback_rejects_unknown_category() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "body",
            "category": "not-a-category",
            "status": "not_started",
            "product": "aura",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_rejects_unknown_status() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "body",
            "category": "bug",
            "status": "definitely-not-a-status",
            "product": "aura",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_rejects_unknown_product() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "body",
            "category": "bug",
            "status": "not_started",
            "product": "not-a-product",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_persists_product_tag_and_surfaces_on_list() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "grid-specific request",
            "category": "feature_request",
            "status": "not_started",
            "product": "the_grid",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["product"], "the_grid");

    let list = json_request("GET", "/api/feedback", None);
    let resp = app.clone().oneshot(list).await.unwrap();
    let items = response_json(resp).await;
    let arr = items.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["product"], "the_grid");
}

#[tokio::test]
async fn create_feedback_rejects_empty_body() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;
    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "body": "   ",
            "category": "bug",
            "status": "not_started",
            "product": "aura",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_feedback_round_trip_shows_up_in_list() {
    let (app, _db) = build_test_app_with_feedback_network(vec![]).await;

    let req = json_request(
        "POST",
        "/api/feedback",
        Some(json!({
            "title": "Keyboard shortcuts please",
            "body": "Cmd+1/2/3 to focus panels",
            "category": "feature_request",
            "status": "not_started",
            "product": "aura",
        })),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::CREATED);
    let body = response_json(resp).await;
    assert_eq!(body["eventType"], FEEDBACK_EVENT_TYPE);
    assert_eq!(body["postType"], "post");
    assert_eq!(body["category"], "feature_request");
    assert_eq!(body["status"], "not_started");
    assert_eq!(body["product"], "aura");
    assert_eq!(body["upvotes"], 0);
    assert_eq!(body["viewerVote"], "none");

    let req = json_request("GET", "/api/feedback", None);
    let list = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&list), StatusCode::OK);
    let items = response_json(list).await;
    let array = items.as_array().expect("list array");
    assert_eq!(array.len(), 1);
    assert_eq!(array[0]["title"], "Keyboard shortcuts please");
}

#[tokio::test]
async fn get_feedback_returns_404_for_non_feedback_post() {
    let seed = vec![seed_feed_event(
        "00000000-0000-0000-0000-00000000aaaa",
        "post",
        "2026-04-17T00:00:00Z",
    )];
    let post_id = seed[0]["id"].as_str().unwrap().to_string();
    let (app, _db) = build_test_app_with_feedback_network(seed).await;

    let req = json_request("GET", &format!("/api/feedback/{post_id}"), None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response_status(&resp), StatusCode::NOT_FOUND);
}
