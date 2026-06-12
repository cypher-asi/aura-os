use std::sync::Arc;

use async_trait::async_trait;

use crate::error::ChannelError;
use crate::inbound::InboundHandler;
use crate::kind::ChannelKind;

/// A bidirectional bridge between a remote agent and an external chat
/// platform.
///
/// Implementors own the platform-specific transport (HTTP long-poll,
/// websocket, etc.). No implementors exist yet — this phase only defines
/// the contract; the transport loop in [`ChatConnector::run`] is delivered
/// in a later phase.
#[async_trait]
pub trait ChatConnector: Send + Sync {
    /// The platform this connector speaks to.
    fn kind(&self) -> ChannelKind;

    /// Send a plain-text message to `chat_ref` (a platform-native chat id).
    async fn send_text(&self, chat_ref: &str, text: &str) -> Result<(), ChannelError>;

    /// Emit a "typing…" indicator to `chat_ref`, if the platform supports
    /// one. Implementations should treat this as best-effort.
    async fn send_typing(&self, chat_ref: &str) -> Result<(), ChannelError>;

    /// Drive the connector's inbound transport loop until cancellation.
    ///
    /// This is the long-poll / event stream that pulls inbound messages off
    /// the platform, normalizes them, and forwards each to `handler` via
    /// [`InboundHandler::on_message`]. Takes `Arc<Self>` so the loop can hand
    /// owned clones to spawned tasks. Implementations should be resilient to
    /// transient transport errors and keep polling rather than returning.
    async fn run(self: Arc<Self>, handler: Arc<dyn InboundHandler>) -> Result<(), ChannelError>;
}
