use base64::Engine;
use cargo_packager_updater::{
    semver::Version as SemverVersion, Config as PackagerUpdaterConfig, Update, UpdaterBuilder,
    WindowsConfig, WindowsUpdateInstallMode,
};
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "macos"
))]
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const INITIAL_CHECK_DELAY: Duration = Duration::from_secs(5);

// Base64-encoded Minisign public key baked in at compile time through build.rs.
const UPDATER_PUB_KEY: &str = env!("UPDATER_PUBLIC_KEY");

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
    Downloading,
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

/// Shared mutable state that both the background task and the API routes read/write.
#[derive(Clone)]
pub(crate) struct UpdateState {
    pub status: Arc<RwLock<UpdateStatus>>,
    pub channel: Arc<RwLock<UpdateChannel>>,
}

impl UpdateState {
    pub(crate) fn new(channel: UpdateChannel) -> Self {
        Self {
            status: Arc::new(RwLock::new(UpdateStatus::Idle)),
            channel: Arc::new(RwLock::new(channel)),
        }
    }
}

pub(crate) fn update_base_url() -> String {
    std::env::var("AURA_UPDATE_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            option_env!("AURA_UPDATE_BASE_URL")
                .unwrap_or("https://n3o.github.io/aura-app")
                .trim_end_matches('/')
                .to_string()
        })
}

fn endpoint_for_channel_with_base(channel: UpdateChannel, base: &str) -> String {
    let chan = channel.as_str();
    format!("{base}/{chan}/{{{{target}}}}/{{{{arch}}}}.json")
}

pub(crate) fn endpoint_for_channel(channel: UpdateChannel) -> String {
    let base = update_base_url();
    endpoint_for_channel_with_base(channel, &base)
}

fn decode_base64_utf8(label: &str, encoded: &str) -> Result<String, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| format!("invalid {label} base64: {e}"))?;
    String::from_utf8(decoded).map_err(|e| format!("invalid {label} utf-8: {e}"))
}

fn updater_public_key() -> Result<String, String> {
    if UPDATER_PUB_KEY.starts_with("NOT_SET__") {
        return Err("updater public key is not configured".into());
    }
    decode_base64_utf8("public key", UPDATER_PUB_KEY)
}

fn updater_config(channel: UpdateChannel) -> Result<PackagerUpdaterConfig, String> {
    let endpoint = endpoint_for_channel(channel)
        .parse()
        .map_err(|e| format!("invalid updater endpoint: {e}"))?;
    Ok(PackagerUpdaterConfig {
        endpoints: vec![endpoint],
        pubkey: updater_public_key()?,
        windows: Some(WindowsConfig {
            install_mode: Some(WindowsUpdateInstallMode::Passive),
            installer_args: None,
        }),
    })
}

fn set_status(status: &Arc<RwLock<UpdateStatus>>, next: UpdateStatus) {
    *status.blocking_write() = next;
}

fn build_updater(channel: UpdateChannel) -> Result<cargo_packager_updater::Updater, String> {
    let current_version = SemverVersion::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| format!("invalid current version: {e}"))?;
    let config = updater_config(channel)?;
    UpdaterBuilder::new(current_version, config)
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| format!("failed to build updater: {e}"))
}

fn check_and_autoinstall(
    channel: UpdateChannel,
    status: Arc<RwLock<UpdateStatus>>,
) -> Result<Option<String>, String> {
    let updater = build_updater(channel)?;
    let endpoint = endpoint_for_channel(channel)
        .replace("{{target}}", std::env::consts::OS)
        .replace("{{arch}}", std::env::consts::ARCH);
    info!(
        %endpoint,
        current_version = env!("CARGO_PKG_VERSION"),
        %channel,
        "checking for updates"
    );

    set_status(&status, UpdateStatus::Checking);
    let Some(update) = updater
        .check()
        .map_err(|e| format!("update check failed: {e}"))?
    else {
        set_status(&status, UpdateStatus::UpToDate);
        return Ok(None);
    };

    let version = update.version.clone();
    info!(new_version = %version, format = %update.format, "update available, downloading");
    set_status(&status, UpdateStatus::Downloading);
    let bytes = update
        .download()
        .map_err(|e| format!("download failed: {e}"))?;

    info!(new_version = %version, "update downloaded and verified");
    set_status(
        &status,
        UpdateStatus::Installing {
            version: version.clone(),
            channel,
        },
    );

    update
        .install(bytes)
        .map_err(|e| format!("update install failed: {e}"))?;
    restart_after_install(&update)?;
    Ok(Some(version))
}

