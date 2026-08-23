//! Long-lived [`CdpBackend`] handle plus the shared [`Browser`] launcher
//! and idle-shutdown logic.
//!
//! The session-loop / per-session bookkeeping lives in
//! [`super::session_loop`]; this module owns the pieces that survive
//! across sessions.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use chromiumoxide::{Browser, BrowserConfig as ChromiumBrowserConfig};
use dashmap::DashMap;
use futures_util::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::backend::BrowserExecutableStatus;
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
    pub(super) config: RwLock<CdpBackendConfig>,
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
                config: RwLock::new(config),
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
            let config = self
                .inner
                .config
                .read()
                .map_err(|_| Error::backend("chromium_config", "configuration lock poisoned"))?
                .clone();
            let browser = launch_browser(&config).await?;
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
        let Some(grace) = self
            .inner
            .config
            .read()
            .ok()
            .and_then(|config| config.idle_shutdown)
        else {
            return;
        };
        if !self.inner.sessions.is_empty() {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let gen = inner.shutdown_gen.fetch_add(1, Ordering::SeqCst) + 1;
        tokio::spawn(idle_shutdown_task(inner, gen, grace));
    }

    pub(super) fn executable_status(&self) -> BrowserExecutableStatus {
        let Ok(config) = self.inner.config.read() else {
            return BrowserExecutableStatus {
                resolved_path: None,
                source: crate::BrowserExecutableSource::NotFound,
                available: false,
            };
        };
        BrowserExecutableStatus {
            resolved_path: config.executable_path.clone(),
            source: config.executable_source,
            available: config
                .executable_path
                .as_ref()
                .is_some_and(|path| path.is_file()),
        }
    }

    pub(super) async fn set_executable_path(
        &self,
        path: Option<PathBuf>,
    ) -> Result<BrowserExecutableStatus, Error> {
        if let Some(path) = path.as_ref() {
            if !path.is_file() {
                return Err(Error::invalid_input(
                    "executable_path",
                    format!(
                        "browser executable does not exist or is not a file: {}",
                        path.display()
                    ),
                ));
            }
        }
        if !self.inner.sessions.is_empty() {
            return Err(Error::invalid_input(
                "executable_path",
                "close active Preview sessions before changing the browser executable",
            ));
        }

        let mut launcher = self.inner.launcher.lock().await;
        if let Some(browser_arc) = launcher.take() {
            match Arc::try_unwrap(browser_arc) {
                Ok(mut browser) => {
                    if let Err(error) = browser.close().await {
                        debug!(%error, "browser.close failed while changing executable");
                    }
                    let _ = browser.wait().await;
                }
                Err(browser_arc) => {
                    *launcher = Some(browser_arc);
                    return Err(Error::invalid_input(
                        "executable_path",
                        "the current Preview browser is still shutting down; try again in a moment",
                    ));
                }
            }
        }
        self.inner
            .config
            .write()
            .map_err(|_| Error::backend("chromium_config", "configuration lock poisoned"))?
            .set_runtime_executable(path);
        drop(launcher);
        Ok(self.executable_status())
    }
}

/// Launch Chromium, open and close a blank page over CDP, then shut the
/// process down. Hosted deployments use this as a startup preflight so a
/// missing or unusable runtime fails the deploy instead of surfacing only
/// after a user opens Preview.
pub async fn probe_browser_runtime(config: &CdpBackendConfig) -> Result<(), Error> {
    let mut browser = launch_browser(config).await?;
    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|error| Error::backend("chromium_probe", error.to_string()))?;
    page.close()
        .await
        .map_err(|error| Error::backend("chromium_probe", error.to_string()))?;
    browser
        .close()
        .await
        .map_err(|error| Error::backend("chromium_probe", error.to_string()))?;
    browser
        .wait()
        .await
        .map_err(|error| Error::backend("chromium_probe", error.to_string()))?;
    Ok(())
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
        if !path.is_file() {
            return Err(Error::backend(
                "chromium_launch",
                format!(
                    "configured browser executable does not exist or is not a file: {}",
                    path.display()
                ),
            ));
        }
        builder = builder.chrome_executable(path);
    }
    #[cfg(windows)]
    if cfg.executable_path.is_none() {
        return Err(Error::backend(
            "chromium_launch",
            "No supported browser executable was found after checking AURA settings, the process and persisted user BROWSER_EXECUTABLE_PATH values, Windows App Paths, registry Program Files locations, and standard Edge/Chrome/Chromium install paths (including C:\\Program Files and C:\\Program Files (x86)).",
        ));
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
    let launch_target = cfg
        .executable_path
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "automatic browser discovery".to_string());
    let (browser, mut handler) = Browser::launch(config).await.map_err(|e| {
        Error::backend(
            "chromium_launch",
            format!("{e} (launch target: {launch_target})"),
        )
    })?;
    tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if let Err(err) = event {
                warn!(%err, "chromium handler error");
            }
        }
    });
    info!(
        profile_dir = %user_data_dir.display(),
        executable = %launch_target,
        "headless Chromium launched"
    );
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BrowserExecutableSource;

    #[tokio::test]
    async fn executable_override_applies_without_restarting_backend() {
        let root = tempfile::tempdir().expect("temp browser executable");
        let executable = root.path().join("msedge.exe");
        std::fs::write(&executable, []).expect("create executable fixture");
        let backend = CdpBackend::new();

        let status = backend
            .set_executable_path(Some(executable.clone()))
            .await
            .expect("apply browser executable");

        assert_eq!(status.resolved_path, Some(executable));
        assert_eq!(status.source, BrowserExecutableSource::SavedSetting);
        assert!(status.available);
    }

    #[tokio::test]
    async fn executable_override_rejects_missing_files() {
        let missing = std::env::temp_dir().join("aura-missing-msedge.exe");
        let backend = CdpBackend::new();

        let error = backend
            .set_executable_path(Some(missing))
            .await
            .expect_err("missing executable must fail validation");

        assert!(error.to_string().contains("does not exist"));
    }
}
