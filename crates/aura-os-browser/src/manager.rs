//! Browser session registry + façade over the backend, settings store,
//! and resolver.

use std::sync::Arc;

use aura_os_core::ProjectId;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};
use url::Url;

use crate::backend::{BrowserBackend, StubBackend};
use crate::config::{BrowserConfig, ResolveOptions, SpawnOptions};
use crate::error::Error;
use crate::protocol::ClientMsg;
use crate::session::resolver::{resolve_initial_url, ResolvedInitialUrl};
use crate::session::settings::{
    DetectedUrl, ProjectBrowserSettings, SettingsPatch, SettingsStore,
};
use crate::session::{SessionHandle, SessionId};

/// Channel capacity for per-session [`ServerEvent`] streams.
const EVENT_CHANNEL_CAP: usize = 8;

/// Registry entry for a live session. Clone-able for internal use only.
struct RegistryEntry {
    project_id: Option<ProjectId>,
    cancel: CancellationToken,
    created_at: DateTime<Utc>,
    initial_url: Option<Url>,
}

/// Lightweight snapshot of a live session (safe to serialize to the UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// Session identifier.
    pub id: String,
    /// Project the session belongs to, if any.
    pub project_id: Option<String>,
    /// Initial URL the session was spawned at, if known.
    pub initial_url: Option<String>,
    /// RFC3339 creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Orchestrates sessions, the settings store, and the initial-URL resolver.
///
/// `BrowserManager` is cheap to `Arc<Clone>`; put it in `AppState` and
/// hand it to both the REST and WS handlers.
pub struct BrowserManager {
    config: BrowserConfig,
    settings: SettingsStore,
    sessions: DashMap<SessionId, RegistryEntry>,
    backend: Arc<dyn BrowserBackend>,
}

impl std::fmt::Debug for BrowserManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BrowserManager")
            .field("config", &self.config)
            .field("sessions", &self.sessions.len())
            .finish()
    }
}

impl BrowserManager {
    /// Build a manager with the default [`StubBackend`]. The production
    /// backend is wired via [`BrowserManager::with_backend`].
    pub fn new(config: BrowserConfig) -> Self {
        let settings = SettingsStore::from_config(&config);
        Self {
            config,
            settings,
            sessions: DashMap::new(),
            backend: Arc::new(StubBackend),
        }
    }

    /// Build a manager with an explicit backend.
    pub fn with_backend(config: BrowserConfig, backend: Arc<dyn BrowserBackend>) -> Self {
        let settings = SettingsStore::from_config(&config);
        Self {
            config,
            settings,
            sessions: DashMap::new(),
            backend,
        }
    }

    /// Return the shared settings store.
    pub fn settings(&self) -> &SettingsStore {
        &self.settings
    }

    /// Return the active configuration.
    pub fn config(&self) -> &BrowserConfig {
        &self.config
    }

    /// Spawn a new session.
    ///
    /// When `opts.initial_url` is `None` and a `project_id` is provided,
    /// the initial URL is resolved via
    /// [`crate::session::resolver::resolve_initial_url`].
    pub async fn spawn(&self, mut opts: SpawnOptions) -> Result<SessionHandle, Error> {
        if self.sessions.len() >= self.config.max_sessions {
            return Err(Error::CapacityExceeded(format!(
                "max {} concurrent browser sessions",
                self.config.max_sessions
            )));
        }
        validate_spawn_options(&opts)?;

        let ResolvedInitialUrl {
            url: resolved_url,
            focus_address_bar,
        } = match opts.initial_url.clone() {
            Some(explicit) => ResolvedInitialUrl {
                url: Some(explicit),
                focus_address_bar: false,
            },
            None => {
                resolve_initial_url(
                    &self.settings,
                    opts.project_id.as_ref(),
                    &self.config,
                    &ResolveOptions {
                        allow_active_probe: opts.project_id.is_some(),
                    },
                )
                .await
            }
        };
        opts.initial_url = resolved_url.clone();

        let id = SessionId::new();
        let cancel = CancellationToken::new();
        let (tx, rx) = mpsc::channel(EVENT_CHANNEL_CAP);
        self.backend
            .start_session(id, opts.clone(), resolved_url.clone(), tx, cancel.clone())
            .await?;

        self.sessions.insert(
            id,
            RegistryEntry {
                project_id: opts.project_id,
                cancel: cancel.clone(),
                created_at: Utc::now(),
                initial_url: resolved_url.clone(),
            },
        );
        info!(%id, "browser session spawned");

        Ok(SessionHandle {
            id,
            initial_url: resolved_url,
            focus_address_bar,
            events: rx,
            cancel,
        })
    }

