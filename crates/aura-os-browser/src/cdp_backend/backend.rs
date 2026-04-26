//! Long-lived [`CdpBackend`] handle plus the shared [`Browser`] launcher
//! and idle-shutdown logic.
//!
//! The session-loop / per-session bookkeeping lives in
//! [`super::session_loop`]; this module owns the pieces that survive
//! across sessions.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chromiumoxide::{Browser, BrowserConfig as ChromiumBrowserConfig};
use dashmap::DashMap;
use futures_util::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::error::Error;
use crate::session::SessionId;

use super::command::SessionCommand;
use super::config::{default_profile_dir, CdpBackendConfig};

/// Per-session state stored on the backend: the command sender (used by
/// `dispatch` / `ack_frame` / `stop_session`) and a join handle so we can
/// await the loop on shutdown.
pub(super) struct SessionState {
    pub(super) tx: mpsc::Sender<SessionCommand>,
    pub(super) task: JoinHandle<()>,
}

/// CDP-backed [`crate::backend::BrowserBackend`]. Cheap to `Arc`; clone to
/// share across the [`crate::manager::BrowserManager`] and the per-session
/// tasks.
pub struct CdpBackend {
    pub(super) inner: Arc<CdpBackendInner>,
}

pub(super) struct CdpBackendInner {
    pub(super) config: CdpBackendConfig,
    pub(super) launcher: Mutex<Option<Arc<Browser>>>,
    pub(super) sessions: DashMap<SessionId, SessionState>,
    /// Monotonic generation counter used to cancel stale idle-shutdown
    /// timers when a new session starts during the grace period.
    pub(super) shutdown_gen: AtomicU64,
}

impl std::fmt::Debug for CdpBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CdpBackend")
            .field("sessions", &self.inner.sessions.len())
            .finish()
    }
}

impl CdpBackend {
    /// Build a `CdpBackend` with default configuration.
    pub fn new() -> Self {
        Self::with_config(CdpBackendConfig::default())
    }

    /// Build a `CdpBackend` with the supplied configuration.
    pub fn with_config(config: CdpBackendConfig) -> Self {
        Self {
            inner: Arc::new(CdpBackendInner {
                config,
                launcher: Mutex::new(None),
                sessions: DashMap::new(),
                shutdown_gen: AtomicU64::new(0),
            }),
        }
    }

    /// Return the (lazily launched) shared headless Chromium handle. The
    /// process is spawned on first call and reused across sessions.
    pub(super) async fn browser(&self) -> Result<Arc<Browser>, Error> {
        let mut guard = self.inner.launcher.lock().await;
        // Bump the generation so any pending idle-shutdown timer aborts.
        self.inner.shutdown_gen.fetch_add(1, Ordering::SeqCst);
        if guard.is_none() {
            let browser = launch_browser(&self.inner.config).await?;
            *guard = Some(Arc::new(browser));
        }
        match guard.as_ref() {
            Some(b) => Ok(Arc::clone(b)),
            None => Err(Error::backend(
                "chromium_launch",
                "browser failed to initialise",
            )),
        }
    }

    /// Spawn an async task that waits for the idle grace period and, if
    /// no session has appeared in the meantime, shuts the shared browser
    /// down. Called from `stop_session` after removing the session.
    pub(super) fn schedule_idle_shutdown(&self) {
        let Some(grace) = self.inner.config.idle_shutdown else {
            return;
        };
        if !self.inner.sessions.is_empty() {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let gen = inner.shutdown_gen.fetch_add(1, Ordering::SeqCst) + 1;
        tokio::spawn(idle_shutdown_task(inner, gen, grace));
    }
}

impl Default for CdpBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for CdpBackend {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

/// Build a Chromium config from `cfg`, launch headless Chromium, and
/// spawn the chromiumoxide event-handler driver task.
async fn launch_browser(cfg: &CdpBackendConfig) -> Result<Browser, Error> {
    let mut builder = ChromiumBrowserConfig::builder();
    if let Some(path) = &cfg.executable_path {
        builder = builder.chrome_executable(path);
    }
    let user_data_dir = cfg
        .user_data_dir
        .clone()
        .unwrap_or_else(default_profile_dir);
    builder = builder.user_data_dir(&user_data_dir);
    if let Some(proxy) = &cfg.proxy_server {
        builder = builder.arg(format!("--proxy-server={proxy}"));
    }
    if cfg.disable_sandbox {
        builder = builder.no_sandbox();
    }
    let config = builder
        .build()
        .map_err(|e| Error::backend("chromium_config", e.to_string()))?;
    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| Error::backend("chromium_launch", e.to_string()))?;
    tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if let Err(err) = event {
                warn!(%err, "chromium handler error");
            }
        }
    });
    info!(profile_dir = %user_data_dir.display(), "headless Chromium launched");
    Ok(browser)
}

/// Body of the spawned timer that closes Chromium after the idle grace
/// period if and only if no session arrived in the meantime.
async fn idle_shutdown_task(inner: Arc<CdpBackendInner>, gen: u64, grace: std::time::Duration) {
    sleep(grace).await;
    if inner.shutdown_gen.load(Ordering::SeqCst) != gen {
        return;
    }
    if !inner.sessions.is_empty() {
        return;
    }
    let mut guard = inner.launcher.lock().await;
    let Some(browser_arc) = guard.take() else {
        return;
    };
    // Best-effort: if other Arcs still live, skip the close so we don't
    // tear the process out from under a pending task.
    match Arc::try_unwrap(browser_arc) {
        Ok(mut browser) => {
            if let Err(err) = browser.close().await {
                debug!(%err, "browser.close failed during idle shutdown");
            }
            let _ = browser.wait().await;
            info!("headless Chromium shut down after idle grace period");
        }
        Err(arc) => {
            // Put it back; a session task is still holding a ref.
            *guard = Some(arc);
        }
    }
}
