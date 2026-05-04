//! User-approved download & install paths. Performs the platform
//! handoff (Windows installer / non-Windows relaunch) once a fresh
//! update has been downloaded and verified.
//!
//! Every step calls into [`super::diagnostics`] (via the
//! [`super::record_step_only`] / [`super::set_status_with_step`] helpers) so
//! the install flow leaves a complete forensic trail under
//! `<data_dir>/logs/updater.log` and `<data_dir>/updater-state.json` that
//! survives `process::exit`. On Windows the spawned PowerShell handoff
//! script appends to the same `updater.log`, so the pre-exit and post-exit
//! halves of an install are visible from one place.

#[cfg(not(target_os = "windows"))]
use cargo_packager_updater::Update;
use std::path::{Path, PathBuf};
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "macos"
))]
use std::process::Command;
use std::time::{Duration, Instant};

use std::fs;

#[cfg(target_os = "windows")]
use tracing::debug;
use tracing::{info, warn};

use super::diagnostics::append_updater_log;
use super::endpoint::build_updater;
use super::{
    record_step_only, set_status_with_step, updater_supported, UpdateState, UpdateStatus,
    UpdateStep,
};

#[cfg(target_os = "windows")]
const INSTALLER_STAGE_SUBDIR: &str = "runtime/updater";
#[cfg(target_os = "windows")]
const WINDOWS_NSIS_INSTALLER_ARGS: [&str; 2] = ["/P", "/R"];
#[cfg(target_os = "windows")]
const WINDOWS_UPDATE_RELAUNCH_ENV: &str = "AURA_UPDATE_RELAUNCH";
/// How long the install thread waits for the spawned handoff script to
/// touch its sentinel file before giving up. Five seconds gives PowerShell
/// (and antivirus interception) plenty of headroom on slow systems while
/// still failing visibly when the spawn never executes.
const HANDOFF_SENTINEL_TIMEOUT: Duration = Duration::from_secs(5);
/// Polling interval when waiting for the sentinel file. Small enough to
/// react quickly when PowerShell starts in the common case.
const HANDOFF_SENTINEL_POLL_INTERVAL: Duration = Duration::from_millis(50);
/// How long the install thread waits for the tao event loop to honor the
/// `ShutdownForUpdate` signal before letting the OS reap the process.
const SHUTDOWN_DRAIN_TIMEOUT: Duration = Duration::from_millis(2000);

#[cfg(not(target_os = "windows"))]
fn restart_after_install(state: &UpdateState, update: &Update) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bundle_path = &update.extract_path;
        if !bundle_path.exists() {
            return Err(format!(
                "post-install verification failed: extract_path {} does not exist",
                bundle_path.display()
            ));
        }
        if bundle_path.extension().and_then(|s| s.to_str()) != Some("app") {
            warn!(
                path = %bundle_path.display(),
                "extract_path does not end in .app; relaunch will likely fail"
            );
        }
        record_step_only(
            state,
            UpdateStep::InstallInnerFinished,
            Some(&format!("bundle={}", bundle_path.display())),
        );
        info!(path = %bundle_path.display(), "restarting updated macOS app");
        match Command::new("open").arg("-n").arg(bundle_path).spawn() {
            Ok(child) => {
                record_step_only(
                    state,
                    UpdateStep::RelaunchSpawned,
                    Some(&format!("pid={} bundle={}", child.id(), bundle_path.display())),
                );
            }
            Err(error) => {
                record_step_only(
                    state,
                    UpdateStep::RelaunchFailed,
                    Some(&format!("error={error} bundle={}", bundle_path.display())),
                );
                return Err(format!("failed to relaunch updated app: {error}"));
            }
        }
        record_step_only(state, UpdateStep::ProcessExitCalled, Some("graceful=true"));
        request_event_loop_shutdown(state);
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
        match Command::new(&target_path).spawn() {
            Ok(child) => {
                record_step_only(
                    state,
                    UpdateStep::RelaunchSpawned,
                    Some(&format!("pid={} exe={}", child.id(), target_path.display())),
                );
            }
            Err(error) => {
                record_step_only(
                    state,
                    UpdateStep::RelaunchFailed,
                    Some(&format!("error={error} exe={}", target_path.display())),
                );
                return Err(format!("failed to relaunch updated app: {error}"));
            }
        }
        record_step_only(state, UpdateStep::ProcessExitCalled, Some("graceful=true"));
        request_event_loop_shutdown(state);
        std::process::exit(0);
    }
}

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
fn updater_stage_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(INSTALLER_STAGE_SUBDIR)
}

