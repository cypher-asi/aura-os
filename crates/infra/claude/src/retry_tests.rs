use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;

use crate::error::ClaudeClientError;
use crate::types::{SimpleMessage, SimpleMessagesRequest};
use crate::ClaudeClient;

type CallCounter = Arc<AtomicU32>;

async fn mock_handler(
    State((counter, responses)): State<(CallCounter, Vec<(u16, String)>)>,
    _body: String,
) -> axum::response::Response {
    let idx = counter.fetch_add(1, Ordering::SeqCst) as usize;
    let (status, body) = if idx < responses.len() {
        responses[idx].clone()
    } else {
        responses.last().unwrap().clone()
    };
    let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (sc, body).into_response()
}

async fn start_mock(responses: Vec<(u16, String)>) -> (String, CallCounter) {
    let counter = Arc::new(AtomicU32::new(0));
    let app = Router::new()
        .route("/v1/messages", post(mock_handler))
        .with_state((counter.clone(), responses));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
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
        (429, r#"{"error":{"type":"rate_limit","message":"rate limited"}}"#.into()),
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

    assert!(result.is_ok(), "expected Ok after 529 retries, got {result:?}");
    assert_eq!(counter.load(Ordering::SeqCst), 3);
}
