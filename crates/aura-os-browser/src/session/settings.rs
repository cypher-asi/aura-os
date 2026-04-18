//! Per-project (and global) browser settings persisted to flexible, human-
//! readable JSON files.
//!
//! The file lives at
//! `<BrowserConfig::settings_root>/projects/<project_id>.json` (or
//! `global.json` for projectless browsing). Callers are expected to change
//! it frequently as the user pins URLs, visits pages, and dev servers are
//! detected — so:
//!
//! - writes are atomic (`<file>.tmp` + rename) to avoid torn reads.
//! - every file is guarded by a short-lived mutex so concurrent readers
//!   and writers never observe a half-written document.
//! - a corrupt file is treated as "empty" and logged at `warn` — we never
//!   panic, and we never fall back to a read-only mode.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use aura_os_core::ProjectId;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, warn};
use url::Url;

use crate::config::BrowserConfig;
use crate::error::Error;

/// Maximum number of entries kept in `detected_urls`, newest-first.
pub const DETECTED_URLS_CAP: usize = 10;

/// Maximum number of entries kept in `history`, newest-first.
pub const HISTORY_CAP: usize = 200;

/// Current on-disk schema version.
pub const SCHEMA_VERSION: u32 = 1;

/// Where a detected URL was observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectionSource {
    /// Scraped from a terminal output line (e.g. `"Local: http://..."`).
    Terminal,
    /// Found via an active port probe.
    Probe,
    /// Added by the user explicitly (e.g. "save this URL").
    Manual,
}

/// A single detected URL with provenance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DetectedUrl {
    /// The URL (http or https, usually localhost).
    pub url: Url,
    /// Where we observed it.
    pub source: DetectionSource,
    /// When we observed it.
    pub at: DateTime<Utc>,
}

/// One rolling history entry, newest-first.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryEntry {
    /// The visited URL.
    pub url: Url,
    /// The page title at visit time, when known.
    pub title: Option<String>,
    /// When the visit happened.
    pub at: DateTime<Utc>,
}

/// Persisted per-project browser settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectBrowserSettings {
    /// On-disk schema version for forward-compat.
    pub schema_version: u32,
    /// User's pinned default URL. When set, it's the first choice of the
    /// resolver.
    #[serde(default)]
    pub pinned_url: Option<Url>,
    /// Last successfully-visited URL in this project.
    #[serde(default)]
    pub last_url: Option<Url>,
    /// Rolling list of auto-detected dev-server URLs, newest-first.
    #[serde(default)]
    pub detected_urls: Vec<DetectedUrl>,
    /// Rolling browse history for this project, newest-first.
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
}

impl Default for ProjectBrowserSettings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            pinned_url: None,
            last_url: None,
            detected_urls: Vec::new(),
            history: Vec::new(),
        }
    }
}

/// Patch document for partial updates via the REST API.
///
/// `pinned_url: Some(None)` explicitly clears the pinned URL; `None` leaves
/// it untouched. `clear_history: true` wipes the rolling history.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsPatch {
    /// When `Some`, overwrite `pinned_url` (using `Some(None)` to clear).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_url: Option<Option<Url>>,
    /// Clear the rolling history when `true`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub clear_history: bool,
    /// Clear auto-detected URLs when `true`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub clear_detected: bool,
}

/// Async, concurrency-safe settings file store.
///
/// Clone-able; all clones share the same per-file mutex map.
#[derive(Clone)]
pub struct SettingsStore {
    root: PathBuf,
    file_locks: Arc<DashMap<PathBuf, Arc<Mutex<()>>>>,
}

impl std::fmt::Debug for SettingsStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SettingsStore")
            .field("root", &self.root)
            .field("files_open", &self.file_locks.len())
            .finish()
    }
}

