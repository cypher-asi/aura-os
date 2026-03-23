use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::error::ClaudeClientError;
use crate::types::{SimpleMessage, SimpleMessagesRequest};
use crate::{AuthMode, ClaudeClient, DEFAULT_MODEL};

static ENV_MUTEX: Mutex<()> = Mutex::new(());

type CallCounter = Arc<AtomicU32>;

async fn mock_handler(
    State((counter, responses)): State<(CallCounter, Vec<(u16, String)>)>,
    _body: String,
) -> axum::response::Response {
    let idx = counter.fetch_add(1, Ordering::SeqCst) as usize;
    let (status, body) = if idx < responses.len() {
        responses[idx].clone()
    } else {
        responses
            .last()
            .expect("responses vec should not be empty")
            .clone()
    };
    let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (sc, body).into_response()
}

async fn start_mock(responses: Vec<(u16, String)>) -> (String, CallCounter) {
    let counter = Arc::new(AtomicU32::new(0));
    let app = Router::new()
        .route("/v1/messages", post(mock_handler))
        .with_state((counter.clone(), responses));
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock TCP listener");
    let addr = listener.local_addr().expect("get local addr");
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    (format!("http://{addr}"), counter)
}

fn make_request() -> SimpleMessagesRequest {
    SimpleMessagesRequest {
        model: "test-model".into(),
        max_tokens: 128,
        system: serde_json::json!("test system"),
        messages: vec![SimpleMessage {
            role: "user".into(),
            content: "hi".into(),
        }],
        stream: Some(false),
    }
}

fn ok_body() -> String {
    serde_json::json!({
        "content": [{"type": "text", "text": "ok"}],
        "model": "test",
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 5}
    })
    .to_string()
}

#[tokio::test]
async fn non_stream_retry_succeeds_after_429() {
    let responses = vec![
        (
            429,
            r#"{"error":{"type":"rate_limit","message":"rate limited"}}"#.into(),
        ),
        (200, ok_body()),
    ];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let result = client
        .complete_non_stream_with_retry("fake-key", &url, &make_request())
        .await;

    assert!(result.is_ok(), "expected Ok after retry, got {result:?}");
    assert_eq!(counter.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn non_stream_retries_exhausted_returns_overloaded() {
    let responses = vec![
        (429, "rate limited".into()),
        (429, "rate limited".into()),
        (429, "rate limited".into()),
    ];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let result = client
        .complete_non_stream_with_retry("fake-key", &url, &make_request())
        .await;

    assert!(
        matches!(result, Err(ClaudeClientError::Overloaded)),
        "expected Overloaded, got {result:?}"
    );
    assert_eq!(counter.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn non_stream_non_retryable_error_passes_through() {
    let responses = vec![(400, r#"{"error":"bad request"}"#.into())];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let result = client
        .complete_non_stream_with_retry("fake-key", &url, &make_request())
        .await;

    match result {
        Err(ClaudeClientError::Api { status, .. }) => assert_eq!(status, 400),
        other => panic!("expected Api {{ status: 400, .. }}, got {other:?}"),
    }
    assert_eq!(counter.load(Ordering::SeqCst), 1, "should not retry on 400");
}

#[tokio::test]
async fn non_stream_529_triggers_retry() {
    let responses = vec![
        (529, "overloaded".into()),
        (529, "overloaded".into()),
        (200, ok_body()),
    ];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let result = client
        .complete_non_stream_with_retry("fake-key", &url, &make_request())
        .await;

    assert!(
        result.is_ok(),
        "expected Ok after 529 retries, got {result:?}"
    );
    assert_eq!(counter.load(Ordering::SeqCst), 3);
}

// ---------------------------------------------------------------------------
// AuthMode detection tests
// ---------------------------------------------------------------------------

#[test]
fn test_new_without_router_url() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::remove_var("AURA_ROUTER_URL");
    let client = ClaudeClient::new();
    assert_eq!(client.auth_mode, AuthMode::ApiKey);
    assert_eq!(client.base_url, "https://api.anthropic.com");
}

#[test]
fn test_new_with_router_url() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");
    let client = ClaudeClient::new();
    assert_eq!(client.auth_mode, AuthMode::Bearer);
    assert_eq!(client.base_url, "https://router.example.com");
    std::env::remove_var("AURA_ROUTER_URL");
}

#[test]
fn test_new_with_empty_router_url() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::set_var("AURA_ROUTER_URL", "");
    let client = ClaudeClient::new();
    assert_eq!(client.auth_mode, AuthMode::ApiKey);
    assert_eq!(client.base_url, "https://api.anthropic.com");
    std::env::remove_var("AURA_ROUTER_URL");
}

#[test]
fn test_is_router_mode() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::remove_var("AURA_ROUTER_URL");
    let api_client = ClaudeClient::new();
    assert!(!api_client.is_router_mode());

    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");
    let bearer_client = ClaudeClient::new();
    assert!(bearer_client.is_router_mode());
    std::env::remove_var("AURA_ROUTER_URL");
}

#[test]
fn test_with_model_preserves_auth_mode() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::set_var("AURA_ROUTER_URL", "https://router.example.com");
    let client = ClaudeClient::with_model("claude-haiku-4-5-20251001");
    assert_eq!(client.auth_mode, AuthMode::Bearer);
    assert_eq!(client.base_url, "https://router.example.com");
    assert_eq!(client.model, "claude-haiku-4-5-20251001");
    std::env::remove_var("AURA_ROUTER_URL");
}

#[test]
fn test_with_base_url_uses_apikey_mode() {
    let client = ClaudeClient::with_base_url("http://localhost:9999");
    assert_eq!(client.auth_mode, AuthMode::ApiKey);
    assert_eq!(client.base_url, "http://localhost:9999");
    assert_eq!(client.model, DEFAULT_MODEL);
}

// ---------------------------------------------------------------------------
// 402 handling tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_non_stream_402_returns_insufficient_credits() {
    let responses = vec![(402, r#"{"error":"insufficient credits"}"#.into())];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let result = client
        .complete_non_stream_with_retry("fake-key", &url, &make_request())
        .await;

    assert!(
        matches!(result, Err(ClaudeClientError::InsufficientCredits)),
        "expected InsufficientCredits, got {result:?}"
    );
    assert_eq!(
        counter.load(Ordering::SeqCst),
        1,
        "402 should not be retried"
    );
}

#[tokio::test]
async fn test_stream_402_returns_insufficient_credits() {
    let responses = vec![(402, r#"{"error":"insufficient credits"}"#.into())];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let body = serde_json::to_value(&make_request()).unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();

    let result = client
        .stream_with_retry_and_fallback("fake-key", &url, body, &tx)
        .await;

    assert!(
        matches!(result, Err(ClaudeClientError::InsufficientCredits)),
        "expected InsufficientCredits, got {result:?}"
    );
    assert_eq!(
        counter.load(Ordering::SeqCst),
        1,
        "402 should not be retried"
    );
}

#[tokio::test]
async fn test_402_is_not_retried() {
    let responses = vec![(402, "payment required".into()), (200, ok_body())];
    let (base, counter) = start_mock(responses).await;
    let client = ClaudeClient::with_base_url(&base);
    let url = format!("{base}/v1/messages");

    let result = client
        .complete_non_stream_with_retry("fake-key", &url, &make_request())
        .await;

    assert!(matches!(
        result,
        Err(ClaudeClientError::InsufficientCredits)
    ));
    assert_eq!(
        counter.load(Ordering::SeqCst),
        1,
        "should hit server exactly once — no retries for 402"
    );
}
