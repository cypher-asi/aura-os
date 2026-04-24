mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use common::{build_test_app, response_json};

const CAPTURE_SECRET_ENV: &str = "AURA_CHANGELOG_CAPTURE_SECRET";
const TEST_CAPTURE_SECRET: &str = "capture-secret-with-enough-entropy";

#[tokio::test]
async fn capture_session_bootstraps_auth_cache_without_zos_validation() {
    std::env::set_var(CAPTURE_SECRET_ENV, TEST_CAPTURE_SECRET);
    let (app, _state, _db) = build_test_app();

    let req = Request::builder()
        .method("POST")
        .uri("/api/capture/session")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "secret": TEST_CAPTURE_SECRET })).unwrap(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = response_json(resp).await;
    let token = body["access_token"].as_str().unwrap();
    assert!(token.starts_with("aura-capture:"));
    assert_eq!(body["display_name"], "Aura Capture");

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/validate")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = response_json(resp).await;
    assert_eq!(body["display_name"], "Aura Capture");

    std::env::remove_var(CAPTURE_SECRET_ENV);
}
