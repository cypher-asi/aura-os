//! Drive a super-agent whose LLM loop runs inside the aura-harness node.
//!
//! Phase 3 of the super-agent / harness unification: given a
//! [`SuperAgentProfile`] plus a user JWT and message, this driver:
//!
//! 1. opens the `/stream` WebSocket on an aura-harness node via the
//!    phase-1 [`HarnessClient`],
//! 2. sends a [`SessionInit`](aura_protocol::SessionInit) pre-loaded
//!    with the profile's system prompt, installed tools, and intent
//!    classifier (see [`aura_os_super_agent::harness_handoff`]),
//! 3. waits for `session_ready`,
//! 4. sends the user message,
//! 5. forwards subsequent frames back to the caller via a
//!    [`tokio::sync::mpsc::Receiver`] of typed
//!    [`aura_protocol::OutboundMessage`]s.
//!
//! As of Phase 6 this driver is the sole super-agent execution
//! path; the legacy in-process `SuperAgentStream` loop has been
//! deleted and every `HostMode::Harness` super-agent chat request
//! flows through here via `dispatch_super_agent_via_harness`.

use std::time::Duration;

use aura_os_super_agent_profile::SuperAgentProfile;
use aura_protocol::{
    IntentClassifierSpec, InstalledTool, InboundMessage, OutboundMessage, SessionInit, UserMessage,
};
use futures_util::{SinkExt, StreamExt};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, warn};

use crate::harness_client::{HarnessClient, HarnessClientError};

/// Errors produced when bootstrapping or driving a harness-hosted
/// super-agent session.
#[derive(Debug, Error)]
pub enum HarnessSuperAgentError {
    #[error("harness client error: {0}")]
    Client(#[from] HarnessClientError),
    #[error("failed to serialize inbound message: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("websocket io error: {0}")]
    Ws(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("harness refused session init: {code} {message}")]
    InitRejected { code: String, message: String },
    #[error("harness stream closed before session_ready")]
    ClosedBeforeReady,
}

/// Handle to a running harness-hosted super-agent session.
///
/// Drop the handle to close the underlying websocket (spawned task
/// exits when its channel closes).
#[derive(Debug)]
pub struct HarnessSuperAgentSession {
    /// Session id returned in `session_ready`.
    pub session_id: String,
    /// Receiver of events produced by the harness agent loop for this
    /// session. Closes when the websocket closes or the forwarding
    /// task returns.
    pub events: mpsc::Receiver<OutboundMessage>,
}

/// Builder-style configuration for [`HarnessSuperAgentDriver`].
#[derive(Debug, Clone)]
pub struct HarnessSuperAgentConfig {
    /// Base URL of the aura-os-server instance this driver calls back
    /// into. Passed to
    /// [`aura_os_super_agent::harness_handoff::build_super_agent_session_init`]
    /// so each installed tool points at the local dispatcher.
    pub server_base_url: String,
    /// Optional LLM model override (forwarded to `SessionInit::model`).
    pub model: Option<String>,
    /// Buffer size for the outbound event channel. 1024 is plenty for
    /// most turns; adjust if you observe backpressure.
    pub event_buffer: usize,
}

impl HarnessSuperAgentConfig {
    #[must_use]
    pub fn new(server_base_url: impl Into<String>) -> Self {
        Self {
            server_base_url: server_base_url.into(),
            model: None,
            event_buffer: 1024,
        }
    }

    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }
}

/// Drives a super-agent session on an aura-harness node.
#[derive(Debug, Clone)]
pub struct HarnessSuperAgentDriver {
    client: HarnessClient,
    config: HarnessSuperAgentConfig,
}

impl HarnessSuperAgentDriver {
    #[must_use]
    pub fn new(client: HarnessClient, config: HarnessSuperAgentConfig) -> Self {
        Self { client, config }
    }

