//! Initial-URL resolution policy.
//!
//! When a new browser session opens inside a project, this module picks a
//! sensible initial URL without making the user re-type it.

use std::time::{Duration, Instant};

use aura_os_core::ProjectId;
use tokio::net::TcpStream;
use tokio::time;
use tracing::debug;
use url::Url;

use crate::config::{BrowserConfig, ResolveOptions};
use crate::session::probe::probe_dev_ports;
use crate::session::settings::{ProjectBrowserSettings, SettingsStore};

/// Outcome of [`resolve_initial_url`]: which URL to navigate to and whether
/// the UI should focus the address bar on open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedInitialUrl {
    /// The URL to navigate to. `None` means `about:blank`.
    pub url: Option<Url>,
    /// Whether to focus the address bar in the UI.
    pub focus_address_bar: bool,
}

/// Resolve the initial URL for a new session.
///
/// Priority (first hit wins):
///
/// 1. `settings.pinned_url`
/// 2. Most-recent reachable entry in `settings.detected_urls`
/// 3. Reachable `settings.last_url`
/// 4. When `opts.allow_active_probe` is true, the first port that accepts a
///    TCP connection from [`probe_dev_ports`].
/// 5. `None` (→ `about:blank`).
pub async fn resolve_initial_url(
    store: &SettingsStore,
    project_id: Option<&ProjectId>,
    config: &BrowserConfig,
    opts: &ResolveOptions,
) -> ResolvedInitialUrl {
    let settings = match project_id {
        Some(id) => store.read_project(id).await,
        None => store.read_global().await,
    };

    if let Some(url) = pick_from_settings(&settings, config).await {
        return ResolvedInitialUrl {
            url: Some(url),
            focus_address_bar: false,
        };
    }

    if opts.allow_active_probe {
        if let Some(url) = probe_and_pick(store, project_id, config).await {
            return ResolvedInitialUrl {
                url: Some(url),
                focus_address_bar: false,
            };
        }
    }

    ResolvedInitialUrl {
        url: None,
        focus_address_bar: true,
    }
}

async fn pick_from_settings(
    settings: &ProjectBrowserSettings,
    config: &BrowserConfig,
) -> Option<Url> {
    if let Some(pinned) = settings.pinned_url.as_ref() {
        return Some(pinned.clone());
    }
    let deadline = Instant::now() + config.probe_budget;
    for entry in &settings.detected_urls {
        if Instant::now() >= deadline {
            break;
        }
        if is_reachable(&entry.url, config.probe_per_port_timeout).await {
            return Some(entry.url.clone());
        }
    }
    if let Some(last) = settings.last_url.as_ref() {
        if is_reachable(last, config.probe_per_port_timeout).await {
            return Some(last.clone());
        }
    }
    None
}

async fn probe_and_pick(
    store: &SettingsStore,
    project_id: Option<&ProjectId>,
    config: &BrowserConfig,
) -> Option<Url> {
    let detected = probe_dev_ports(config).await;
    let first = detected.first().cloned()?;
    if let Err(err) = store.record_detected(project_id, first.clone()).await {
        debug!(%err, "failed to persist probed URL; continuing with in-memory value");
    }
    Some(first.url)
}

async fn is_reachable(url: &Url, per_port_timeout: Duration) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(port) = url.port_or_known_default() else {
        return false;
    };
    let addr = format!("{host}:{port}");
    matches!(
        time::timeout(per_port_timeout, TcpStream::connect(&addr)).await,
        Ok(Ok(_)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::net::TcpListener;

    use crate::session::settings::{DetectedUrl, DetectionSource, SettingsPatch};

    #[tokio::test]
    async fn no_settings_returns_about_blank_with_focus() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let config = BrowserConfig::default();
        let resolved = resolve_initial_url(
            &store,
            Some(&ProjectId::new()),
            &config,
            &ResolveOptions::default(),
        )
        .await;
        assert_eq!(resolved.url, None);
        assert!(resolved.focus_address_bar);
    }

    #[tokio::test]
    async fn pinned_url_wins_without_reachability_check() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();
        let pinned = Url::parse("http://localhost:9999/unused").unwrap();
        store
            .patch_project(
                &project,
                SettingsPatch {
                    pinned_url: Some(Some(pinned.clone())),
                    ..SettingsPatch::default()
                },
            )
            .await
            .unwrap();
        let config = BrowserConfig::default();
        let resolved =
            resolve_initial_url(&store, Some(&project), &config, &ResolveOptions::default()).await;
        assert_eq!(resolved.url, Some(pinned));
        assert!(!resolved.focus_address_bar);
    }

    #[tokio::test]
    async fn detected_url_selected_when_reachable() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::new(dir.path().to_path_buf());
        let project = ProjectId::new();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let reachable = Url::parse(&format!("http://127.0.0.1:{}/", addr.port())).unwrap();
        let unreachable = Url::parse("http://127.0.0.1:1/").unwrap();

        store
            .record_detected(
                Some(&project),
                DetectedUrl {
                    url: unreachable,
                    source: DetectionSource::Terminal,
                    at: chrono::Utc::now(),
                },
            )
            .await
            .unwrap();
        store
            .record_detected(
                Some(&project),
                DetectedUrl {
                    url: reachable.clone(),
                    source: DetectionSource::Terminal,
                    at: chrono::Utc::now(),
                },
            )
            .await
            .unwrap();

        let config = BrowserConfig {
            probe_per_port_timeout: Duration::from_millis(100),
            probe_budget: Duration::from_millis(500),
            ..BrowserConfig::default()
        };
        let resolved =
            resolve_initial_url(&store, Some(&project), &config, &ResolveOptions::default()).await;
        assert_eq!(resolved.url, Some(reachable));
    }
}
