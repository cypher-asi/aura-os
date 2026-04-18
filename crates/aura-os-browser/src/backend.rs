//! Pluggable backend trait for the actual browser engine.
//!
//! The production backend (CDP + headless Chromium, powered by
//! `chromiumoxide`) will implement [`BrowserBackend`] in a follow-up.
//! For now we ship [`StubBackend`] so the rest of the stack — REST
//! endpoints, WebSocket plumbing, settings file, resolver — can be
//! exercised end-to-end without pulling in Chrome.

use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::info;
use url::Url;

use crate::config::SpawnOptions;
use crate::error::Error;
use crate::protocol::{ClientMsg, ServerEvent};
use crate::session::SessionId;

/// Low-level control surface for a browser engine.
///
/// Implementations drive a headless page target, produce [`ServerEvent`]s
/// on a channel, and react to incoming [`ClientMsg`] messages from the
/// web UI. The [`BrowserManager`](crate::BrowserManager) owns the trait
/// object and handles the session registry, settings, and resolver logic
/// around it.
#[async_trait]
pub trait BrowserBackend: Send + Sync + 'static {
    /// Start a new session. The backend must push [`ServerEvent`]s into
    /// the returned channel and honour the cancellation token.
    async fn start_session(
        &self,
        id: SessionId,
        opts: SpawnOptions,
        initial_url: Option<Url>,
        events: mpsc::Sender<ServerEvent>,
        cancel: CancellationToken,
    ) -> Result<(), Error>;

    /// Forward a [`ClientMsg`] to the live session.
    async fn dispatch(&self, id: SessionId, msg: ClientMsg) -> Result<(), Error>;

    /// Acknowledge a rendered frame. No-op for backends that don't implement
    /// a screencast.
    async fn ack_frame(&self, id: SessionId, seq: u32) -> Result<(), Error>;

    /// Stop a session. Must be idempotent.
    async fn stop_session(&self, id: SessionId) -> Result<(), Error>;
}

/// Backend used by default. Accepts sessions but never produces frames —
/// useful for tests and for the initial code-ship before the Chromium
/// backend lands. Navigation / input calls return
/// [`Error::NotSupported`].
#[derive(Debug, Default, Clone)]
pub struct StubBackend;

#[async_trait]
impl BrowserBackend for StubBackend {
    async fn start_session(
        &self,
        id: SessionId,
        _opts: SpawnOptions,
        initial_url: Option<Url>,
        _events: mpsc::Sender<ServerEvent>,
        _cancel: CancellationToken,
    ) -> Result<(), Error> {
        info!(
            %id,
            initial_url = initial_url.as_ref().map(|u| u.as_str()),
            "stub browser backend accepted session (no rendering)"
        );
        Ok(())
    }

    async fn dispatch(&self, _id: SessionId, _msg: ClientMsg) -> Result<(), Error> {
        Err(Error::NotSupported(
            "ClientMsg dispatch requires a Chromium backend",
        ))
    }

    async fn ack_frame(&self, _id: SessionId, _seq: u32) -> Result<(), Error> {
        Ok(())
    }

    async fn stop_session(&self, _id: SessionId) -> Result<(), Error> {
        Ok(())
    }
}