    /// Build a driver from the canonical `LOCAL_HARNESS_URL` +
    /// `AURA_SERVER_BASE_URL` env vars.
    pub fn from_env() -> Self {
        let server_base = std::env::var("AURA_SERVER_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:4001".to_string());
        Self::new(HarnessClient::from_env(), HarnessSuperAgentConfig::new(server_base))
    }

    /// Start a harness-hosted session for `profile`, send the user
    /// message, and return a handle whose `events` receives each
    /// outbound frame from the harness.
    ///
    /// Blocks until the harness acknowledges `session_ready`; then
    /// returns immediately and continues forwarding events in a
    /// background task.
    pub async fn start(
        &self,
        profile: &SuperAgentProfile,
        org_name: &str,
        org_id: &str,
        jwt: &str,
        user_message: &str,
    ) -> Result<HarnessSuperAgentSession, HarnessSuperAgentError> {
        let init = aura_os_super_agent::harness_handoff::build_super_agent_session_init(
            profile,
            org_name,
            org_id,
            &self.config.server_base_url,
            jwt,
            self.config.model.clone(),
        );
        self.start_with_init(init, jwt, user_message, None).await
    }

    /// Variant of [`Self::start`] that accepts a pre-built
    /// [`SessionInit`] so the caller can inject conversation history,
    /// session/agent IDs, or any other wire fields the plain
    /// profile-based builder does not populate.
    ///
    /// `jwt` is only used for the websocket upgrade; any token the
    /// harness should forward when calling domain tools must already
    /// be set on `init.token` (usually via
    /// [`aura_os_super_agent::harness_handoff::build_super_agent_session_init`]).
    ///
    /// `attachments` are passed through on the initial
    /// [`aura_protocol::UserMessage`].
    pub async fn start_with_init(
        &self,
        init: SessionInit,
        jwt: &str,
        user_message: &str,
        attachments: Option<Vec<aura_protocol::MessageAttachment>>,
    ) -> Result<HarnessSuperAgentSession, HarnessSuperAgentError> {
        debug!(
            installed_tool_count = init.installed_tools.as_ref().map(Vec::len).unwrap_or(0),
            has_classifier = init.intent_classifier.is_some(),
            has_history = init.conversation_messages.is_some(),
            "starting harness super-agent session"
        );

        let mut ws = self.client.subscribe_stream(Some(jwt)).await?;

        let init_frame = serde_json::to_string(&InboundMessage::SessionInit(Box::new(init)))?;
        ws.send(WsMessage::Text(init_frame.into())).await?;

        let session_id = wait_for_session_ready(&mut ws).await?;

        let user_frame = serde_json::to_string(&InboundMessage::UserMessage(UserMessage {
            content: user_message.to_string(),
            tool_hints: None,
            attachments,
        }))?;
        ws.send(WsMessage::Text(user_frame.into())).await?;

        let (tx, rx) = mpsc::channel(self.config.event_buffer);
        let session_id_fwd = session_id.clone();
        tokio::spawn(async move {
            forward_stream_events(ws, tx, session_id_fwd).await;
        });

        Ok(HarnessSuperAgentSession {
            session_id,
            events: rx,
        })
    }
}

async fn wait_for_session_ready<S>(ws: &mut S) -> Result<String, HarnessSuperAgentError>
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    const TIMEOUT: Duration = Duration::from_secs(30);
    let deadline = tokio::time::Instant::now() + TIMEOUT;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let next = tokio::time::timeout(remaining, ws.next()).await;
        let msg = match next {
            Ok(Some(Ok(m))) => m,
            Ok(Some(Err(e))) => return Err(e.into()),
            Ok(None) => return Err(HarnessSuperAgentError::ClosedBeforeReady),
            Err(_) => {
                return Err(HarnessSuperAgentError::InitRejected {
                    code: "timeout".into(),
                    message: "harness did not ack session_ready within 30s".into(),
                })
            }
        };
        let WsMessage::Text(text) = msg else {
            continue;
        };
        let parsed: OutboundMessage = match serde_json::from_str::<OutboundMessage>(&text) {
            Ok(v) => v,
            Err(e) => {
                warn!(err = %e, raw = %text, "skipping non-Outbound frame while waiting for session_ready");
                continue;
            }
        };
        match parsed {
            OutboundMessage::SessionReady(ready) => return Ok(ready.session_id),
            OutboundMessage::Error(err) => {
                return Err(HarnessSuperAgentError::InitRejected {
                    code: err.code,
                    message: err.message,
                });
            }
            _ => {
                // ignore any frames arriving before session_ready
            }
        }
    }
}

