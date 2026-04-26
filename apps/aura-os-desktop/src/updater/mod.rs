//! Native auto-update infrastructure backed by `cargo-packager-updater`.
//!
//! Sub-modules:
//!
//! * [`endpoint`] — update endpoint URL + public key handling.
//! * [`check`] — periodic and on-demand update checks.
//! * [`install`] — user-approved download & install (incl. Windows
//!   installer hand-off and non-Windows relaunch).

mod check;
mod endpoint;
mod install;

use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::warn;

pub(crate) use endpoint::{endpoint_for_channel, update_base_url, updater_supported};

const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const INITIAL_CHECK_DELAY: Duration = Duration::from_secs(5);
const SETTINGS_FILE_NAME: &str = "desktop-updater.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UpdateChannel {
    Stable,
    Nightly,
}

impl UpdateChannel {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Nightly => "nightly",
        }
    }
}

impl std::fmt::Display for UpdateChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for UpdateChannel {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "stable" => Ok(Self::Stable),
            "nightly" => Ok(Self::Nightly),
            other => Err(format!("unknown update channel: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum UpdateStatus {
    Checking,
    Available {
        version: String,
        channel: UpdateChannel,
    },
    Downloading {
        version: String,
        channel: UpdateChannel,
    },
    Installing {
        version: String,
        channel: UpdateChannel,
    },
    UpToDate,
    Failed {
        error: String,
    },
    Idle,
}

/// Callback invoked before the process exits as part of an update install.
/// The main event loop registers this so it can stop sidecar child processes
/// (local harness, Vite dev server) whose open file handles would otherwise
/// block the Windows installer from overwriting the install directory.
pub(crate) type ShutdownHook = Arc<dyn Fn() + Send + Sync>;

/// Shared mutable state that both the background task and the API routes read/write.
#[derive(Clone)]
pub(crate) struct UpdateState {
    pub status: Arc<RwLock<UpdateStatus>>,
    pub channel: Arc<RwLock<UpdateChannel>>,
    settings_path: Arc<PathBuf>,
    pub(super) data_dir: Arc<PathBuf>,
    shutdown_hook: Arc<RwLock<Option<ShutdownHook>>>,
}

impl std::fmt::Debug for UpdateState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UpdateState")
            .field("status", &self.status)
            .field("channel", &self.channel)
            .field("settings_path", &self.settings_path)
            .field("data_dir", &self.data_dir)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedUpdaterSettings {
    channel: UpdateChannel,
}

impl UpdateState {
    pub(crate) fn load(data_dir: &Path) -> Self {
        let settings_path = data_dir.join(SETTINGS_FILE_NAME);
        let default_channel = default_update_channel();
        let channel = load_persisted_channel(&settings_path).unwrap_or_else(|error| {
            warn!(error = %error, path = %settings_path.display(), "failed to load persisted updater settings");
            default_channel
        });
        Self {
            status: Arc::new(RwLock::new(UpdateStatus::Idle)),
            channel: Arc::new(RwLock::new(channel)),
            settings_path: Arc::new(settings_path),
            data_dir: Arc::new(data_dir.to_path_buf()),
            shutdown_hook: Arc::new(RwLock::new(None)),
        }
    }

    pub(crate) fn persist_channel(&self, channel: UpdateChannel) -> Result<(), String> {
        persist_channel(self.settings_path.as_ref(), channel)
    }

    /// Register a callback that asks the main event loop to stop sidecars and
    /// exit. Used prior to handing control to the platform installer so the
    /// installer can overwrite locked files.
    pub(crate) fn set_shutdown_hook<F>(&self, hook: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        *self
            .shutdown_hook
            .write()
            .expect("updater shutdown hook lock poisoned") = Some(Arc::new(hook));
    }

    pub(super) fn trigger_shutdown(&self) {
        let hook = {
            self.shutdown_hook
                .read()
                .expect("updater shutdown hook lock poisoned")
                .clone()
        };
        if let Some(hook) = hook {
            hook();
        }
    }
}

fn load_persisted_channel(settings_path: &Path) -> Result<UpdateChannel, String> {
    if !settings_path.exists() {
        return Ok(default_update_channel());
    }
    let bytes = fs::read(settings_path).map_err(|e| {
        format!(
            "failed to read updater settings {}: {e}",
            settings_path.display()
        )
    })?;
    let settings: PersistedUpdaterSettings = serde_json::from_slice(&bytes).map_err(|e| {
        format!(
            "failed to parse updater settings {}: {e}",
            settings_path.display()
        )
    })?;
    Ok(settings.channel)
}

fn default_update_channel() -> UpdateChannel {
    UpdateChannel::Nightly
}

fn persist_channel(settings_path: &Path, channel: UpdateChannel) -> Result<(), String> {
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "failed to create updater settings directory {}: {e}",
                parent.display()
            )
        })?;
    }
    let payload = serde_json::to_vec_pretty(&PersistedUpdaterSettings { channel })
        .map_err(|e| format!("failed to encode updater settings: {e}"))?;
    fs::write(settings_path, payload).map_err(|e| {
        format!(
            "failed to write updater settings {}: {e}",
            settings_path.display()
        )
    })
}

pub(super) fn set_status(status: &Arc<RwLock<UpdateStatus>>, next: UpdateStatus) {
    *status.write().expect("updater status lock poisoned") = next;
}

pub(crate) use check::{spawn_update_loop, trigger_recheck};
pub(crate) use install::start_install;

#[cfg(test)]
mod tests {
    use super::endpoint::{endpoint_for_channel_with_base, validate_base64_utf8};
    use super::{default_update_channel, load_persisted_channel, persist_channel, UpdateChannel};
    use base64::Engine;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn endpoint_uses_stable_channel_path() {
        let endpoint =
            endpoint_for_channel_with_base(UpdateChannel::Stable, "https://updates.example.com");
        assert_eq!(
            endpoint,
            "https://updates.example.com/stable/{{target}}/{{arch}}.json"
        );
    }

    #[test]
    fn endpoint_uses_nightly_channel_path() {
        let endpoint =
            endpoint_for_channel_with_base(UpdateChannel::Nightly, "https://updates.example.com");
        assert_eq!(
            endpoint,
            "https://updates.example.com/nightly/{{target}}/{{arch}}.json"
        );
    }

    #[test]
    fn defaults_to_nightly_channel_for_nightly_versions() {
        assert_eq!(default_update_channel(), UpdateChannel::Nightly);
    }

    #[test]
    fn decodes_base64_encoded_public_key() {
        let public_key = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let encoded = validate_base64_utf8(
            "public key",
            &base64::engine::general_purpose::STANDARD.encode(public_key),
        )
        .expect("public key should validate");
        assert_eq!(
            encoded,
            base64::engine::general_purpose::STANDARD.encode(public_key)
        );
    }

    #[test]
    fn persists_update_channel_to_disk() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("aura-updater-test-{unique}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let settings_path = temp_dir.join("desktop-updater.json");
        persist_channel(&settings_path, UpdateChannel::Nightly).expect("persist channel");
        let restored = load_persisted_channel(&settings_path).expect("load channel");
        assert_eq!(restored, UpdateChannel::Nightly);
        fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }
}
