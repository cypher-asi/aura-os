use base64::Engine;
#[cfg(not(target_os = "windows"))]
use cargo_packager_updater::Update;
use cargo_packager_updater::{
    semver::Version as SemverVersion, Config as PackagerUpdaterConfig, UpdaterBuilder,
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
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
#[cfg(target_os = "windows")]
use tracing::debug;
use tracing::{error, info, warn};

const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const INITIAL_CHECK_DELAY: Duration = Duration::from_secs(5);
const SETTINGS_FILE_NAME: &str = "desktop-updater.json";

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
    data_dir: Arc<PathBuf>,
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

    fn trigger_shutdown(&self) {
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

pub(crate) fn update_base_url() -> String {
    std::env::var("AURA_UPDATE_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            option_env!("AURA_UPDATE_BASE_URL")
                .unwrap_or("https://cypher-asi.github.io/aura-os")
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

fn validate_base64_utf8(label: &str, encoded: &str) -> Result<String, String> {
    let trimmed = encoded.trim();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|e| format!("invalid {label} base64: {e}"))?;
    String::from_utf8(decoded).map_err(|e| format!("invalid {label} utf-8: {e}"))?;
    Ok(trimmed.to_string())
}

fn updater_public_key() -> Result<String, String> {
    if UPDATER_PUB_KEY.starts_with("NOT_SET__") {
        return Err("updater public key is not configured".into());
    }
    // cargo-packager-updater expects the public key to remain base64-encoded.
    // We validate it here, but preserve the encoded value for the updater crate.
    validate_base64_utf8("public key", UPDATER_PUB_KEY)
}

pub(crate) fn updater_supported() -> bool {
    updater_public_key().is_ok()
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
    *status.write().expect("updater status lock poisoned") = next;
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

fn check_for_available_update(
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
    info!(new_version = %version, format = %update.format, "update available");
    set_status(
        &status,
        UpdateStatus::Available {
            version: version.clone(),
            channel,
        },
    );
    Ok(Some(version))
}

#[cfg(not(target_os = "windows"))]
fn restart_after_install(update: &Update) -> Result<(), String> {
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

#[cfg(target_os = "windows")]
const INSTALLER_STAGE_SUBDIR: &str = "runtime/updater";

#[cfg(target_os = "windows")]
fn sanitize_version_for_filename(version: &str) -> String {
    version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn stage_installer_bytes(data_dir: &Path, version: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let stage_dir = data_dir.join(INSTALLER_STAGE_SUBDIR);
    fs::create_dir_all(&stage_dir).map_err(|e| {
        format!(
            "failed to create installer stage dir {}: {e}",
            stage_dir.display()
        )
    })?;
    let sanitized = sanitize_version_for_filename(version);
    let final_path = stage_dir.join(format!("aura-setup-{sanitized}.exe"));
    let temp_path = stage_dir.join(format!(
        ".aura-setup-{sanitized}.tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|v| v.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&temp_path, bytes).map_err(|e| {
        format!(
            "failed to write staged installer {}: {e}",
            temp_path.display()
        )
    })?;
    if final_path.exists() {
        let _ = fs::remove_file(&final_path);
    }
    fs::rename(&temp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "failed to move staged installer {} -> {}: {e}",
            temp_path.display(),
            final_path.display()
        )
    })?;
    debug!(path = %final_path.display(), bytes = bytes.len(), "staged Windows installer");
    Ok(final_path)
}

#[cfg(target_os = "windows")]
fn spawn_windows_installer_with_flags(
    installer_path: &Path,
    creation_flags: u32,
) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    let mut command = std::process::Command::new(installer_path);
    command
        // `/P` enables passive mode in cargo-packager's NSIS template
        // (small progress window, no user interaction). `/R` asks the
        // installer to restart Aura once install completes.
        .args(["/P", "/R"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(creation_flags);

    if let Some(stage_dir) = installer_path.parent() {
        command.current_dir(stage_dir);
    }

    command.spawn()
}

#[cfg(target_os = "windows")]
fn spawn_windows_installer(installer_path: &Path) -> Result<u32, String> {
    // Creation flags for the detached install child. Breaking away from any
    // enclosing Job Object (wry/WebView2 can place the host process inside
    // one) is what actually keeps the installer alive once Aura exits. Some
    // Windows hosts disallow breakaway; retry without that flag so non-job
    // launches still work.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let base_flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    let child = match spawn_windows_installer_with_flags(
        installer_path,
        base_flags | CREATE_BREAKAWAY_FROM_JOB,
    ) {
        Ok(child) => child,
        Err(primary_error) => {
            warn!(
                error = %primary_error,
                installer = %installer_path.display(),
                "failed to spawn Windows installer with job breakaway; retrying without breakaway"
            );
            spawn_windows_installer_with_flags(installer_path, base_flags).map_err(
                |fallback_error| {
                    format!(
                        "failed to spawn installer {} with breakaway ({primary_error}) or fallback ({fallback_error})",
                        installer_path.display(),
                    )
                },
            )?
        }
    };
    Ok(child.id())
}

fn perform_update_install(state: &UpdateState) -> Result<Option<String>, String> {
    let channel = *state.channel.read().expect("updater channel lock poisoned");
    let status = Arc::clone(&state.status);
    let updater = build_updater(channel)?;
    let Some(update) = updater
        .check()
        .map_err(|e| format!("update check failed: {e}"))?
    else {
        set_status(&status, UpdateStatus::UpToDate);
        return Ok(None);
    };

    let version = update.version.clone();
    info!(new_version = %version, format = %update.format, "starting user-approved update download");
    set_status(
        &status,
        UpdateStatus::Downloading {
            version: version.clone(),
            channel,
        },
    );
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

    #[cfg(target_os = "windows")]
    {
        // Stage the verified installer bytes outside the install tree so
        // the filename that appears in UAC prompts and logs is meaningful,
        // and so the NSIS setup can still find itself after we exit.
        let installer_path = stage_installer_bytes(state.data_dir.as_ref(), &version, &bytes)?;
        drop(bytes);

        let pid = spawn_windows_installer(&installer_path)?;
        info!(
            pid,
            installer = %installer_path.display(),
            new_version = %version,
            "spawned detached Windows installer; exiting Aura for handoff"
        );
        // Sidecars are stopped synchronously by the `InstallUpdate` event before
        // this worker starts. Spawn the detached installer before posting the
        // final shutdown signal; otherwise the main event loop can terminate the
        // process before this thread reaches `spawn_windows_installer`.
        state.trigger_shutdown();
        std::thread::sleep(Duration::from_millis(250));
        // Release our own file handles on the install tree so the
        // installer can overwrite binaries cleanly.
        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        update
            .install(bytes)
            .map_err(|e| format!("update install failed: {e}"))?;
        restart_after_install(&update)?;
        Ok(Some(version))
    }
}

/// Install the latest available update after explicit user approval.
pub(crate) fn install_and_restart(state: UpdateState) -> Result<(), String> {
    match perform_update_install(&state) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err("no update available".into()),
        Err(error) => {
            set_status(
                &state.status,
                UpdateStatus::Failed {
                    error: error.clone(),
                },
            );
            Err(error)
        }
    }
}

pub(crate) fn start_install(state: UpdateState) -> Result<(), String> {
    if !updater_supported() {
        set_status(&state.status, UpdateStatus::Idle);
        return Err("updater is not configured".into());
    }

    {
        let status = state.status.read().expect("updater status lock poisoned");
        if matches!(
            &*status,
            UpdateStatus::Downloading { .. } | UpdateStatus::Installing { .. }
        ) {
            return Err("update install already in progress".into());
        }
    }

    tokio::spawn(async move {
        match tokio::task::spawn_blocking(move || install_and_restart(state)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                warn!(error = %error, "background install failed");
            }
            Err(error) => {
                warn!(error = %error, "background install task failed");
            }
        }
    });
    Ok(())
}

/// Spawn the background update-check loop. Call once at startup.
pub(crate) fn spawn_update_loop(state: UpdateState) {
    if !updater_supported() {
        info!("native updater disabled: updater public key is not configured");
        set_status(&state.status, UpdateStatus::Idle);
        return;
    }

    tokio::spawn(async move {
        // Small initial delay so the app finishes launching first.
        tokio::time::sleep(INITIAL_CHECK_DELAY).await;

        loop {
            let channel = *state.channel.read().expect("updater channel lock poisoned");
            let status = Arc::clone(&state.status);
            match tokio::task::spawn_blocking(move || check_for_available_update(channel, status))
                .await
            {
                Ok(Ok(Some(v))) => info!(version = %v, "update available for later install"),
                Ok(Ok(None)) => {}
                Ok(Err(e)) => {
                    error!(error = %e, "update check failed");
                    *state.status.write().expect("updater status lock poisoned") =
                        UpdateStatus::Failed {
                            error: e.to_string(),
                        };
                }
                Err(e) => {
                    error!(error = %e, "update task panicked");
                    *state.status.write().expect("updater status lock poisoned") =
                        UpdateStatus::Failed {
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
    if !updater_supported() {
        set_status(&state.status, UpdateStatus::Idle);
        return;
    }

    set_status(&state.status, UpdateStatus::Checking);

    tokio::spawn(async move {
        let channel = *state.channel.read().expect("updater channel lock poisoned");
        let status = Arc::clone(&state.status);
        match tokio::task::spawn_blocking(move || check_for_available_update(channel, status)).await
        {
            Ok(Ok(Some(v))) => info!(version = %v, "update available after channel switch"),
            Ok(Ok(None)) => {}
            Ok(Err(e)) => {
                warn!(error = %e, "recheck failed");
                *state.status.write().expect("updater status lock poisoned") =
                    UpdateStatus::Failed {
                        error: e.to_string(),
                    };
            }
            Err(e) => {
                warn!(error = %e, "recheck task failed");
                *state.status.write().expect("updater status lock poisoned") =
                    UpdateStatus::Failed {
                        error: format!("update task failed: {e}"),
                    };
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        default_update_channel, endpoint_for_channel_with_base, load_persisted_channel,
        persist_channel, validate_base64_utf8, UpdateChannel,
    };
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
