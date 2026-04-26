//! User-approved download & install paths. Performs the platform
//! handoff (Windows installer / non-Windows relaunch) once a fresh
//! update has been downloaded and verified.

#[cfg(not(target_os = "windows"))]
use cargo_packager_updater::Update;
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
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::fs;
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use tracing::debug;
use tracing::{info, warn};

use super::endpoint::build_updater;
use super::{set_status, updater_supported, UpdateState, UpdateStatus};

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
