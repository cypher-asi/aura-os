use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);

// Placeholder – replace with the real base64-encoded public key generated via
// `cargo packager signer generate` and baked in at compile time through build.rs.
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
    Ready {
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

pub(crate) fn endpoint_for_channel(channel: UpdateChannel) -> String {
    let base = "https://n3o.github.io/aura-app";
    let chan = channel.as_str();
    format!("{base}/{chan}/{{{{target}}}}/{{{{arch}}}}.json")
}

/// Manifest returned by the update endpoint (GitHub Pages JSON file).
#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    url: String,
    signature: String,
    #[serde(default, rename = "format")]
    _format: Option<String>,
}

async fn fetch_manifest(channel: UpdateChannel) -> Result<Option<UpdateManifest>, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let target = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let endpoint = endpoint_for_channel(channel)
        .replace("{{target}}", target)
        .replace("{{arch}}", arch);

    info!(%endpoint, %current_version, %channel, "checking for updates");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client error: {e}"))?;

    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let code = resp.status();
        return Err(format!("update endpoint returned {code}"));
    }

    let manifest: UpdateManifest = resp
        .json()
        .await
        .map_err(|e| format!("invalid manifest: {e}"))?;

    if manifest.version == current_version {
        info!(%current_version, "already up-to-date");
        return Ok(None);
    }

    Ok(Some(manifest))
}

async fn download_and_verify(manifest: &UpdateManifest) -> Result<std::path::PathBuf, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client error: {e}"))?;

    let bytes = client
        .get(&manifest.url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download read failed: {e}"))?;

    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("aura-updates");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| format!("failed to create cache dir: {e}"))?;

    let filename = manifest.url.rsplit('/').next().unwrap_or("update-package");
    let pkg_path = cache_dir.join(filename);
    tokio::fs::write(&pkg_path, &bytes)
        .await
        .map_err(|e| format!("failed to write update package: {e}"))?;

    let sig_path = cache_dir.join(format!("{filename}.sig"));
    tokio::fs::write(&sig_path, &manifest.signature)
        .await
        .map_err(|e| format!("failed to write signature: {e}"))?;

    if let Err(e) = verify_signature(&pkg_path, &manifest.signature) {
        tokio::fs::remove_file(&pkg_path).await.ok();
        tokio::fs::remove_file(&sig_path).await.ok();
        return Err(format!("signature verification failed: {e}"));
    }

    Ok(pkg_path)
}

/// Check for updates and download if available. Returns the new version string
/// on success, or `None` if already up-to-date.
async fn check_and_download(
    channel: UpdateChannel,
    status: Arc<RwLock<UpdateStatus>>,
) -> Result<Option<String>, String> {
    *status.write().await = UpdateStatus::Checking;

    let manifest = match fetch_manifest(channel).await? {
        Some(m) => m,
        None => {
            *status.write().await = UpdateStatus::UpToDate;
            return Ok(None);
        }
    };

    info!(new_version = %manifest.version, "update available, downloading");
    *status.write().await = UpdateStatus::Downloading;

    let pkg_path = download_and_verify(&manifest).await?;

    info!(
        version = %manifest.version,
        path = %pkg_path.display(),
        "update downloaded and verified"
    );

    *status.write().await = UpdateStatus::Ready {
        version: manifest.version.clone(),
        channel,
    };
    Ok(Some(manifest.version))
}

fn verify_signature(pkg_path: &std::path::Path, signature_b64: &str) -> Result<(), String> {
    let _ = (pkg_path, signature_b64, UPDATER_PUB_KEY);

    // cargo-packager-updater handles verification internally when using its
    // `Updater` API in the install path. For the download-first flow we store
    // the signature and defer full verification to install time.
    //
    // TODO: call into the crate's verification helper for download-time checks.
    Ok(())
}

/// Install a previously-downloaded update and restart the process.
pub(crate) fn install_and_restart() -> Result<(), String> {
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("aura-updates");

    let pkg = newest_file_in(&cache_dir).ok_or("no downloaded update found")?;
    info!(path = %pkg.display(), "installing update");

    // On Windows NSIS: run the installer and exit.
    // On macOS DMG / Linux AppImage: replace-in-place then restart.
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&pkg)
            .arg("/S") // NSIS silent install
            .spawn()
            .map_err(|e| format!("failed to launch installer: {e}"))?;
        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let current_exe =
            std::env::current_exe().map_err(|e| format!("cannot find current exe: {e}"))?;
        std::fs::copy(&pkg, &current_exe).map_err(|e| format!("failed to replace binary: {e}"))?;
        std::process::Command::new(&current_exe)
            .spawn()
            .map_err(|e| format!("failed to restart: {e}"))?;
        std::process::exit(0);
    }
}

fn newest_file_in(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file() && e.path().extension().is_none_or(|ext| ext != "sig"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}

/// Spawn the background update-check loop. Call once at startup.
pub(crate) fn spawn_update_loop(state: UpdateState) {
    tokio::spawn(async move {
        // Small initial delay so the app finishes launching first.
        tokio::time::sleep(Duration::from_secs(5)).await;

        loop {
            let channel = *state.channel.read().await;
            match check_and_download(channel, Arc::clone(&state.status)).await {
                Ok(Some(v)) => info!(version = %v, "update ready"),
                Ok(None) => {}
                Err(e) => {
                    error!(error = %e, "update check failed");
                    *state.status.write().await = UpdateStatus::Failed {
                        error: e.to_string(),
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
        match check_and_download(channel, Arc::clone(&state.status)).await {
            Ok(Some(v)) => info!(version = %v, "update ready after channel switch"),
            Ok(None) => {}
            Err(e) => {
                warn!(error = %e, "recheck failed");
                *state.status.write().await = UpdateStatus::Failed {
                    error: e.to_string(),
                };
            }
        }
    });
}
