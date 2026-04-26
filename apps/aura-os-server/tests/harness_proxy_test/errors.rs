use axum::http::StatusCode;
use tower::ServiceExt;

use super::common::*;
use super::HARNESS_URL_ENV_LOCK;

#[tokio::test]
async fn delete_my_skill_rejects_invalid_name() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    // The invalid-name guard runs before any filesystem or harness access,
    // so a bogus LOCAL_HARNESS_URL is sufficient here and avoids pulling
    // in the unix-gated mock harness helper.
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", "http://127.0.0.1:1");
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    // Valid skill names are [a-z0-9-]+. Uppercase is invalid and makes a
    // clean URI segment that still reaches the handler, so the guard is
    // what produces the 400 (not the HTTP layer).
    let req = json_request("DELETE", "/api/harness/skills/mine/BadName", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn proxy_returns_502_on_connection_failure() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().await;
    unsafe {
        std::env::set_var("LOCAL_HARNESS_URL", "http://127.0.0.1:1");
    }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request(
        "GET",
        &format!("/api/harness/agents/{agent}/memory/facts"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
}
