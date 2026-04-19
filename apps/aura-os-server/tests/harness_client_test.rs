//! Phase 1 integration test for [`aura_os_server::HarnessClient`].
//!
//! Spins up a lightweight axum mock that implements the four harness
//! endpoints the client targets (`POST /tx`, `GET /agents/:id/head`,
//! `GET /agents/:id/record`, `GET /stream` upgrade) and verifies the
//! round trip, including `Authorization: Bearer` forwarding and a
//! one-shot WebSocket frame.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite;

use aura_os_server::{HarnessClient, HarnessTxKind};

/// Observations collected by the mock server for post-hoc assertions.
#[derive(Debug, Default)]
struct MockRecorder {
    seen_authorizations: Vec<Option<String>>,
    last_tx_body: Option<serde_json::Value>,
    last_record_query: Option<RecordQuery>,
}

#[derive(Debug, Clone, Deserialize)]
struct RecordQuery {
    from_seq: u64,
    limit: u64,
}

type SharedRecorder = Arc<Mutex<MockRecorder>>;

async fn tx_handler(
    State(rec): State<SharedRecorder>,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok().map(str::to_string));

    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .unwrap_or_default();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();

    let mut r = rec.lock().await;
    r.seen_authorizations.push(auth);
    r.last_tx_body = Some(json);

    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "accepted": true,
            "tx_id": "deadbeefcafe"
        })),
    )
}

async fn head_handler(
    State(rec): State<SharedRecorder>,
    Path(agent_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok().map(str::to_string));
    rec.lock().await.seen_authorizations.push(auth);

    Json(serde_json::json!({
        "agent_id": agent_id,
        "head_seq": 42_u64,
    }))
}

async fn record_handler(
    State(rec): State<SharedRecorder>,
    Path(_agent_id): Path<String>,
    Query(q): Query<RecordQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok().map(str::to_string));
    let mut r = rec.lock().await;
    r.seen_authorizations.push(auth);
    r.last_record_query = Some(q.clone());

    let entries = (q.from_seq..q.from_seq + q.limit.min(3))
        .map(|seq| serde_json::json!({ "seq": seq, "kind": "stub" }))
        .collect::<Vec<_>>();
    Json(entries)
}

async fn stream_handler(
    State(rec): State<SharedRecorder>,
    ws: WebSocketUpgrade,
    headers: HeaderMap,
) -> impl IntoResponse {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok().map(str::to_string));
    rec.lock().await.seen_authorizations.push(auth);

    ws.on_upgrade(move |socket| async move {
        let _ = serve_stream(socket).await;
    })
}

async fn serve_stream(mut socket: WebSocket) -> Result<(), axum::Error> {
    socket
        .send(Message::Text("hello-from-harness".into()))
        .await?;
    socket.close().await?;
    Ok(())
}

