mod common;

use std::sync::{LazyLock, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Router;
use serde_json::json;
use tokio::net::TcpListener;
use tower::ServiceExt;

use common::*;

static HARNESS_URL_ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Start a lightweight mock harness that echoes back request info as JSON.
async fn start_mock_harness() -> (String, tokio::task::JoinHandle<()>) {
    let echo_handler = |req: Request<Body>| async move {
        let method = req.method().to_string();
        let uri = req.uri().to_string();
        let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        let body_str = String::from_utf8_lossy(&body_bytes).to_string();
        let resp = json!({
            "echoed_method": method,
            "echoed_uri": uri,
            "echoed_body": body_str,
        });
        axum::Json(resp).into_response()
    };

    let mock_app = Router::new()
        .route("/api/agents/:agent_id/memory/facts", get(echo_handler).post(echo_handler))
        .route("/api/agents/:agent_id/memory/facts/:fact_id", get(echo_handler).put(echo_handler).delete(echo_handler))
        .route("/api/agents/:agent_id/memory/events", get(echo_handler).post(echo_handler))
        .route("/api/agents/:agent_id/memory/events/:event_id", delete(echo_handler))
        .route("/api/agents/:agent_id/memory/procedures", get(echo_handler).post(echo_handler))
        .route("/api/agents/:agent_id/memory/procedures/by-skill/:skill_name", get(echo_handler))
        .route("/api/agents/:agent_id/memory/procedures/:proc_id", get(echo_handler).put(echo_handler).delete(echo_handler))
        .route("/api/agents/:agent_id/memory", get(echo_handler).delete(echo_handler))
        .route("/api/agents/:agent_id/memory/stats", get(echo_handler))
        .route("/api/agents/:agent_id/memory/consolidate", post(echo_handler))
        .route("/api/skills", get(echo_handler).post(echo_handler))
        .route("/api/skills/:name", get(echo_handler))
        .route("/api/skills/:name/activate", post(echo_handler))
        .route("/api/agents/:agent_id/skills", get(echo_handler).post(echo_handler))
        .route("/api/agents/:agent_id/skills/:name", delete(echo_handler));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let handle = tokio::spawn(async move {
        axum::serve(listener, mock_app).await.ok();
    });

    (url, handle)
}

#[tokio::test]
async fn proxy_forwards_get_facts() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("GET", &format!("/api/harness/agents/{agent}/memory/facts"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"].as_str().unwrap().contains(&format!("/api/agents/{agent}/memory/facts")));
}

#[tokio::test]
async fn proxy_forwards_post_with_body() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({"key": "lang", "value": "Rust", "confidence": 0.9});
    let req = json_request("POST", &format!("/api/harness/agents/{agent}/memory/facts"), Some(payload.clone()));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
    let echoed_body: serde_json::Value = serde_json::from_str(body["echoed_body"].as_str().unwrap()).unwrap();
    assert_eq!(echoed_body["key"], "lang");
}

#[tokio::test]
async fn proxy_forwards_delete() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("DELETE", &format!("/api/harness/agents/{agent}/memory/facts/f1"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "DELETE");
    assert!(body["echoed_uri"].as_str().unwrap().contains(&format!("/api/agents/{agent}/memory/facts/f1")));
}

#[tokio::test]
async fn proxy_forwards_skills_list() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let req = json_request("GET", "/api/harness/skills", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"].as_str().unwrap().contains("/api/skills"));
}

#[tokio::test]
async fn proxy_forwards_skill_activate() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let payload = json!({"arguments": "production us-east-1"});
    let req = json_request("POST", "/api/harness/skills/deploy/activate", Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
    assert!(body["echoed_uri"].as_str().unwrap().contains("/api/skills/deploy/activate"));
}

#[tokio::test]
async fn proxy_forwards_agent_skills_list() {
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("GET", &format!("/api/harness/agents/{agent}/skills"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    assert!(body["echoed_uri"].as_str().unwrap().contains(&format!("/api/agents/{agent}/skills")));
}

#[tokio::test]
async fn proxy_forwards_agent_skill_install() {
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let payload = json!({"name": "deploy", "source_url": null});
    let req = json_request("POST", &format!("/api/harness/agents/{agent}/skills"), Some(payload));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "POST");
}

#[tokio::test]
async fn proxy_forwards_agent_skill_uninstall() {
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("DELETE", &format!("/api/harness/agents/{agent}/skills/deploy"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "DELETE");
    assert!(body["echoed_uri"].as_str().unwrap().contains(&format!("/api/agents/{agent}/skills/deploy")));
}

#[tokio::test]
async fn proxy_forwards_procedures_by_skill() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    let (mock_url, _handle) = start_mock_harness().await;
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", &mock_url); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("GET", &format!("/api/harness/agents/{agent}/memory/procedures/by-skill/deploy"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["echoed_method"], "GET");
    let uri = body["echoed_uri"].as_str().unwrap();
    assert!(uri.contains("/api/agents/"));
    assert!(uri.contains("/memory/procedures"));
    assert!(uri.contains("skill=deploy"));
}

#[tokio::test]
async fn proxy_returns_502_on_connection_failure() {
    let _guard = HARNESS_URL_ENV_LOCK.lock().unwrap();
    unsafe { std::env::set_var("LOCAL_HARNESS_URL", "http://127.0.0.1:1"); }

    let (app, _, _db) = build_test_app_with_mocks().await;
    let agent = "00000000-0000-0000-0000-000000000001";
    let req = json_request("GET", &format!("/api/harness/agents/{agent}/memory/facts"), None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
}