fn restart_after_install(update: &Update) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = update;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let bundle_path = &update.extract_path;
        info!(path = %bundle_path.display(), "restarting updated macOS app");
        Command::new("open")
            .arg("-n")
            .arg(bundle_path)
            .spawn()
            .map_err(|e| format!("failed to relaunch updated app: {e}"))?;
        std::process::exit(0);
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        if !matches!(
            update.format,
            cargo_packager_updater::UpdateFormat::AppImage
        ) {
            return Err(format!(
                "unsupported Linux update format for relaunch: {}",
                update.format
            ));
        }
        let target_path = std::env::var_os("APPIMAGE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| update.extract_path.clone());
        info!(path = %target_path.display(), "restarting updated Linux app");
        Command::new(&target_path)
            .spawn()
            .map_err(|e| format!("failed to relaunch updated app: {e}"))?;
        std::process::exit(0);
    }
}

/// Install a previously-downloaded update and restart the process.
pub(crate) fn install_and_restart() -> Result<(), String> {
    Err("updates install automatically after download".into())
}

/// Spawn the background update-check loop. Call once at startup.
pub(crate) fn spawn_update_loop(state: UpdateState) {
    tokio::spawn(async move {
        // Small initial delay so the app finishes launching first.
        tokio::time::sleep(INITIAL_CHECK_DELAY).await;

        loop {
            let channel = *state.channel.read().await;
            let status = Arc::clone(&state.status);
            match tokio::task::spawn_blocking(move || check_and_autoinstall(channel, status)).await
            {
                Ok(Ok(Some(v))) => info!(version = %v, "update installed"),
                Ok(Ok(None)) => {}
                Ok(Err(e)) => {
                    error!(error = %e, "update check failed");
                    *state.status.write().await = UpdateStatus::Failed {
                        error: e.to_string(),
                    };
                }
                Err(e) => {
                    error!(error = %e, "update task panicked");
                    *state.status.write().await = UpdateStatus::Failed {
                        error: format!("update task failed: {e}"),
                    };
                }
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// Trigger an immediate re-check (e.g. after the user switches channels).
pub(crate) fn trigger_recheck(state: UpdateState) {
    tokio::spawn(async move {
        let channel = *state.channel.read().await;
        let status = Arc::clone(&state.status);
        match tokio::task::spawn_blocking(move || check_and_autoinstall(channel, status)).await {
            Ok(Ok(Some(v))) => info!(version = %v, "update installed after channel switch"),
            Ok(Ok(None)) => {}
            Ok(Err(e)) => {
                warn!(error = %e, "recheck failed");
                *state.status.write().await = UpdateStatus::Failed {
                    error: e.to_string(),
                };
            }
            Err(e) => {
                warn!(error = %e, "recheck task failed");
                *state.status.write().await = UpdateStatus::Failed {
                    error: format!("update task failed: {e}"),
                };
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{decode_base64_utf8, endpoint_for_channel_with_base, UpdateChannel};
    use base64::Engine;

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
    fn decodes_base64_encoded_public_key() {
        let public_key = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let decoded = decode_base64_utf8(
            "public key",
            &base64::engine::general_purpose::STANDARD.encode(public_key),
        )
        .expect("public key should decode");
        assert_eq!(decoded, public_key);
    }
}