async fn start_mock_harness() -> (String, SharedRecorder, tokio::task::JoinHandle<()>) {
    let recorder: SharedRecorder = Arc::new(Mutex::new(MockRecorder::default()));

    let app = Router::new()
        .route("/tx", post(tx_handler))
        .route("/agents/:agent_id/head", get(head_handler))
        .route("/agents/:agent_id/record", get(record_handler))
        .route("/stream", get(stream_handler))
        .with_state(recorder.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    // Give the listener a moment to start accepting.
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    (url, recorder, handle)
}

#[tokio::test]
async fn submit_user_prompt_forwards_jwt_and_payload() {
    let (url, rec, _h) = start_mock_harness().await;
    let client = HarnessClient::new(url);

    let agent_id = "a".repeat(64);
    let resp = client
        .submit_user_prompt(&agent_id, "hello from aura-os", Some("jwt-abc"))
        .await
        .expect("submit_user_prompt succeeded");

    assert!(resp.accepted);
    assert_eq!(resp.tx_id, "deadbeefcafe");

    let r = rec.lock().await;
    let auth = r
        .seen_authorizations
        .first()
        .cloned()
        .flatten()
        .expect("authorization header present");
    assert_eq!(auth, "Bearer jwt-abc");

    let body = r.last_tx_body.as_ref().expect("tx body recorded");
    assert_eq!(body["agent_id"], serde_json::Value::String(agent_id));
    assert_eq!(body["kind"], "user_prompt");

    use base64::Engine;
    let b64 = body["payload"].as_str().expect("payload base64 string");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .expect("payload decodes");
    assert_eq!(decoded, b"hello from aura-os");
}

#[tokio::test]
async fn submit_tx_accepts_arbitrary_kind_and_bytes() {
    let (url, rec, _h) = start_mock_harness().await;
    let client = HarnessClient::new(url);

    let agent_id = "b".repeat(64);
    client
        .submit_tx(&agent_id, HarnessTxKind::System, b"\x00\x01\x02", None)
        .await
        .expect("submit_tx succeeded");

    let r = rec.lock().await;
    // No JWT was provided, so no Authorization header should have been sent.
    let auth = r.seen_authorizations.first().cloned().flatten();
    assert!(auth.is_none(), "expected no Authorization header, got {auth:?}");

    let body = r.last_tx_body.as_ref().expect("tx body recorded");
    assert_eq!(body["kind"], "system");
}

#[tokio::test]
async fn get_head_returns_sequence() {
    let (url, _rec, _h) = start_mock_harness().await;
    let client = HarnessClient::new(url);

    let agent_id = "c".repeat(64);
    let head = client
        .get_head(&agent_id, Some("jwt-xyz"))
        .await
        .expect("get_head succeeded");

    assert_eq!(head.agent_id, agent_id);
    assert_eq!(head.head_seq, 42);
}

#[tokio::test]
async fn scan_record_forwards_pagination_parameters() {
    let (url, rec, _h) = start_mock_harness().await;
    let client = HarnessClient::new(url);

    let agent_id = "d".repeat(64);
    let entries = client
        .scan_record(&agent_id, 5, 2, Some("jwt-page"))
        .await
        .expect("scan_record succeeded");

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["seq"], 5);
    assert_eq!(entries[1]["seq"], 6);

    let r = rec.lock().await;
    let q = r.last_record_query.as_ref().expect("query recorded");
    assert_eq!(q.from_seq, 5);
    assert_eq!(q.limit, 2);
}

#[tokio::test]
async fn subscribe_stream_receives_text_frame_and_forwards_jwt() {
    let (url, rec, _h) = start_mock_harness().await;
    let client = HarnessClient::new(url);

    let mut stream = client
        .subscribe_stream(Some("jwt-ws"))
        .await
        .expect("ws connect succeeded");

    let frame = tokio::time::timeout(std::time::Duration::from_secs(2), stream.next())
        .await
        .expect("frame arrived within timeout");

    let msg = frame.expect("frame present").expect("frame ok");
    match msg {
        tungstenite::Message::Text(t) => {
            assert_eq!(t.as_str(), "hello-from-harness");
        }
        other => panic!("unexpected ws message: {other:?}"),
    }

    // Server should have seen the JWT on the upgrade request.
    let r = rec.lock().await;
    let auth = r
        .seen_authorizations
        .iter()
        .find_map(|a| a.clone())
        .expect("authorization header present on ws upgrade");
    assert_eq!(auth, "Bearer jwt-ws");
}

#[tokio::test]
async fn http_error_status_is_surfaced() {
    // Start a server that always returns 500 on /tx so we can assert the
    // client maps non-2xx responses into `HarnessClientError::Status`.
    let app = Router::new().route(
        "/tx",
        post(|_: Request<Body>| async {
            (StatusCode::INTERNAL_SERVER_ERROR, "boom".to_string())
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let client = HarnessClient::new(url);
    let agent_id = "e".repeat(64);
    let err = client
        .submit_user_prompt(&agent_id, "x", None)
        .await
        .expect_err("expected error from 500 response");
    match err {
        aura_os_server::HarnessClientError::Status { status, body } => {
            assert_eq!(status, 500);
            assert_eq!(body, "boom");
        }
        other => panic!("unexpected error variant: {other:?}"),
    }
}
