use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use aura_os_core::*;

use crate::common::*;

#[tokio::test]
async fn bad_uuid_returns_400() {
    let (app, _, _db) = build_test_app();

    let req = json_request("GET", "/api/projects/not-a-uuid", None);
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

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
