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
mod inspect;
mod screencast;
mod session_loop;

pub use backend::{probe_browser_runtime, CdpBackend};
pub use config::CdpBackendConfig;

use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::target::{
    CreateBrowserContextParams, CreateTargetParams,
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::debug;
use url::Url;

use crate::backend::{BrowserBackend, BrowserExecutableStatus};
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
    fn browser_executable_status(&self) -> BrowserExecutableStatus {
        self.executable_status()
    }

    async fn set_browser_executable_path(
        &self,
        path: Option<std::path::PathBuf>,
    ) -> Result<BrowserExecutableStatus, Error> {
        self.set_executable_path(path).await
    }

    async fn start_session(
        &self,
        id: SessionId,
        opts: SpawnOptions,
        initial_url: Option<Url>,
        events: mpsc::Sender<ServerEvent>,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let browser = self.browser().await?;

        let browser_context_id = if let Some(proxy_server) = opts.proxy_server.as_ref() {
            let mut context = CreateBrowserContextParams::builder()
                .dispose_on_detach(true)
                .proxy_server(proxy_server);
            if let Some(bypass_list) = opts.proxy_bypass_list.as_ref() {
                context = context.proxy_bypass_list(bypass_list);
            }
            Some(
                browser
                    .create_browser_context(context.build())
                    .await
                    .map_err(|e| Error::backend("create_browser_context", e.to_string()))?,
            )
        } else {
            None
        };

        // Always create the page on `about:blank` and defer the real
        // navigation into the session loop. `browser.new_page(url)`
        // kicks the initial navigation off synchronously, which races
        // ahead of our CDP event subscriptions in `run_session_loop`
        // -- we'd miss `Network.requestWillBeSent` / `responseReceived`
        // / `loadingFailed` for the first hit and never paint the
        // themed error overlay on a bad initial URL (issue surfaced as
        // "first nav shows Chromium's native error page, refresh shows
        // ours"). `about:blank` is special-cased by Chromium and
        // produces no main-frame Network events, so missing those is
        // a no-op.
        let target = match browser_context_id.as_ref() {
            Some(context_id) => CreateTargetParams::builder()
                .url("about:blank")
                .browser_context_id(context_id.clone())
                .build()
                .map_err(|e| Error::backend("new_page", e))?,
            None => CreateTargetParams::new("about:blank"),
        };
        let page = match browser.new_page(target).await {
            Ok(page) => page,
            Err(error) => {
                if let Some(context_id) = browser_context_id {
                    let _ = browser.dispose_browser_context(context_id).await;
                }
                return Err(Error::backend("new_page", error.to_string()));
            }
        };

        if let Err(error) = set_viewport(&page, opts.width, opts.height).await {
            let _ = page.close().await;
            if let Some(context_id) = browser_context_id {
                let _ = browser.dispose_browser_context(context_id).await;
            }
            return Err(error);
        }

        let (tx, rx) = mpsc::channel(DISPATCH_CHANNEL_CAP);
        let quality = opts.frame_quality.unwrap_or(75) as i64;

        let task = tokio::spawn(async move {
            run_session_loop(SessionLoopCtx {
                id,
                page,
                events,
                commands: rx,
                cancel,
                quality,
                width: opts.width,
                height: opts.height,
                initial_url,
            })
            .await;
            if let Some(context_id) = browser_context_id {
                if let Err(error) = browser.dispose_browser_context(context_id).await {
                    debug!(%id, %error, "failed to dispose browser proxy context");
                }
            }
        });

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
