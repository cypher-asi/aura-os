//! User-approved download & install paths. Performs the platform
//! handoff (Windows installer / non-Windows relaunch) once a fresh
//! update has been downloaded and verified.
//!
//! Every step calls into [`super::diagnostics`] (via the
//! [`super::record_step_only`] / [`super::set_status_with_step`] helpers) so
//! the install flow leaves a complete forensic trail under
//! `<data_dir>/logs/updater.log` and `<data_dir>/updater-state.json` that
//! survives `process::exit`. On Windows the spawned `cmd.exe` handoff
//! script appends to the same `updater.log`, so the pre-exit and post-exit
//! halves of an install are visible from one place. We deliberately use
//! `cmd.exe` (and a `.bat` script) rather than PowerShell because
//! PowerShell startup is gated by AMSI, ExecutionPolicy, and AV script
//! introspection that routinely add several seconds of latency to a
//! fresh-on-disk script — long enough to trip the parent's deadline and
//! report a misleading "handoff did not start" failure.

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
/// Soft deadline for the spawned handoff to touch its sentinel file. Real
/// Windows boxes routinely take multiple seconds to load `cmd.exe` (let
/// alone PowerShell) under Defender / AV introspection on a freshly-
/// written script. 30s is generous enough that legitimate AV scans never
/// trip it while still surfacing genuine spawn failures in finite time.
#[cfg(target_os = "windows")]
const HANDOFF_SENTINEL_TIMEOUT: Duration = Duration::from_secs(30);
/// Hard ceiling: even if the child is still alive, we give up at this
/// point so the install thread can never block forever. A timeout error
/// is reported but the child is intentionally NOT killed — if it does
/// eventually run, the install can still succeed.
#[cfg(target_os = "windows")]
const HANDOFF_SENTINEL_HARD_CEILING: Duration = Duration::from_secs(60);
/// Polling interval when waiting for the sentinel file. Small enough to
/// react quickly when the child starts in the common case.
#[cfg(target_os = "windows")]
const HANDOFF_SENTINEL_POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Maximum bytes of captured child stdout/stderr to splice into the
/// shared `updater.log` after a timeout. Keeps the log readable while
/// still preserving the most recent — and most informative — output.
#[cfg(target_os = "windows")]
const HANDOFF_OUTPUT_TAIL_BYTES: u64 = 4 * 1024;
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
        "aura-update-{}.bat",
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
fn handoff_stdout_path(data_dir: &Path, version: &str) -> PathBuf {
    updater_stage_dir(data_dir).join(format!(
        "aura-update-{}.bat.out",
        sanitize_version_for_filename(version)
    ))
}

#[cfg(target_os = "windows")]
fn handoff_stderr_path(data_dir: &Path, version: &str) -> PathBuf {
    updater_stage_dir(data_dir).join(format!(
        "aura-update-{}.bat.err",
        sanitize_version_for_filename(version)
    ))
}

/// Validate a value embedded into `set "NAME=value"` in the generated
/// `.bat`. Windows file paths cannot contain `"`, `\r`, or `\n`, so a
/// path that does is almost certainly a programming error rather than
/// hostile input. Reject loudly instead of producing a script that quietly
/// breaks under cmd's quoting rules.
#[cfg(target_os = "windows")]
fn cmd_set_value(name: &str, value: &str) -> Result<String, String> {
    if value.contains('"') || value.contains('\r') || value.contains('\n') {
        return Err(format!(
            "refusing to embed value for {name} in .bat: contains \" / CR / LF (got {value:?})"
        ));
    }
    Ok(value.to_string())
}