    /// List live sessions.
    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions
            .iter()
            .map(|entry| SessionInfo {
                id: entry.key().to_string(),
                project_id: entry.value().project_id.map(|p| p.to_string()),
                initial_url: entry.value().initial_url.as_ref().map(|u| u.to_string()),
                created_at: entry.value().created_at,
            })
            .collect()
    }

    /// Kill a session. Idempotent.
    pub async fn kill(&self, id: SessionId) -> Result<(), Error> {
        let removed = self.sessions.remove(&id);
        let Some((_, entry)) = removed else {
            debug!(%id, "kill on unknown session is a no-op");
            return Ok(());
        };
        entry.cancel.cancel();
        self.backend.stop_session(id).await?;
        info!(%id, "browser session killed");
        Ok(())
    }

    /// Forward a [`ClientMsg`] to a live session.
    pub async fn dispatch(&self, id: SessionId, msg: ClientMsg) -> Result<(), Error> {
        if !self.sessions.contains_key(&id) {
            return Err(Error::SessionNotFound(id.to_string()));
        }
        self.backend.dispatch(id, msg).await
    }

    /// Acknowledge a rendered frame.
    pub async fn ack_frame(&self, id: SessionId, seq: u32) -> Result<(), Error> {
        self.backend.ack_frame(id, seq).await
    }

    /// Read a project's persisted settings.
    pub async fn get_project_settings(&self, id: &ProjectId) -> ProjectBrowserSettings {
        self.settings.read_project(id).await
    }

    /// Apply a [`SettingsPatch`] to a project's settings.
    pub async fn update_project_settings(
        &self,
        id: &ProjectId,
        patch: SettingsPatch,
    ) -> Result<ProjectBrowserSettings, Error> {
        self.settings.patch_project(id, patch).await
    }

    /// Run an active probe and persist any discovered URLs.
    pub async fn run_detect(&self, id: Option<&ProjectId>) -> Result<Vec<DetectedUrl>, Error> {
        let found = crate::session::probe::probe_dev_ports(&self.config).await;
        for entry in &found {
            if let Err(err) = self.settings.record_detected(id, entry.clone()).await {
                warn!(%err, "failed to persist probed URL; continuing");
            }
        }
        Ok(found)
    }

    /// Record a visit to the given URL (updates `last_url` + history).
    pub async fn record_visit(
        &self,
        id: Option<&ProjectId>,
        url: Url,
        title: Option<String>,
    ) -> Result<(), Error> {
        self.settings.record_visit(id, url, title).await
    }
}

fn validate_spawn_options(opts: &SpawnOptions) -> Result<(), Error> {
    if opts.width < 64 || opts.width > 4096 {
        return Err(Error::invalid_input(
            "width",
            format!("must be within [64, 4096], got {}", opts.width),
        ));
    }
    if opts.height < 64 || opts.height > 4096 {
        return Err(Error::invalid_input(
            "height",
            format!("must be within [64, 4096], got {}", opts.height),
        ));
    }
    if let Some(url) = opts.initial_url.as_ref() {
        validate_url(url)?;
    }
    if let Some(quality) = opts.frame_quality {
        if quality < 1 {
            return Err(Error::invalid_input(
                "frame_quality",
                "must be >= 1".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_url(url: &Url) -> Result<(), Error> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(Error::invalid_input(
            "initial_url",
            format!("scheme must be http(s), got `{}`", url.scheme()),
        ));
    }
    if url.as_str().len() > 2048 {
        return Err(Error::invalid_input(
            "initial_url",
            "URL must be <= 2048 bytes".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_config(dir: &tempfile::TempDir) -> BrowserConfig {
        BrowserConfig::default().with_settings_root(dir.path().to_path_buf())
    }

    #[tokio::test]
    async fn spawn_with_explicit_url_bypasses_resolver() {
        let dir = tempdir().unwrap();
        let manager = BrowserManager::new(test_config(&dir));
        let url = Url::parse("http://localhost:5173/").unwrap();
        let mut opts = SpawnOptions::new(1280, 800);
        opts.initial_url = Some(url.clone());
        let handle = manager.spawn(opts).await.unwrap();
        assert_eq!(handle.initial_url, Some(url));
        assert!(!handle.focus_address_bar);
    }

    #[tokio::test]
    async fn spawn_without_project_falls_back_to_blank() {
        let dir = tempdir().unwrap();
        let manager = BrowserManager::new(test_config(&dir));
        let handle = manager.spawn(SpawnOptions::new(1280, 800)).await.unwrap();
        assert_eq!(handle.initial_url, None);
        assert!(handle.focus_address_bar);
    }

    #[tokio::test]
    async fn spawn_rejects_invalid_dimensions() {
        let dir = tempdir().unwrap();
        let manager = BrowserManager::new(test_config(&dir));
        let err = manager
            .spawn(SpawnOptions::new(10, 800))
            .await
            .unwrap_err();
        match err {
            Error::InvalidInput { field, .. } => assert_eq!(field, "width"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[tokio::test]
    async fn spawn_rejects_non_http_scheme() {
        let dir = tempdir().unwrap();
        let manager = BrowserManager::new(test_config(&dir));
        let mut opts = SpawnOptions::new(1280, 800);
        opts.initial_url = Some(Url::parse("file:///etc/passwd").unwrap());
        let err = manager.spawn(opts).await.unwrap_err();
        match err {
            Error::InvalidInput { field, .. } => assert_eq!(field, "initial_url"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[tokio::test]
    async fn kill_is_idempotent() {
        let dir = tempdir().unwrap();
        let manager = BrowserManager::new(test_config(&dir));
        manager.kill(SessionId::new()).await.unwrap();
    }

    #[tokio::test]
    async fn spawn_then_list_then_kill() {
        let dir = tempdir().unwrap();
        let manager = BrowserManager::new(test_config(&dir));
        let handle = manager.spawn(SpawnOptions::new(1280, 800)).await.unwrap();
        let id = handle.id;
        drop(handle);
        assert_eq!(manager.list().len(), 1);
        manager.kill(id).await.unwrap();
        assert!(manager.list().is_empty());
    }

    #[tokio::test]
    async fn capacity_exceeded_returns_error() {
        let dir = tempdir().unwrap();
        let mut config = test_config(&dir);
        config.max_sessions = 1;
        let manager = BrowserManager::new(config);
        let _first = manager.spawn(SpawnOptions::new(1280, 800)).await.unwrap();
        let err = manager.spawn(SpawnOptions::new(1280, 800)).await.unwrap_err();
        match err {
            Error::CapacityExceeded(_) => {}
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
