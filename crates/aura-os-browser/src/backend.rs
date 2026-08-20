//! Pluggable backend trait for the actual browser engine.
//!
//! Two implementations ship today:
//! - [`StubBackend`] (default) — accepts sessions but never produces
//!   frames. Useful for tests and environments without Chromium.
//! - [`crate::CdpBackend`] (behind the `cdp` cargo feature) — real
//!   headless Chromium via `chromiumoxide`.
//!
//! Wire the backend into the [`crate::BrowserManager`] via
//! [`BrowserManager::with_backend`](crate::BrowserManager::with_backend).

use std::path::PathBuf;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::info;
use url::Url;

use crate::config::SpawnOptions;
use crate::error::Error;
use crate::protocol::{ClientMsg, ServerEvent};
use crate::session::SessionId;

/// Where the browser executable currently in use came from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserExecutableSource {
    /// A path saved from AURA's desktop settings.
    SavedSetting,
    /// The process-level `BROWSER_EXECUTABLE_PATH` environment variable.
    ProcessEnvironment,
    /// The persisted Windows user environment, read directly from the registry.
    UserEnvironment,
    /// A browser found in the registry or a standard install location.
    AutomaticDiscovery,
    /// No supported browser executable could be found.
    #[default]
    NotFound,
    /// The active backend does not launch a local browser.
    Unsupported,
}

/// User-facing snapshot of local browser executable resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrowserExecutableStatus {
    /// The executable path AURA will try to launch, when one is resolved.
    pub resolved_path: Option<PathBuf>,
    /// The source that produced `resolved_path`.
    pub source: BrowserExecutableSource,
    /// Whether the resolved path currently points to a file.
    pub available: bool,
}

impl BrowserExecutableStatus {
    fn unsupported() -> Self {
        Self {
            resolved_path: None,
            source: BrowserExecutableSource::Unsupported,
            available: false,
        }
    }
}

/// Low-level control surface for a browser engine.
///
/// Implementations drive a headless page target, produce [`ServerEvent`]s
/// on a channel, and react to incoming [`ClientMsg`] messages from the
/// web UI. The [`BrowserManager`](crate::BrowserManager) owns the trait
/// object and handles the session registry, settings, and resolver logic
/// around it.
#[async_trait]
pub trait BrowserBackend: Send + Sync + 'static {
    /// Report how the backend resolved its local browser executable.
    fn browser_executable_status(&self) -> BrowserExecutableStatus {
        BrowserExecutableStatus::unsupported()
    }

    /// Override the browser executable used for the next session.
    ///
    /// Backends that do not launch a local browser leave this unsupported.
    async fn set_browser_executable_path(
        &self,
        _path: Option<PathBuf>,
    ) -> Result<BrowserExecutableStatus, Error> {
        Err(Error::NotSupported(
            "configuring a browser executable requires a Chromium backend",
        ))
    }

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