#[cfg(target_os = "windows")]
fn build_windows_handoff_script(
    installer_path: &Path,
    aura_exe_path: &Path,
    log_path: &Path,
    sentinel_path: &Path,
) -> Result<String, String> {
    // The script:
    //   1. Writes the sentinel immediately so the install thread can
    //      observe that the handoff actually started before the parent
    //      exits. If this never happens, the parent times out and
    //      surfaces a meaningful error instead of silently quitting.
    //   2. Appends every milestone to the shared updater log so the
    //      handoff log and the in-process log are one continuous trace.
    //   3. Sets `AURA_UPDATE_RELAUNCH=1` before relaunching Aura.exe so
    //      the new instance's single-instance retry loop knows to wait
    //      for the previous mutex to drop (see `single_instance.rs`).
    let installer = cmd_set_value("INSTALLER", &installer_path.to_string_lossy())?;
    let aura_exe = cmd_set_value("AURA_EXE", &aura_exe_path.to_string_lossy())?;
    let log = cmd_set_value("LOG", &log_path.to_string_lossy())?;
    let sentinel = cmd_set_value("SENTINEL", &sentinel_path.to_string_lossy())?;
    let installer_args = WINDOWS_NSIS_INSTALLER_ARGS.join(" ");
    let relaunch_env = WINDOWS_UPDATE_RELAUNCH_ENV;

    Ok(format!(
        "@echo off\r\n\
         setlocal EnableDelayedExpansion\r\n\
         set \"INSTALLER={installer}\"\r\n\
         set \"AURA_EXE={aura_exe}\"\r\n\
         set \"LOG={log}\"\r\n\
         set \"SENTINEL={sentinel}\"\r\n\
         \r\n\
         > \"!SENTINEL!\" type nul\r\n\
         \r\n\
         call :log \"step=handoff_script_started status=installing detail=installer=!INSTALLER! args={installer_args}\"\r\n\
         \r\n\
         \"!INSTALLER!\" {installer_args}\r\n\
         set EXIT_CODE=!ERRORLEVEL!\r\n\
         \r\n\
         call :log \"step=installer_exited status=installing detail=exitCode=!EXIT_CODE!\"\r\n\
         \r\n\
         if not \"!EXIT_CODE!\"==\"0\" (\r\n\
           call :log \"step=installer_failed status=failed error=installer_exit_code=!EXIT_CODE!\"\r\n\
           exit /b !EXIT_CODE!\r\n\
         )\r\n\
         \r\n\
         rem Brief settle so the installer's file handles drop before relaunch.\r\n\
         ping -n 2 127.0.0.1 > nul\r\n\
         \r\n\
         set \"{relaunch_env}=1\"\r\n\
         start \"\" \"!AURA_EXE!\"\r\n\
         call :log \"step=relaunch_spawned status=installing detail=exe=!AURA_EXE!\"\r\n\
         exit /b 0\r\n\
         \r\n\
         :log\r\n\
         >> \"!LOG!\" echo !DATE! !TIME! %~1\r\n\
         exit /b\r\n",
    ))
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
    )?;
    fs::write(&script_path, script).map_err(|e| {
        format!(
            "failed to write Windows update handoff script {}: {e}",
            script_path.display()
        )
    })?;
    Ok(script_path)
}

#[cfg(target_os = "windows")]
fn cmd_exe_path() -> String {
    std::env::var("SYSTEMROOT").map_or_else(
        |_| "cmd.exe".to_string(),
        |root| format!("{root}\\System32\\cmd.exe"),
    )
}

#[cfg(target_os = "windows")]
fn windows_nsis_installer_argument_list() -> String {
    WINDOWS_NSIS_INSTALLER_ARGS.join(" ")
}

