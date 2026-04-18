//! Phase 3 integration test for
//! [`aura_os_server::HarnessSuperAgentDriver`].
//!
//! Spins up an axum mock that imitates the aura-harness `/stream`
//! WebSocket. The mock:
//!
//! 1. receives the `session_init` frame,
//! 2. asserts it carries the CEO super-agent preset
//!    (system prompt, installed tools, intent classifier),
//! 3. replies with `session_ready`,
//! 4. echoes a `text_delta` + `assistant_message_end` after the
//!    `user_message` arrives.
//!
//! This exercises the full driver path end-to-end without a real
//! harness binary.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use aura_os_server::{HarnessClient, HarnessSuperAgentConfig, HarnessSuperAgentDriver};
use aura_os_super_agent_profile::SuperAgentProfile;
use aura_protocol::{
    AssistantMessageEnd, FilesChanged, InboundMessage, OutboundMessage, SessionReady,
    SessionUsage, TextDelta,
};

#[derive(Debug, Default)]
struct MockHarnessState {
    /// Captured `session_init` payload for assertions.
    received_init: Option<aura_protocol::SessionInit>,
    /// Captured `user_message` content for assertions.
    received_user_message: Option<String>,
}

type SharedState = Arc<Mutex<MockHarnessState>>;

async fn stream_handler(State(state): State<SharedState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        let _ = serve_super_agent_session(socket, state).await;
    })
}

async fn serve_super_agent_session(
    mut socket: WebSocket,
    state: SharedState,
) -> Result<(), axum::Error> {
    // Read frames until `session_init` arrives.
    let session_id = loop {
        let frame = match socket.next().await {
            Some(Ok(f)) => f,
            _ => return Ok(()),
        };
        let Message::Text(text) = frame else {
            continue;
        };
        let Ok(inbound) = serde_json::from_str::<InboundMessage>(&text) else {
            continue;
        };
        let InboundMessage::SessionInit(init) = inbound else {
            continue;
        };
        state.lock().await.received_init = Some(*init);
        let ready = OutboundMessage::SessionReady(SessionReady {
            session_id: "sess-test-1".into(),
            tools: Vec::new(),
            skills: Vec::new(),
        });
        socket
            .send(Message::Text(serde_json::to_string(&ready).unwrap().into()))
            .await?;
        break "sess-test-1".to_string();
    };

    // Then the user message.
    while let Some(Ok(frame)) = socket.next().await {
        let Message::Text(text) = frame else {
            continue;
        };
        let Ok(inbound) = serde_json::from_str::<InboundMessage>(&text) else {
            continue;
        };
        if let InboundMessage::UserMessage(msg) = inbound {
            state.lock().await.received_user_message = Some(msg.content.clone());

            // Emit a minimal event stream: one text_delta + end.
            let delta = OutboundMessage::TextDelta(TextDelta {
                text: "hello from harness".into(),
            });
            socket
                .send(Message::Text(serde_json::to_string(&delta).unwrap().into()))
                .await?;

            let end = OutboundMessage::AssistantMessageEnd(AssistantMessageEnd {
                message_id: session_id.clone(),
                stop_reason: "end_turn".into(),
                usage: SessionUsage::default(),
                files_changed: FilesChanged::default(),
            });
            socket
                .send(Message::Text(serde_json::to_string(&end).unwrap().into()))
                .await?;
            socket.close().await?;
            return Ok(());
        }
    }
    Ok(())
}

async fn start_mock_harness() -> (String, SharedState, tokio::task::JoinHandle<()>) {
    let state: SharedState = Arc::new(Mutex::new(MockHarnessState::default()));
    let app = Router::new()
        .route("/stream", get(stream_handler))
        .with_state(state.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    tokio::time::sleep(Duration::from_millis(10)).await;

    (url, state, handle)
}

#[tokio::test]
async fn driver_bootstraps_super_agent_session_with_profile_payload() {
    let (harness_url, state, _h) = start_mock_harness().await;

    let client = HarnessClient::new(harness_url);
    let cfg = HarnessSuperAgentConfig::new("http://localhost:4001");
    let driver = HarnessSuperAgentDriver::new(client, cfg);

    let profile = SuperAgentProfile::ceo_default();
    let session = driver
        .start(&profile, "Acme", "org-1", "jwt-xyz", "list projects for me")
        .await
        .expect("driver started session");

    assert_eq!(session.session_id, "sess-test-1");

    // Drain events — should see text_delta then assistant_message_end.
    let mut rx = session.events;
    let mut saw_text = false;
    let mut saw_end = false;
    while let Some(msg) = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .ok()
        .flatten()
    {
        match msg {
            OutboundMessage::TextDelta(d) => {
                assert_eq!(d.text, "hello from harness");
                saw_text = true;
            }
            OutboundMessage::AssistantMessageEnd(e) => {
                assert_eq!(e.stop_reason, "end_turn");
                saw_end = true;
            }
            _ => {}
        }
    }
    assert!(saw_text, "driver should forward text deltas");
    assert!(saw_end, "driver should forward assistant_message_end");

    // Verify what the driver shipped to the harness.
    let captured = state.lock().await;
    let init = captured.received_init.as_ref().expect("session_init captured");
    assert!(init
        .system_prompt
        .as_deref()
        .unwrap_or("")
        .contains("Acme"));
    let tools = init.installed_tools.as_ref().expect("installed_tools present");
    assert_eq!(tools.len(), profile.tool_manifest.len());
    // Tool endpoints must point at the server base URL passed to the config.
    for tool in tools {
        assert!(
            tool.endpoint.starts_with("http://localhost:4001/api/super_agent/tools/"),
            "endpoint {} should be dispatcher URL",
            tool.endpoint
        );
    }
    let classifier = init
        .intent_classifier
        .as_ref()
        .expect("intent_classifier present");
    assert!(!classifier.tier1_domains.is_empty());
    assert_eq!(classifier.tool_domains.len(), profile.tool_manifest.len());

    assert_eq!(
        captured.received_user_message.as_deref(),
        Some("list projects for me"),
        "user message must be forwarded after session_ready"
    );
}

#[tokio::test]
async fn driver_surfaces_harness_init_rejection() {
    // Variant mock that replies with `error` instead of `session_ready`.
    async fn reject_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
        ws.on_upgrade(|mut socket| async move {
            // Wait for session_init then reject.
            while let Some(Ok(frame)) = socket.next().await {
                if let Message::Text(_) = frame {
                    let err = OutboundMessage::Error(aura_protocol::ErrorMsg {
                        code: "invalid_workspace".into(),
                        message: "nope".into(),
                        recoverable: false,
                    });
                    socket
                        .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
                        .await
                        .ok();
                    socket.close().await.ok();
                    return;
                }
            }
        })
    }

    let app = Router::new().route("/stream", get(reject_handler));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");
    let _h = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    tokio::time::sleep(Duration::from_millis(10)).await;

    let driver = HarnessSuperAgentDriver::new(
        HarnessClient::new(url),
        HarnessSuperAgentConfig::new("http://localhost:4001"),
    );
    let result = driver
        .start(
            &SuperAgentProfile::ceo_default(),
            "Acme",
            "org-1",
            "jwt",
            "hi",
        )
        .await;

    match result {
        Err(aura_os_server::HarnessSuperAgentError::InitRejected { code, message }) => {
            assert_eq!(code, "invalid_workspace");
            assert_eq!(message, "nope");
        }
        other => panic!("expected InitRejected, got {other:?}"),
    }
}
