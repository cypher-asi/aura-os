//! Real Chromium/CDP-backed [`BrowserBackend`] implementation.
//!
//! Gated behind the `cdp` cargo feature so the base crate stays lean for
//! environments without a local Chromium/Chrome executable.
//!
//! # Architecture
//!
//! - A single long-lived [`chromiumoxide::Browser`] is launched lazily on
//!   first [`start_session`](BrowserBackend::start_session). All sessions
//!   share the same Chromium process via fresh page targets. When the
//!   last session closes, a grace-period timer optionally shuts Chromium
//!   down so the process footprint follows demand.
//! - Each session owns a per-session command channel and a task that
//!   `select!`s over:
//!   - CDP screencast frames → [`ServerEvent::Frame`]
//!   - CDP navigation events → [`ServerEvent::Nav`]
//!   - our own command channel (dispatch / ack / resize / stop)
//!   - the session cancel token
//! - Frame ack is client-driven: we do *not* ack a CDP frame until the
//!   web client has acked it over the WS. This gives real backpressure
//!   on slow networks so we don't flood the socket.
//! - On session end we fire [`ServerEvent::Exit`] on the events channel
//!   so the WebSocket handler can shut the client cleanly.
//!
//! Failure of a dispatched [`ClientMsg`] is logged but never closes the
//! session; the client can retry. Browser launch errors bubble up.
//!
//! # Module layout
//!
//! - [`config`] — [`CdpBackendConfig`] + env discovery.
//! - [`backend`] — [`CdpBackend`] handle, shared launcher, idle-shutdown.
//! - [`session_loop`] — per-session event-pump orchestration.
//! - [`handlers`] — per-event handlers and the loop's mutable state.
//! - [`input`] — apply [`ClientMsg`] inputs to the page.
//! - [`screencast`] — viewport + screencast helpers.
//! - [`command`] — internal `SessionCommand` enum.
//!
//! Public surface stays exactly the same: `CdpBackend` and
//! `CdpBackendConfig` are re-exported from this module.

mod backend;
mod command;
mod config;
mod handlers;
mod input;
mod screencast;
mod session_loop;

pub use backend::CdpBackend;
pub use config::CdpBackendConfig;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::debug;
use url::Url;

use crate::backend::BrowserBackend;
use crate::config::SpawnOptions;
use crate::error::Error;
use crate::protocol::{ClientMsg, ServerEvent};
use crate::session::SessionId;

use self::backend::SessionState;
use self::command::SessionCommand;
use self::screencast::set_viewport;
use self::session_loop::{run_session_loop, SessionLoopCtx};

/// Bounded capacity of the per-session command channel. Small enough to
/// keep memory usage tight, large enough to absorb the tiny burst of
/// commands the client sends on session start (resize + initial nav).
const DISPATCH_CHANNEL_CAP: usize = 32;

#[async_trait]
impl BrowserBackend for CdpBackend {
    async fn start_session(
        &self,
        id: SessionId,
        opts: SpawnOptions,
        initial_url: Option<Url>,
        events: mpsc::Sender<ServerEvent>,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let browser = self.browser().await?;
        let url = initial_url
            .as_ref()
            .map(|u| u.to_string())
            .unwrap_or_else(|| "about:blank".to_string());

        let page = browser
            .new_page(url.as_str())
            .await
            .map_err(|e| Error::backend("new_page", e.to_string()))?;

        set_viewport(&page, opts.width, opts.height).await?;

        let (tx, rx) = mpsc::channel(DISPATCH_CHANNEL_CAP);
        let quality = opts.frame_quality.unwrap_or(75) as i64;

        let task = tokio::spawn(run_session_loop(SessionLoopCtx {
            id,
            page,
            events,
            commands: rx,
            cancel,
            quality,
            width: opts.width,
            height: opts.height,
        }));

        self.inner.sessions.insert(id, SessionState { tx, task });
        Ok(())
    }

    async fn dispatch(&self, id: SessionId, msg: ClientMsg) -> Result<(), Error> {
        let Some(state) = self.inner.sessions.get(&id) else {
            return Err(Error::SessionNotFound(id.to_string()));
        };
        state
            .tx
            .send(SessionCommand::Client(msg))
            .await
            .map_err(|_| Error::backend("dispatch", "session task gone"))
    }

    async fn ack_frame(&self, id: SessionId, seq: u32) -> Result<(), Error> {
        let Some(state) = self.inner.sessions.get(&id) else {
            return Ok(());
        };
        let _ = state.tx.send(SessionCommand::Ack(seq)).await;
        Ok(())
    }

    async fn stop_session(&self, id: SessionId) -> Result<(), Error> {
        if let Some((_, state)) = self.inner.sessions.remove(&id) {
            let _ = state.tx.send(SessionCommand::Stop).await;
            if let Err(err) = state.task.await {
                debug!(%id, ?err, "session task join failed");
            }
        }
        self.schedule_idle_shutdown();
        Ok(())
    }
}