#[cfg(target_os = "windows")]
fn spawn_windows_handoff_with_flags(
    script_path: &Path,
    stdout_path: &Path,
    stderr_path: &Path,
    creation_flags: u32,
) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    // Open fresh stdout/stderr files for THIS attempt. The breakaway-vs-
    // fallback retry path inside `spawn_windows_handoff` calls this twice;
    // each spawn needs its own owning `File` handle.
    let stdout_file = fs::File::create(stdout_path).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!(
                "failed to create handoff stdout capture {}: {e}",
                stdout_path.display()
            ),
        )
    })?;
    let stderr_file = fs::File::create(stderr_path).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!(
                "failed to create handoff stderr capture {}: {e}",
                stderr_path.display()
            ),
        )
    })?;

    let mut command = std::process::Command::new(cmd_exe_path());
    command
        // /D = ignore AutoRun, /C = run command and exit. Passing the
        // script as a single arg lets Rust handle quoting around paths
        // with spaces.
        .args(["/D", "/C"])
        .arg(script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .creation_flags(creation_flags);

    if let Some(stage_dir) = script_path.parent() {
        command.current_dir(stage_dir);
    }

    command.spawn()
}

#[cfg(target_os = "windows")]
fn spawn_windows_handoff(
    data_dir: &Path,
    script_path: &Path,
    stdout_path: &Path,
    stderr_path: &Path,
) -> Result<std::process::Child, String> {
    // Launch a detached cmd.exe wrapper running the .bat. The wrapper
    // waits for NSIS, records the real installer exit code, and relaunches
    // Aura after files are free.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let base_flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
    match spawn_windows_handoff_with_flags(
        script_path,
        stdout_path,
        stderr_path,
        base_flags | CREATE_BREAKAWAY_FROM_JOB,
    ) {
        Ok(child) => Ok(child),
        Err(primary_error) => {
            // Job breakaway can be denied (e.g. when running inside an
            // outer job that disallows breakaway). The retry without it
            // is the correct recovery — log it as an informational note
            // rather than as a Failed step, since the install can still
            // succeed via the fallback spawn.
            warn!(
                error = %primary_error,
                script = %script_path.display(),
                "failed to spawn Windows updater handoff with job breakaway; retrying without breakaway"
            );
            append_updater_log(
                data_dir,
                &format!(
                    "step=handoff_breakaway_retry status=installing detail=error={primary_error}"
                ),
            );
            spawn_windows_handoff_with_flags(script_path, stdout_path, stderr_path, base_flags)
                .map_err(|fallback_error| {
                    format!(
                        "failed to spawn updater handoff script {} with breakaway ({primary_error}) or fallback ({fallback_error})",
                        script_path.display(),
                    )
                })
        }
    }
}

/// Outcome of waiting for the spawned handoff to write its sentinel.
#[cfg(target_os = "windows")]
enum HandoffWaitOutcome {
    /// The sentinel file appeared — the script is running.
    SentinelDetected,
    /// The child exited (with the given status) without ever writing the
    /// sentinel. Whatever went wrong, retrying the same install attempt
    /// will not help — surface the captured stderr in the error message.
    ChildExitedEarly(std::process::ExitStatus),
    /// Hard ceiling reached while the child was still alive. The install
    /// thread reports a timeout but does NOT kill the child, in case it
    /// is just blocked on slow AV introspection and would otherwise run
    /// to completion successfully.
    HardCeilingReached,
}

#[cfg(target_os = "windows")]
fn wait_for_handoff_sentinel(
    state: &UpdateState,
    child: &mut std::process::Child,
    sentinel_path: &Path,
    soft_timeout: Duration,
    hard_ceiling: Duration,
) -> HandoffWaitOutcome {
    let start = Instant::now();
    let soft_deadline = start + soft_timeout;
    let hard_deadline = start + hard_ceiling;
    let mut extended_logged = false;

    loop {
        if sentinel_path.exists() {
            return HandoffWaitOutcome::SentinelDetected;
        }

        if let Ok(Some(status)) = child.try_wait() {
            // Race: the child may have written the sentinel and exited
            // between the two checks above. Re-check before declaring an
            // early-exit failure so we never spuriously fail an install
            // whose sentinel landed in the same poll tick as the exit.
            if sentinel_path.exists() {
                return HandoffWaitOutcome::SentinelDetected;
            }
            return HandoffWaitOutcome::ChildExitedEarly(status);
        }

        let now = Instant::now();
        if now >= hard_deadline {
            return HandoffWaitOutcome::HardCeilingReached;
        }
        if now >= soft_deadline && !extended_logged {
            extended_logged = true;
            record_step_only(
                state,
                UpdateStep::HandoffSentinelExtended,
                Some(&format!(
                    "soft_timeout_ms={} hard_ceiling_ms={} pid={}",
                    soft_timeout.as_millis(),
                    hard_ceiling.as_millis(),
                    child.id()
                )),
            );
        }
        std::thread::sleep(HANDOFF_SENTINEL_POLL_INTERVAL);
    }
}