#[cfg(target_os = "windows")]
fn handoff_script_path(data_dir: &Path, version: &str) -> PathBuf {
    updater_stage_dir(data_dir).join(format!(
        "aura-update-{}.ps1",
        sanitize_version_for_filename(version)
    ))
}

#[cfg(target_os = "windows")]
fn handoff_sentinel_path(data_dir: &Path, version: &str) -> PathBuf {
    updater_stage_dir(data_dir).join(format!(
        ".aura-update-{}.sentinel",
        sanitize_version_for_filename(version)
    ))
}

#[cfg(target_os = "windows")]
fn ps_single_quoted(value: &Path) -> String {
    format!("'{}'", value.to_string_lossy().replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn ps_log_path_quoted(log_path: &Path) -> String {
    ps_single_quoted(log_path)
}

#[cfg(target_os = "windows")]
fn ps_string_array(values: &[&str]) -> String {
    let quoted = values
        .iter()
        .map(|value| format!("'{}'", value.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(", ");
    format!("@({quoted})")
}

#[cfg(target_os = "windows")]
fn build_windows_handoff_script(
    installer_path: &Path,
    aura_exe_path: &Path,
    log_path: &Path,
    sentinel_path: &Path,
) -> String {
    // The script:
    //   1. Touches the sentinel immediately so the install thread can
    //      observe that PowerShell actually started before the parent
    //      exits. If this never happens, we know the spawn was blocked
    //      (antivirus, ExecutionPolicy, missing PS) and surface a
    //      meaningful error instead of silently quitting Aura.
    //   2. Appends every milestone to the shared updater log so the
    //      handoff log and the in-process log are one continuous trace.
    format!(
        r#"$ErrorActionPreference = 'Continue'
$installerPath = {installer_path}
$auraExePath = {aura_exe_path}
$logPath = {log_path}
$sentinelPath = {sentinel_path}
$installerArgs = {installer_args}

function Write-HandoffLog {{
  param([string]$Message)
  $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$timestamp $Message"
}}

try {{
  New-Item -ItemType File -Path $sentinelPath -Force | Out-Null
}} catch {{
  # Best-effort sentinel; the parent will time out and surface a Failed
  # status if we never write it. Continue so the installer still runs in
  # case the failure was a transient permission issue on a temp dir.
}}

try {{
  Write-HandoffLog "step=handoff_script_started status=installing detail=pid=$PID installer=$installerPath args=$($installerArgs -join ' ')"
  $installer = Start-Process -FilePath $installerPath -ArgumentList $installerArgs -PassThru -Wait
  $exitCode = 0
  if ($null -ne $installer.ExitCode) {{
    $exitCode = [int]$installer.ExitCode
  }}
  Write-HandoffLog "step=installer_exited status=installing detail=pid=$($installer.Id) exitCode=$exitCode"

  if ($exitCode -eq 0) {{
    Start-Sleep -Milliseconds 500
    $env:{relaunch_env} = '1'
    $relaunched = Start-Process -FilePath $auraExePath -PassThru
    Write-HandoffLog "step=relaunch_spawned status=installing detail=pid=$($relaunched.Id) exe=$auraExePath"
    exit 0
  }}

  Write-HandoffLog "step=installer_failed status=failed error=installer_exit_code=$exitCode"
  exit $exitCode
}} catch {{
  Write-HandoffLog "step=handoff_script_failed status=failed error=$($_.Exception.Message)"
  exit 1
}}
"#,
        installer_path = ps_single_quoted(installer_path),
        aura_exe_path = ps_single_quoted(aura_exe_path),
        log_path = ps_log_path_quoted(log_path),
        sentinel_path = ps_single_quoted(sentinel_path),
        installer_args = ps_string_array(&WINDOWS_NSIS_INSTALLER_ARGS),
        relaunch_env = WINDOWS_UPDATE_RELAUNCH_ENV,
    )
}

#[cfg(target_os = "windows")]
fn write_windows_handoff_script(
    data_dir: &Path,
    version: &str,
    installer_path: &Path,
    log_path: &Path,
    sentinel_path: &Path,
) -> Result<PathBuf, String> {
    let aura_exe_path = std::env::current_exe()
        .map_err(|e| format!("failed to resolve current Aura executable path: {e}"))?;
    let script_path = handoff_script_path(data_dir, version);
    let script = build_windows_handoff_script(
        installer_path,
        &aura_exe_path,
        log_path,
        sentinel_path,
    );
    fs::write(&script_path, script).map_err(|e| {
        format!(
            "failed to write Windows update handoff script {}: {e}",
            script_path.display()
        )
    })?;
    Ok(script_path)
}

#[cfg(target_os = "windows")]
fn windows_powershell_path() -> String {
    std::env::var("SYSTEMROOT").map_or_else(
        |_| "powershell.exe".to_string(),
        |root| format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    )
}

#[cfg(target_os = "windows")]
fn windows_nsis_installer_argument_list() -> String {
    WINDOWS_NSIS_INSTALLER_ARGS.join(", ")
}

#[cfg(target_os = "windows")]
fn spawn_windows_handoff_with_flags(
    script_path: &Path,
    creation_flags: u32,
) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    let mut command = std::process::Command::new(windows_powershell_path());
    command
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(creation_flags);

    if let Some(stage_dir) = script_path.parent() {
        command.current_dir(stage_dir);
    }

    command.spawn()
}

#[cfg(target_os = "windows")]
fn spawn_windows_handoff(
    state: &UpdateState,
    script_path: &Path,
    log_path: &Path,
) -> Result<u32, String> {
    // Launch a detached PowerShell wrapper. The wrapper waits for NSIS, records
    // the real installer exit code, and relaunches Aura after files are free.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let base_flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
    let child = match spawn_windows_handoff_with_flags(
        script_path,
        base_flags | CREATE_BREAKAWAY_FROM_JOB,
    ) {
        Ok(child) => child,
        Err(primary_error) => {
            warn!(
                error = %primary_error,
                script = %script_path.display(),
                "failed to spawn Windows updater handoff with job breakaway; retrying without breakaway"
            );
            append_updater_log(
                log_path.parent().unwrap_or(log_path),
                &format!(
                    "step=handoff_breakaway_failed status=installing error={primary_error}"
                ),
            );
            record_step_only(
                state,
                UpdateStep::Failed,
                Some(&format!("handoff_breakaway_failed error={primary_error}")),
            );
            spawn_windows_handoff_with_flags(script_path, base_flags).map_err(
                |fallback_error| {
                    format!(
                        "failed to spawn updater handoff script {} with breakaway ({primary_error}) or fallback ({fallback_error})",
                        script_path.display(),
                    )
                },
            )?
        }
    };
    Ok(child.id())
}

#[cfg(target_os = "windows")]
fn wait_for_handoff_sentinel(sentinel_path: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if sentinel_path.exists() {
            return true;
        }
        std::thread::sleep(HANDOFF_SENTINEL_POLL_INTERVAL);
    }
    false
}

fn perform_update_install(state: &UpdateState) -> Result<Option<String>, String> {
    let channel = *state.channel.read().expect("updater channel lock poisoned");
    record_step_only(state, UpdateStep::InstallRequested, None);

    let updater = build_updater(channel)?;
    record_step_only(state, UpdateStep::BuilderReady, None);

    record_step_only(state, UpdateStep::CheckStarted, None);
    let Some(update) = updater
        .check()
        .map_err(|e| format!("update check failed: {e}"))?
    else {
        set_status_with_step(state, UpdateStatus::UpToDate, UpdateStep::UpToDate, None);
        return Ok(None);
    };

    let version = update.version.clone();
    record_step_only(
        state,
        UpdateStep::CheckResult,
        Some(&format!("version={version} format={}", update.format)),
    );

    info!(new_version = %version, format = %update.format, "starting user-approved update download");
    set_status_with_step(
        state,
        UpdateStatus::Downloading {
            version: version.clone(),
            channel,
        },
        UpdateStep::DownloadStarted,
        None,
    );
    let bytes = update
        .download()
        .map_err(|e| format!("download failed: {e}"))?;
    record_step_only(
        state,
        UpdateStep::DownloadFinished,
        Some(&format!("bytes={}", bytes.len())),
    );

    info!(new_version = %version, "update downloaded and verified");
    set_status_with_step(
        state,
        UpdateStatus::Installing {
            version: version.clone(),
            channel,
        },
        UpdateStep::StageStarted,
        None,
    );

    #[cfg(target_os = "windows")]
    {
        // Stage the verified installer bytes outside the install tree so
        // the filename that appears in UAC prompts and logs is meaningful,
        // and so the NSIS setup can still find itself after we exit.
        let installer_path = stage_installer_bytes(state.data_dir.as_ref(), &version, &bytes)?;
        record_step_only(
            state,
            UpdateStep::StageDone,
            Some(&format!(
                "installer={} bytes={}",
                installer_path.display(),
                bytes.len()
            )),
        );
        let log_path = super::diagnostics::updater_log_path(state.data_dir.as_ref());
        let sentinel_path = handoff_sentinel_path(state.data_dir.as_ref(), &version);
        // Pre-clear the sentinel so a stale file from an earlier abort
        // cannot make a fresh handoff look successful.
        let _ = fs::remove_file(&sentinel_path);
        drop(bytes);

        let script_path = write_windows_handoff_script(
            state.data_dir.as_ref(),
            &version,
            &installer_path,
            &log_path,
            &sentinel_path,
        )?;
        record_step_only(
            state,
            UpdateStep::ScriptWritten,
            Some(&format!(
                "script={} sentinel={} args={}",
                script_path.display(),
                sentinel_path.display(),
                windows_nsis_installer_argument_list()
            )),
        );

        let pid = spawn_windows_handoff(state, &script_path, &log_path)?;
        record_step_only(
            state,
            UpdateStep::HandoffSpawned,
            Some(&format!(
                "pid={pid} script={} sentinel_timeout_ms={}",
                script_path.display(),
                HANDOFF_SENTINEL_TIMEOUT.as_millis()
            )),
        );

        if !wait_for_handoff_sentinel(&sentinel_path, HANDOFF_SENTINEL_TIMEOUT) {
            // The PowerShell child never reached its very first line. Do
            // NOT exit the app — leaving Aura running gives the user a
            // chance to retry and the failure surfaces in the UI.
            record_step_only(
                state,
                UpdateStep::HandoffSentinelTimeout,
                Some(&format!(
                    "sentinel={} pid={pid} timeout_ms={}",
                    sentinel_path.display(),
                    HANDOFF_SENTINEL_TIMEOUT.as_millis()
                )),
            );
            return Err(format!(
                "PowerShell handoff did not start within {:?}; \
                 see {} for details",
                HANDOFF_SENTINEL_TIMEOUT,
                log_path.display()
            ));
        }
        record_step_only(
            state,
            UpdateStep::HandoffSentinelDetected,
            Some(&format!("sentinel={} pid={pid}", sentinel_path.display())),
        );

        info!(
            pid,
            installer = %installer_path.display(),
            script = %script_path.display(),
            handoff_log = %log_path.display(),
            new_version = %version,
            "spawned detached Windows updater handoff; exiting Aura"
        );
        // Sidecars are stopped synchronously by the `InstallUpdate` event
        // before this worker starts. Trigger the event loop shutdown after
        // the sentinel has been observed so we know PowerShell is alive
        // before we begin tearing the parent down.
        record_step_only(state, UpdateStep::ShutdownTriggered, None);
        request_event_loop_shutdown(state);
        record_step_only(
            state,
            UpdateStep::ProcessExitCalled,
            Some("graceful=true"),
        );
        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        record_step_only(state, UpdateStep::InstallInnerStarted, None);
        update
            .install(bytes)
            .map_err(|e| format!("update install failed: {e}"))?;
        record_step_only(state, UpdateStep::InstallInnerFinished, None);
        restart_after_install(state, &update)?;
        Ok(Some(version))
    }
}

/// Trigger the tao event loop to drop sidecars and exit cleanly. Blocks
/// briefly so the loop has time to honor the request before the install
/// thread proceeds to `process::exit`.
fn request_event_loop_shutdown(state: &UpdateState) {
    state.trigger_shutdown();
    // Best-effort drain — we can't observe the loop directly, so a short
    // sleep gives it time to honor `ControlFlow::Exit` before the parent
    // process disappears. This is intentionally short; the sentinel wait
    // upstream is the real "did the handoff start" signal.
    std::thread::sleep(SHUTDOWN_DRAIN_TIMEOUT);
}

/// Install the latest available update after explicit user approval.
pub(crate) fn install_and_restart(state: UpdateState) -> Result<(), String> {
    match perform_update_install(&state) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err("no update available".into()),
        Err(error) => {
            // Capture the last step we logged so the UI can surface where
            // the install died. We pull it from the persisted snapshot
            // because the in-memory status was about to be overwritten.
            let last_step = super::diagnostics::load_state_snapshot(state.data_dir.as_ref())
                .ok()
                .flatten()
                .map(|snap| snap.step);
            set_status_with_step(
                &state,
                UpdateStatus::Failed {
                    error: error.clone(),
                    last_step: last_step.clone(),
                },
                UpdateStep::Failed,
                last_step.as_deref(),
            );
            Err(error)
        }
    }
}

pub(crate) fn start_install(state: UpdateState) -> Result<(), String> {
    if !updater_supported() {
        set_status_with_step(
            &state,
            UpdateStatus::Idle,
            UpdateStep::Failed,
            Some("updater_unsupported"),
        );
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

    std::thread::Builder::new()
        .name("aura-update-install".into())
        .spawn(move || {
            if let Err(error) = install_and_restart(state) {
                warn!(error = %error, "background install failed");
            }
        })
        .map_err(|error| format!("failed to spawn updater install thread: {error}"))?;
    Ok(())
}

/// Stage the verified installer bytes without exiting the running app.
/// Used by the debug-only `/api/update-stage-only` endpoint and by the
/// integration test harness to validate the network/signature/staging path
/// without losing the running session.
#[cfg(target_os = "windows")]
pub(crate) fn stage_only(state: &UpdateState) -> Result<PathBuf, String> {
    let channel = *state.channel.read().expect("updater channel lock poisoned");
    record_step_only(state, UpdateStep::InstallRequested, Some("stage_only=true"));
    let updater = build_updater(channel)?;
    record_step_only(state, UpdateStep::BuilderReady, Some("stage_only=true"));
    record_step_only(state, UpdateStep::CheckStarted, Some("stage_only=true"));
    let update = updater
        .check()
        .map_err(|e| format!("update check failed: {e}"))?
        .ok_or_else(|| "no update available".to_string())?;
    let version = update.version.clone();
    record_step_only(
        state,
        UpdateStep::CheckResult,
        Some(&format!("stage_only=true version={version}")),
    );
    record_step_only(state, UpdateStep::DownloadStarted, Some("stage_only=true"));
    let bytes = update
        .download()
        .map_err(|e| format!("download failed: {e}"))?;
    record_step_only(
        state,
        UpdateStep::DownloadFinished,
        Some(&format!("stage_only=true bytes={}", bytes.len())),
    );
    let installer_path = stage_installer_bytes(state.data_dir.as_ref(), &version, &bytes)?;
    record_step_only(
        state,
        UpdateStep::StageDone,
        Some(&format!(
            "stage_only=true installer={}",
            installer_path.display()
        )),
    );
    Ok(installer_path)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn stage_only(state: &UpdateState) -> Result<PathBuf, String> {
    let channel = *state.channel.read().expect("updater channel lock poisoned");
    record_step_only(state, UpdateStep::InstallRequested, Some("stage_only=true"));
    let updater = build_updater(channel)?;
    record_step_only(state, UpdateStep::BuilderReady, Some("stage_only=true"));
    record_step_only(state, UpdateStep::CheckStarted, Some("stage_only=true"));
    let update = updater
        .check()
        .map_err(|e| format!("update check failed: {e}"))?
        .ok_or_else(|| "no update available".to_string())?;
    let version = update.version.clone();
    record_step_only(
        state,
        UpdateStep::CheckResult,
        Some(&format!("stage_only=true version={version}")),
    );
    record_step_only(state, UpdateStep::DownloadStarted, Some("stage_only=true"));
    let bytes = update
        .download()
        .map_err(|e| format!("download failed: {e}"))?;
    record_step_only(
        state,
        UpdateStep::DownloadFinished,
        Some(&format!("stage_only=true bytes={}", bytes.len())),
    );
    // On non-Windows the verified bytes still need to be persisted somewhere
    // for inspection. Drop them under `<data_dir>/runtime/updater/` so the
    // staging trail mirrors Windows.
    let stage_dir = state.data_dir.join("runtime/updater");
    fs::create_dir_all(&stage_dir).map_err(|e| {
        format!(
            "failed to create installer stage dir {}: {e}",
            stage_dir.display()
        )
    })?;
    let staged_path = stage_dir.join(format!("aura-update-{version}.bin"));
    fs::write(&staged_path, &bytes).map_err(|e| {
        format!(
            "failed to write staged update bytes {}: {e}",
            staged_path.display()
        )
    })?;
    record_step_only(
        state,
        UpdateStep::StageDone,
        Some(&format!(
            "stage_only=true staged={} bytes={}",
            staged_path.display(),
            bytes.len()
        )),
    );
    Ok(staged_path)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{
        build_windows_handoff_script, handoff_script_path, handoff_sentinel_path,
        sanitize_version_for_filename, stage_installer_bytes, wait_for_handoff_sentinel,
        windows_nsis_installer_argument_list, INSTALLER_STAGE_SUBDIR,
        WINDOWS_UPDATE_RELAUNCH_ENV,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("aura-updater-{name}-{unique}"))
    }

    #[test]
    fn sanitizes_update_version_for_installer_filename() {
        assert_eq!(
            sanitize_version_for_filename("0.1.0-nightly+build/42"),
            "0.1.0-nightly_build_42"
        );
    }

    #[test]
    fn formats_nsis_arguments_for_powershell_start_process() {
        assert_eq!(windows_nsis_installer_argument_list(), "/P, /R");
    }

    #[test]
    fn stages_installer_bytes_under_updater_runtime_dir() {
        let temp_dir = unique_temp_dir("stage");
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let staged = stage_installer_bytes(&temp_dir, "1.2.3+win/test", b"installer bytes")
            .expect("stage installer");

        assert_eq!(
            staged,
            temp_dir
                .join(INSTALLER_STAGE_SUBDIR)
                .join("aura-setup-1.2.3_win_test.exe")
        );
        assert_eq!(
            fs::read(&staged).expect("read staged installer"),
            b"installer bytes"
        );

        fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn handoff_paths_are_stable_for_a_version() {
        let data_dir = PathBuf::from(r"C:\Users\Test User\AppData\Local\aura");
        assert_eq!(
            handoff_script_path(&data_dir, "1.2.3+win/test"),
            data_dir
                .join(INSTALLER_STAGE_SUBDIR)
                .join("aura-update-1.2.3_win_test.ps1")
        );
        assert_eq!(
            handoff_sentinel_path(&data_dir, "1.2.3+win/test"),
            data_dir
                .join(INSTALLER_STAGE_SUBDIR)
                .join(".aura-update-1.2.3_win_test.sentinel")
        );
    }

    #[test]
    fn handoff_script_touches_sentinel_logs_and_relaunches() {
        let script = build_windows_handoff_script(
            PathBuf::from(r"C:\Users\Test User\AppData\Local\aura\runtime\updater\aura setup.exe")
                .as_path(),
            PathBuf::from(r"C:\Users\Test User\AppData\Local\Aura\Aura.exe").as_path(),
            PathBuf::from(r"C:\Users\Test User\AppData\Local\aura\logs\updater.log").as_path(),
            PathBuf::from(
                r"C:\Users\Test User\AppData\Local\aura\runtime\updater\.aura-update.sentinel",
            )
            .as_path(),
        );

        assert!(script.contains("New-Item -ItemType File -Path $sentinelPath"));
        assert!(script.contains("Start-Process -FilePath $installerPath"));
        assert!(script.contains("$installerArgs = @('/P', '/R')"));
        assert!(script.contains("-PassThru -Wait"));
        assert!(script.contains("step=installer_exited"));
        assert!(script.contains(&format!("$env:{WINDOWS_UPDATE_RELAUNCH_ENV} = '1'")));
        assert!(script.contains("step=relaunch_spawned"));
        assert!(script.contains(r#"'C:\Users\Test User\AppData\Local\Aura\Aura.exe'"#));
    }

    #[test]
    fn sentinel_wait_returns_true_when_file_appears() {
        let temp_dir = unique_temp_dir("sentinel-ok");
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let sentinel = temp_dir.join("ok.sentinel");
        fs::write(&sentinel, b"").expect("write sentinel");
        assert!(wait_for_handoff_sentinel(
            &sentinel,
            Duration::from_millis(200)
        ));
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn sentinel_wait_returns_false_after_timeout() {
        let temp_dir = unique_temp_dir("sentinel-miss");
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let sentinel = temp_dir.join("missing.sentinel");
        let start = std::time::Instant::now();
        assert!(!wait_for_handoff_sentinel(
            &sentinel,
            Duration::from_millis(150)
        ));
        assert!(start.elapsed() >= Duration::from_millis(140));
        fs::remove_dir_all(&temp_dir).ok();
    }
}