impl SettingsStore {
    /// Build a new store rooted at `root`. The directory is created on
    /// first write.
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            file_locks: Arc::new(DashMap::new()),
        }
    }

    /// Build a store using the paths from [`BrowserConfig`].
    pub fn from_config(config: &BrowserConfig) -> Self {
        Self::new(config.settings_root.clone())
    }

    /// Return the absolute path for a given project's file.
    pub fn project_path(&self, project_id: &ProjectId) -> PathBuf {
        self.root
            .join("projects")
            .join(format!("{project_id}.json"))
    }

    /// Return the absolute path for the global (projectless) file.
    pub fn global_path(&self) -> PathBuf {
        self.root.join("global.json")
    }

    fn lock_for(&self, path: &Path) -> Arc<Mutex<()>> {
        self.file_locks
            .entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Read the settings for a project. Returns [`ProjectBrowserSettings::default`]
    /// when the file is missing or corrupt.
    pub async fn read_project(&self, project_id: &ProjectId) -> ProjectBrowserSettings {
        read_file(&self.project_path(project_id)).await
    }

    /// Read the global (projectless) settings.
    pub async fn read_global(&self) -> ProjectBrowserSettings {
        read_file(&self.global_path()).await
    }

    /// Apply a [`SettingsPatch`] to a project's settings.
    pub async fn patch_project(
        &self,
        project_id: &ProjectId,
        patch: SettingsPatch,
    ) -> Result<ProjectBrowserSettings, Error> {
        self.mutate_project(project_id, |s| apply_patch(s, patch))
            .await
    }

    /// Record a navigation event for a project (updates `last_url` and
    /// appends to `history`). No-op when `project_id` is `None`; the
    /// global file is only updated when explicitly requested.
    pub async fn record_visit(
        &self,
        project_id: Option<&ProjectId>,
        url: Url,
        title: Option<String>,
    ) -> Result<(), Error> {
        match project_id {
            Some(id) => {
                self.mutate_project(id, |s| push_visit(s, url, title))
                    .await?;
            }
            None => {
                self.mutate_global(|s| push_visit(s, url, title)).await?;
            }
        }
        Ok(())
    }

    /// Record a newly-observed detected URL (dedup + cap).
    pub async fn record_detected(
        &self,
        project_id: Option<&ProjectId>,
        entry: DetectedUrl,
    ) -> Result<(), Error> {
        match project_id {
            Some(id) => {
                self.mutate_project(id, |s| push_detected(s, entry)).await?;
            }
            None => {
                self.mutate_global(|s| push_detected(s, entry)).await?;
            }
        }
        Ok(())
    }

    async fn mutate_project<F>(
        &self,
        project_id: &ProjectId,
        mutate: F,
    ) -> Result<ProjectBrowserSettings, Error>
    where
        F: FnOnce(&mut ProjectBrowserSettings),
    {
        let path = self.project_path(project_id);
        self.mutate_path(&path, mutate).await
    }

    async fn mutate_global<F>(&self, mutate: F) -> Result<ProjectBrowserSettings, Error>
    where
        F: FnOnce(&mut ProjectBrowserSettings),
    {
        let path = self.global_path();
        self.mutate_path(&path, mutate).await
    }

    async fn mutate_path<F>(&self, path: &Path, mutate: F) -> Result<ProjectBrowserSettings, Error>
    where
        F: FnOnce(&mut ProjectBrowserSettings),
    {
        let lock = self.lock_for(path);
        let _guard = lock.lock().await;
        let mut settings = read_file(path).await;
        mutate(&mut settings);
        enforce_caps(&mut settings);
        write_file_atomic(path, &settings).await?;
        Ok(settings)
    }
}

fn apply_patch(settings: &mut ProjectBrowserSettings, patch: SettingsPatch) {
    if let Some(pinned) = patch.pinned_url {
        settings.pinned_url = pinned;
    }
    if patch.clear_history {
        settings.history.clear();
    }
    if patch.clear_detected {
        settings.detected_urls.clear();
    }
}

fn push_visit(settings: &mut ProjectBrowserSettings, url: Url, title: Option<String>) {
    let at = Utc::now();
    settings.last_url = Some(url.clone());
    settings
        .history
        .retain(|entry| entry.url != url || entry.title != title);
    settings.history.insert(0, HistoryEntry { url, title, at });
}

fn push_detected(settings: &mut ProjectBrowserSettings, entry: DetectedUrl) {
    settings
        .detected_urls
        .retain(|existing| existing.url != entry.url);
    settings.detected_urls.insert(0, entry);
}

fn enforce_caps(settings: &mut ProjectBrowserSettings) {
    if settings.detected_urls.len() > DETECTED_URLS_CAP {
        settings.detected_urls.truncate(DETECTED_URLS_CAP);
    }
    if settings.history.len() > HISTORY_CAP {
        settings.history.truncate(HISTORY_CAP);
    }
    if settings.schema_version == 0 {
        settings.schema_version = SCHEMA_VERSION;
    }
}