/// Read up to `HANDOFF_OUTPUT_TAIL_BYTES` from the end of `path` and return
/// the contents as a `String`. Best-effort: returns `None` if the file
/// does not exist or cannot be read. Bytes that aren't valid UTF-8 are
/// replaced with U+FFFD so a partial-write or non-UTF-8 cmd codepage tail
/// still appears in `updater.log` rather than being dropped silently.
#[cfg(target_os = "windows")]
fn read_handoff_output_tail(path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    let len = metadata.len();
    let to_read = len.min(HANDOFF_OUTPUT_TAIL_BYTES);
    let offset = len.saturating_sub(to_read);
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = Vec::with_capacity(to_read as usize);
    file.take(to_read).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Splice the captured tails of the spawned handoff's stdout and stderr
/// into the shared `updater.log`. Called only on the timeout / early-exit
/// paths — successful handoffs have no console output worth preserving
/// because the .bat itself logs structured `step=…` lines directly.
#[cfg(target_os = "windows")]
fn capture_handoff_output(
    state: &UpdateState,
    stdout_path: &Path,
    stderr_path: &Path,
) -> (Option<String>, Option<String>) {
    let stdout = read_handoff_output_tail(stdout_path);
    let stderr = read_handoff_output_tail(stderr_path);
    let stdout_summary = stdout
        .as_deref()
        .map(summarise_for_detail)
        .unwrap_or_else(|| "<empty>".to_string());
    let stderr_summary = stderr
        .as_deref()
        .map(summarise_for_detail)
        .unwrap_or_else(|| "<empty>".to_string());
    record_step_only(
        state,
        UpdateStep::HandoffChildOutputCaptured,
        Some(&format!(
            "stdout={stdout_summary} stderr={stderr_summary} stdout_path={} stderr_path={}",
            stdout_path.display(),
            stderr_path.display()
        )),
    );

    // The data dir passed to `append_updater_log` is the same one
    // `updater_log_path` derives `<dir>/logs/updater.log` from.
    let data_dir = state.data_dir.as_ref();
    if let Some(out) = stdout.as_deref().filter(|s| !s.trim().is_empty()) {
        append_updater_log(
            data_dir,
            &format!("--- handoff stdout tail ({}) ---", stdout_path.display()),
        );
        for line in out.lines() {
            append_updater_log(data_dir, line);
        }
    }
    if let Some(err) = stderr.as_deref().filter(|s| !s.trim().is_empty()) {
        append_updater_log(
            data_dir,
            &format!("--- handoff stderr tail ({}) ---", stderr_path.display()),
        );
        for line in err.lines() {
            append_updater_log(data_dir, line);
        }
    }
    (stdout, stderr)
}

/// Collapse a multi-line tail into a single-line `detail=…` excerpt that
/// fits next to the structured `step=…` record. Keeps the log greppable
/// without losing the most-recent signal.
#[cfg(target_os = "windows")]
fn summarise_for_detail(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "<empty>".to_string();
    }
    let last = trimmed.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or(trimmed);
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let truncated: String = cleaned.chars().take(200).collect();
    if cleaned.chars().count() > 200 {
        format!("\"{truncated}…\"")
    } else {
        format!("\"{truncated}\"")
    }
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
        let stdout_path = handoff_stdout_path(state.data_dir.as_ref(), &version);
        let stderr_path = handoff_stderr_path(state.data_dir.as_ref(), &version);
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

        let mut child = spawn_windows_handoff(
            state.data_dir.as_ref(),
            &script_path,
            &stdout_path,
            &stderr_path,
        )?;
        let pid = child.id();
        record_step_only(
            state,
            UpdateStep::HandoffSpawned,
            Some(&format!(
                "pid={pid} script={} stdout={} stderr={} sentinel_timeout_ms={} hard_ceiling_ms={}",
                script_path.display(),
                stdout_path.display(),
                stderr_path.display(),
                HANDOFF_SENTINEL_TIMEOUT.as_millis(),
                HANDOFF_SENTINEL_HARD_CEILING.as_millis()
            )),
        );

        match wait_for_handoff_sentinel(
            state,
            &mut child,
            &sentinel_path,
            HANDOFF_SENTINEL_TIMEOUT,
            HANDOFF_SENTINEL_HARD_CEILING,
        ) {
            HandoffWaitOutcome::SentinelDetected => {
                record_step_only(
                    state,
                    UpdateStep::HandoffSentinelDetected,
                    Some(&format!("sentinel={} pid={pid}", sentinel_path.display())),
                );
            }
            HandoffWaitOutcome::ChildExitedEarly(status) => {
                let exit_summary = status
                    .code()
                    .map(|c| format!("exit_code={c}"))
                    .unwrap_or_else(|| "exit_code=unknown".to_string());
                record_step_only(
                    state,
                    UpdateStep::HandoffChildExitedEarly,
                    Some(&format!(
                        "sentinel={} pid={pid} {exit_summary}",
                        sentinel_path.display()
                    )),
                );
                let (_, stderr_tail) =
                    capture_handoff_output(state, &stdout_path, &stderr_path);
                let stderr_excerpt = stderr_tail
                    .as_deref()
                    .map(summarise_for_detail)
                    .unwrap_or_else(|| "<no stderr captured>".to_string());
                return Err(format!(
                    "Update handoff exited before starting the installer ({exit_summary}); \
                     stderr={stderr_excerpt}; see {} for full output",
                    log_path.display()
                ));
            }
            HandoffWaitOutcome::HardCeilingReached => {
                // The cmd.exe child is still alive but has not written the
                // sentinel after the hard ceiling. Do NOT kill it: the
                // most likely cause is slow AV / AMSI introspection on a
                // fresh-on-disk script, in which case the install can
                // still complete on its own. Surface the failure to the
                // user with the captured stderr tail so the cause is
                // visible and they can retry if the install never lands.
                record_step_only(
                    state,
                    UpdateStep::HandoffSentinelTimeout,
                    Some(&format!(
                        "sentinel={} pid={pid} soft_timeout_ms={} hard_ceiling_ms={}",
                        sentinel_path.display(),
                        HANDOFF_SENTINEL_TIMEOUT.as_millis(),
                        HANDOFF_SENTINEL_HARD_CEILING.as_millis()
                    )),
                );
                let (_, stderr_tail) =
                    capture_handoff_output(state, &stdout_path, &stderr_path);
                let stderr_excerpt = stderr_tail
                    .as_deref()
                    .map(summarise_for_detail)
                    .unwrap_or_else(|| "<no stderr captured>".to_string());
                return Err(format!(
                    "Update handoff did not start within {}s (process pid={pid} still alive; \
                     likely AV / AMSI / AppLocker introspection); stderr={stderr_excerpt}; \
                     see {} for details",
                    HANDOFF_SENTINEL_HARD_CEILING.as_secs(),
                    log_path.display()
                ));
            }
        }

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
        // the sentinel has been observed so we know cmd.exe is alive
        // before we begin tearing the parent down.
        record_step_only(state, UpdateStep::ShutdownTriggered, None);
        request_event_loop_shutdown(state);
        record_step_only(
            state,
            UpdateStep::ProcessExitCalled,
            Some("graceful=true"),
        );
        // Drop the Child handle without killing the process. The handoff
        // is detached and must outlive Aura so it can run the installer.
        drop(child);
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
        build_windows_handoff_script, cmd_set_value, handoff_script_path, handoff_sentinel_path,
        handoff_stderr_path, handoff_stdout_path, read_handoff_output_tail,
        sanitize_version_for_filename, spawn_windows_handoff, stage_installer_bytes,
        summarise_for_detail, wait_for_handoff_sentinel, windows_nsis_installer_argument_list,
        write_windows_handoff_script, HandoffWaitOutcome, HANDOFF_OUTPUT_TAIL_BYTES,
        INSTALLER_STAGE_SUBDIR, WINDOWS_UPDATE_RELAUNCH_ENV,
    };
    use crate::updater::UpdateState;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("aura-updater-{name}-{unique}"))
    }

    fn make_state(data_dir: &Path) -> UpdateState {
        fs::create_dir_all(data_dir).expect("create state data dir");
        UpdateState::load(data_dir)
    }

    fn spawn_cmd(args: &[&str]) -> std::process::Child {
        std::process::Command::new(super::cmd_exe_path())
            .args(["/D", "/C"])
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn helper cmd")
    }

    #[test]
    fn sanitizes_update_version_for_installer_filename() {
        assert_eq!(
            sanitize_version_for_filename("0.1.0-nightly+build/42"),
            "0.1.0-nightly_build_42"
        );
    }

    #[test]
    fn formats_nsis_arguments_for_cmd_invocation() {
        assert_eq!(windows_nsis_installer_argument_list(), "/P /R");
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
                .join("aura-update-1.2.3_win_test.bat")
        );
        assert_eq!(
            handoff_sentinel_path(&data_dir, "1.2.3+win/test"),
            data_dir
                .join(INSTALLER_STAGE_SUBDIR)
                .join(".aura-update-1.2.3_win_test.sentinel")
        );
        assert_eq!(
            handoff_stdout_path(&data_dir, "1.2.3+win/test"),
            data_dir
                .join(INSTALLER_STAGE_SUBDIR)
                .join("aura-update-1.2.3_win_test.bat.out")
        );
        assert_eq!(
            handoff_stderr_path(&data_dir, "1.2.3+win/test"),
            data_dir
                .join(INSTALLER_STAGE_SUBDIR)
                .join("aura-update-1.2.3_win_test.bat.err")
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
        )
        .expect("script should build");

        // Boilerplate every batch handoff must include.
        assert!(script.contains("@echo off"));
        assert!(script.contains("setlocal EnableDelayedExpansion"));
        // The sentinel write is the *first* substantive action.
        assert!(script.contains("> \"!SENTINEL!\" type nul"));
        // The installer is invoked with the literal NSIS args.
        assert!(script.contains("\"!INSTALLER!\" /P /R"));
        assert!(script.contains("set EXIT_CODE=!ERRORLEVEL!"));
        // Structured log lines that show up in updater.log via the :log
        // subroutine.
        assert!(script.contains("step=handoff_script_started"));
        assert!(script.contains("step=installer_exited"));
        assert!(script.contains("step=installer_failed"));
        assert!(script.contains("step=relaunch_spawned"));
        // Relaunch hands AURA_UPDATE_RELAUNCH=1 to the child via cmd's
        // env, satisfying single_instance.rs's retry loop.
        assert!(script.contains(&format!("set \"{WINDOWS_UPDATE_RELAUNCH_ENV}=1\"")));
        assert!(script.contains("start \"\" \"!AURA_EXE!\""));
        // The :log subroutine appends to the shared updater log.
        assert!(script.contains(":log"));
        assert!(script.contains(">> \"!LOG!\" echo"));
        // The path values get substituted via `set "VAR=..."`.
        assert!(script.contains(
            r#"set "INSTALLER=C:\Users\Test User\AppData\Local\aura\runtime\updater\aura setup.exe""#
        ));
        assert!(script.contains(
            r#"set "AURA_EXE=C:\Users\Test User\AppData\Local\Aura\Aura.exe""#
        ));
    }

    #[test]
    fn cmd_set_value_rejects_quotes_and_newlines() {
        assert!(cmd_set_value("X", "C:\\valid\\path.exe").is_ok());
        assert!(cmd_set_value("X", "with \"quote\"").is_err());
        assert!(cmd_set_value("X", "with\nnewline").is_err());
        assert!(cmd_set_value("X", "with\rcr").is_err());
    }

    #[test]
    fn build_script_rejects_paths_with_quotes() {
        let bad = PathBuf::from("C:\\bad\"path\\setup.exe");
        let good = PathBuf::from("C:\\ok\\Aura.exe");
        let log = PathBuf::from("C:\\ok\\updater.log");
        let sentinel = PathBuf::from("C:\\ok\\.sentinel");
        assert!(build_windows_handoff_script(&bad, &good, &log, &sentinel).is_err());
    }

    #[test]
    fn write_windows_handoff_script_writes_bat_to_disk() {
        let data_dir = unique_temp_dir("write-script");
        fs::create_dir_all(data_dir.join(INSTALLER_STAGE_SUBDIR))
            .expect("create stage dir");
        let installer = data_dir.join(INSTALLER_STAGE_SUBDIR).join("aura-setup.exe");
        let log = data_dir.join("logs").join("updater.log");
        let sentinel = data_dir
            .join(INSTALLER_STAGE_SUBDIR)
            .join(".sentinel");
        let path = write_windows_handoff_script(
            &data_dir, "9.9.9", &installer, &log, &sentinel,
        )
        .expect("write script");
        assert!(path.extension().and_then(|s| s.to_str()) == Some("bat"));
        let body = fs::read_to_string(&path).expect("read script");
        assert!(body.contains("@echo off"));
        assert!(body.contains("\"!INSTALLER!\" /P /R"));
        fs::remove_dir_all(&data_dir).ok();
    }

    #[test]
    fn sentinel_wait_returns_detected_when_file_appears() {
        let temp_dir = unique_temp_dir("sentinel-ok");
        let state = make_state(&temp_dir);
        let sentinel = temp_dir.join("ok.sentinel");
        fs::write(&sentinel, b"").expect("write sentinel");
        // Use a long-running cmd as a stand-in for the real handoff.
        let mut child = spawn_cmd(&["ping", "-n", "20", "127.0.0.1"]);
        let outcome = wait_for_handoff_sentinel(
            &state,
            &mut child,
            &sentinel,
            Duration::from_millis(200),
            Duration::from_millis(1_000),
        );
        assert!(matches!(outcome, HandoffWaitOutcome::SentinelDetected));
        let _ = child.kill();
        let _ = child.wait();
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn sentinel_wait_reports_early_exit_when_child_dies_without_writing() {
        let temp_dir = unique_temp_dir("sentinel-early-exit");
        let state = make_state(&temp_dir);
        let sentinel = temp_dir.join("never.sentinel");
        // Child that exits immediately with a distinctive code.
        let mut child = spawn_cmd(&["exit", "/B", "37"]);
        let outcome = wait_for_handoff_sentinel(
            &state,
            &mut child,
            &sentinel,
            Duration::from_millis(500),
            Duration::from_millis(2_000),
        );
        match outcome {
            HandoffWaitOutcome::ChildExitedEarly(status) => {
                assert_eq!(status.code(), Some(37));
            }
            other => panic!("expected ChildExitedEarly, got {other:?}"),
        }
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn sentinel_wait_reports_hard_ceiling_when_child_stays_alive() {
        let temp_dir = unique_temp_dir("sentinel-ceiling");
        let state = make_state(&temp_dir);
        let sentinel = temp_dir.join("never.sentinel");
        // Long-lived child that doesn't write the sentinel.
        let mut child = spawn_cmd(&["ping", "-n", "30", "127.0.0.1"]);
        let start = std::time::Instant::now();
        let outcome = wait_for_handoff_sentinel(
            &state,
            &mut child,
            &sentinel,
            Duration::from_millis(150),
            Duration::from_millis(450),
        );
        assert!(matches!(outcome, HandoffWaitOutcome::HardCeilingReached));
        assert!(start.elapsed() >= Duration::from_millis(440));
        let _ = child.kill();
        let _ = child.wait();
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn spawn_windows_handoff_runs_a_bat_and_writes_sentinel() {
        // End-to-end smoke: write a tiny .bat that writes a sentinel and
        // exits, spawn it via spawn_windows_handoff, verify the sentinel
        // appears. This exercises the real cmd.exe spawn path without
        // touching NSIS or Aura.exe.
        let temp_dir = unique_temp_dir("spawn-smoke");
        let stage = temp_dir.join(INSTALLER_STAGE_SUBDIR);
        fs::create_dir_all(&stage).expect("create stage");
        let sentinel = stage.join("smoke.sentinel");
        let script = stage.join("smoke.bat");
        fs::write(
            &script,
            format!(
                "@echo off\r\n> \"{}\" type nul\r\nexit /B 0\r\n",
                sentinel.display()
            ),
        )
        .expect("write smoke bat");
        let stdout = stage.join("smoke.bat.out");
        let stderr = stage.join("smoke.bat.err");
        let log = temp_dir.join("logs").join("updater.log");
        fs::create_dir_all(log.parent().unwrap()).expect("create log dir");
        let mut child = spawn_windows_handoff(&temp_dir, &script, &stdout, &stderr)
            .expect("spawn handoff");
        let _ = child.wait();
        assert!(sentinel.exists(), "sentinel should have been written by .bat");
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn read_handoff_output_tail_returns_last_bytes_only() {
        let dir = unique_temp_dir("tail");
        fs::create_dir_all(&dir).expect("create dir");
        let path = dir.join("out.txt");
        // Write more bytes than the tail size so we can verify only the
        // tail comes back.
        let big: Vec<u8> = (0..(HANDOFF_OUTPUT_TAIL_BYTES * 2))
            .map(|i| b'a' + (i % 26) as u8)
            .collect();
        fs::write(&path, &big).expect("write big file");
        let tail = read_handoff_output_tail(&path).expect("read tail");
        assert_eq!(tail.len(), HANDOFF_OUTPUT_TAIL_BYTES as usize);
        assert!(read_handoff_output_tail(&dir.join("nope.txt")).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn summarise_for_detail_takes_last_nonempty_line_and_strips_controls() {
        assert_eq!(summarise_for_detail(""), "<empty>");
        assert_eq!(summarise_for_detail("\n   \n"), "<empty>");
        assert_eq!(
            summarise_for_detail("first\nsecond\nthird\n"),
            "\"third\""
        );
        assert!(summarise_for_detail("line\twith\tcontrol").contains(' '));
    }
}

// `HandoffWaitOutcome` doesn't derive Debug, so the test panic message in
// `sentinel_wait_reports_early_exit_when_child_dies_without_writing` needs
// a manual impl. Behind the same cfg gate as the type itself.
#[cfg(all(test, target_os = "windows"))]
impl std::fmt::Debug for HandoffWaitOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SentinelDetected => f.write_str("SentinelDetected"),
            Self::ChildExitedEarly(status) => write!(f, "ChildExitedEarly({status:?})"),
            Self::HardCeilingReached => f.write_str("HardCeilingReached"),
        }
    }
}