async fn forward_stream_events<S>(
    mut ws: S,
    tx: mpsc::Sender<OutboundMessage>,
    session_id: String,
) where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    while let Some(frame) = ws.next().await {
        let msg = match frame {
            Ok(m) => m,
            Err(e) => {
                warn!(session_id = %session_id, err = %e, "harness websocket error");
                break;
            }
        };
        let WsMessage::Text(text) = msg else {
            continue;
        };
        match serde_json::from_str::<OutboundMessage>(&text) {
            Ok(parsed) => {
                if tx.send(parsed).await.is_err() {
                    debug!(session_id = %session_id, "event receiver dropped; closing harness stream");
                    break;
                }
            }
            Err(e) => {
                warn!(session_id = %session_id, err = %e, raw = %text, "failed to parse outbound frame");
            }
        }
    }
}

/// Lightweight preview helper so callers can inspect what a session
/// init *would* contain for a given profile without opening a
/// websocket. Primarily useful for tests and debugging.
#[must_use]
pub fn preview_session_init(
    profile: &SuperAgentProfile,
    org_name: &str,
    org_id: &str,
    server_base_url: &str,
    jwt: &str,
    model: Option<String>,
) -> SessionInit {
    aura_os_super_agent::harness_handoff::build_super_agent_session_init(
        profile,
        org_name,
        org_id,
        server_base_url,
        jwt,
        model,
    )
}

/// Return the classifier spec the driver would ship for `profile`.
#[must_use]
pub fn preview_intent_classifier_spec(profile: &SuperAgentProfile) -> IntentClassifierSpec {
    aura_os_super_agent::harness_handoff::profile_to_intent_classifier_spec(profile)
}

/// Return the installed-tool list the driver would ship for `profile`.
#[must_use]
pub fn preview_installed_tools(
    profile: &SuperAgentProfile,
    server_base_url: &str,
    jwt: &str,
) -> Vec<InstalledTool> {
    aura_os_super_agent::harness_handoff::profile_to_installed_tools(profile, server_base_url, jwt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_super_agent_profile::SuperAgentProfile;

    #[test]
    fn preview_session_init_carries_classifier_and_tools() {
        let profile = SuperAgentProfile::ceo_default();
        let init = preview_session_init(
            &profile,
            "Acme",
            "org-1",
            "http://localhost:4001",
            "jwt-xyz",
            None,
        );
        let classifier = init.intent_classifier.expect("classifier");
        assert!(!classifier.tier1_domains.is_empty());
        assert!(!classifier.classifier_rules.is_empty());
        assert_eq!(
            classifier.tool_domains.len(),
            profile.tool_manifest.len(),
            "classifier tool_domains must cover every manifest entry"
        );
        assert_eq!(
            init.installed_tools.as_ref().map(Vec::len),
            Some(profile.tool_manifest.len())
        );
    }

    #[test]
    fn preview_installed_tools_uses_server_base_url() {
        let profile = SuperAgentProfile::ceo_default();
        let tools = preview_installed_tools(&profile, "http://example.test:4001/", "jwt");
        for tool in &tools {
            assert!(
                tool.endpoint.starts_with("http://example.test:4001/"),
                "endpoint should point at configured server_base_url, got {}",
                tool.endpoint
            );
            assert!(!tool.endpoint.contains("//api"));
        }
    }
}