async fn read_file(path: &Path) -> ProjectBrowserSettings {
    match tokio::fs::read(path).await {
        Ok(bytes) => match serde_json::from_slice::<ProjectBrowserSettings>(&bytes) {
            Ok(parsed) => parsed,
            Err(err) => {
                warn!(
                    path = %path.display(),
                    error = %err,
                    "browser settings file was corrupt; treating as empty"
                );
                ProjectBrowserSettings::default()
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => ProjectBrowserSettings::default(),
        Err(err) => {
            warn!(
                path = %path.display(),
                error = %err,
                "failed to read browser settings; treating as empty"
            );
            ProjectBrowserSettings::default()
        }
    }
}

async fn write_file_atomic(path: &Path, settings: &ProjectBrowserSettings) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| Error::Settings {
                path: path.to_path_buf(),
                detail: format!("create_dir_all: {err}"),
            })?;
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|err| Error::Settings {
        path: path.to_path_buf(),
        detail: format!("serialize: {err}"),
    })?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|err| Error::Settings {
            path: path.to_path_buf(),
            detail: format!("write tmp {}: {err}", tmp.display()),
        })?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|err| Error::Settings {
            path: path.to_path_buf(),
            detail: format!("rename tmp: {err}"),
        })?;
    debug!(path = %path.display(), "browser settings written");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn detected(u: &str, source: DetectionSource) -> DetectedUrl {
        DetectedUrl {
            url: url(u),
            source,
            at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn missing_file_reads_as_default() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        let settings = store.read_project(&project).await;
        assert_eq!(settings, ProjectBrowserSettings::default());
    }

    #[tokio::test]
    async fn patch_pinned_url_round_trips() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        let patch = SettingsPatch {
            pinned_url: Some(Some(url("http://localhost:5173"))),
            ..SettingsPatch::default()
        };
        let updated = store.patch_project(&project, patch).await.unwrap();
        assert_eq!(updated.pinned_url, Some(url("http://localhost:5173")));

        let reloaded = store.read_project(&project).await;
        assert_eq!(reloaded.pinned_url, Some(url("http://localhost:5173")));
    }

    #[tokio::test]
    async fn patch_clear_pinned_url() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        store
            .patch_project(
                &project,
                SettingsPatch {
                    pinned_url: Some(Some(url("http://localhost:5173"))),
                    ..SettingsPatch::default()
                },
            )
            .await
            .unwrap();
        let cleared = store
            .patch_project(
                &project,
                SettingsPatch {
                    pinned_url: Some(None),
                    ..SettingsPatch::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(cleared.pinned_url, None);
    }

    #[tokio::test]
    async fn record_detected_dedups_and_caps() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        for port in 3000..3000 + (DETECTED_URLS_CAP as u16) + 3 {
            store
                .record_detected(
                    Some(&project),
                    detected(
                        &format!("http://localhost:{port}"),
                        DetectionSource::Terminal,
                    ),
                )
                .await
                .unwrap();
        }
        store
            .record_detected(
                Some(&project),
                detected("http://localhost:3000", DetectionSource::Probe),
            )
            .await
            .unwrap();
        let settings = store.read_project(&project).await;
        assert_eq!(settings.detected_urls.len(), DETECTED_URLS_CAP);
        assert_eq!(settings.detected_urls[0].url, url("http://localhost:3000"));
        assert_eq!(settings.detected_urls[0].source, DetectionSource::Probe);
    }

    #[tokio::test]
    async fn record_visit_sets_last_url_and_history() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        store
            .record_visit(
                Some(&project),
                url("http://localhost:5173"),
                Some("Vite".into()),
            )
            .await
            .unwrap();
        store
            .record_visit(Some(&project), url("http://localhost:5173/about"), None)
            .await
            .unwrap();
        let settings = store.read_project(&project).await;
        assert_eq!(settings.last_url, Some(url("http://localhost:5173/about")));
        assert_eq!(settings.history.len(), 2);
        assert_eq!(settings.history[0].url, url("http://localhost:5173/about"));
    }

    #[tokio::test]
    async fn corrupt_file_is_treated_as_empty() {
        let dir = tempdir().unwrap();
        let project = ProjectId::new();
        let path = dir.path().join("projects").join(format!("{project}.json"));
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, b"not json").await.unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let settings = store.read_project(&project).await;
        assert_eq!(settings, ProjectBrowserSettings::default());
    }

    #[tokio::test]
    async fn clear_flags_reset_collections() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        store
            .record_visit(Some(&project), url("http://localhost:5173"), None)
            .await
            .unwrap();
        store
            .record_detected(
                Some(&project),
                detected("http://localhost:3000", DetectionSource::Terminal),
            )
            .await
            .unwrap();
        let cleared = store
            .patch_project(
                &project,
                SettingsPatch {
                    clear_detected: true,
                    clear_history: true,
                    ..SettingsPatch::default()
                },
            )
            .await
            .unwrap();
        assert!(cleared.history.is_empty());
        assert!(cleared.detected_urls.is_empty());
    }
}
