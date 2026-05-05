//! Cross-platform diagnostics for the desktop updater.
//!
//! Every prior auto-updater incident has been blind: the install thread
//! exits before any meaningful diagnostic reaches a place the user (or a
//! developer) can inspect. This module centralises two artefacts that
//! survive a process exit and are written from every step of the install
//! flow on both Windows and macOS:
//!
//! * `<data_dir>/logs/updater.log` — append-only, ISO-8601 timestamped step
//!   trace. PowerShell handoff scripts append to the same file so the
//!   pre-exit and post-exit halves of an install live in one place.
//! * `<data_dir>/updater-state.json` — single-record JSON snapshot of the
//!   latest known step. The relaunched (or freshly opened) Aura instance
//!   reads this on boot to reconcile interrupted installs and surface the
//!   last failure.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const LOG_DIR_NAME: &str = "logs";
const UPDATER_LOG_FILE: &str = "updater.log";
const UPDATER_STATE_FILE: &str = "updater-state.json";

/// Stable identifiers for the major stages of an install attempt. Surfaced
/// to the UI so users see *where* an install died, not just an opaque
/// error string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UpdateStep {
    InstallRequested,
    BuilderReady,
    CheckStarted,
    CheckResult,
    UpToDate,
    DownloadStarted,
    DownloadFinished,
    StageStarted,
    StageDone,
    ScriptWritten,
    HandoffSpawned,
    HandoffSentinelDetected,
    HandoffSentinelTimeout,
    /// Spawned handoff child exited before writing the sentinel — usually
    /// means the script itself errored out (AppLocker / WDAC / malformed
    /// args). We capture stderr alongside this step so the cause is visible
    /// in `updater.log` instead of being lost.
    HandoffChildExitedEarly,
    /// Soft deadline elapsed but the child is still alive. We continue
    /// polling up to a hard ceiling rather than failing immediately, so
    /// slow AV / AMSI introspection on a freshly-written script does not
    /// abort an otherwise-healthy install.
    HandoffSentinelExtended,
    /// Tail of the spawned handoff's stdout/stderr that was attached to
    /// `updater.log` after a timeout, so post-mortem inspection has the
    /// child's own console output without needing a second log file.
    HandoffChildOutputCaptured,
    InstallInnerStarted,
    InstallInnerFinished,
    RelaunchSpawned,
    RelaunchFailed,
    ShutdownTriggered,
    ProcessExitCalled,
    ReconcileSuccess,
    ReconcileTimeout,
    Failed,
}

impl UpdateStep {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::InstallRequested => "install_requested",
            Self::BuilderReady => "builder_ready",
            Self::CheckStarted => "check_started",
            Self::CheckResult => "check_result",
            Self::UpToDate => "up_to_date",
            Self::DownloadStarted => "download_started",
            Self::DownloadFinished => "download_finished",
            Self::StageStarted => "stage_started",
            Self::StageDone => "stage_done",
            Self::ScriptWritten => "script_written",
            Self::HandoffSpawned => "handoff_spawned",
            Self::HandoffSentinelDetected => "handoff_sentinel_detected",
            Self::HandoffSentinelTimeout => "handoff_sentinel_timeout",
            Self::HandoffChildExitedEarly => "handoff_child_exited_early",
            Self::HandoffSentinelExtended => "handoff_sentinel_extended",
            Self::HandoffChildOutputCaptured => "handoff_child_output_captured",
            Self::InstallInnerStarted => "install_inner_started",
            Self::InstallInnerFinished => "install_inner_finished",
            Self::RelaunchSpawned => "relaunch_spawned",
            Self::RelaunchFailed => "relaunch_failed",
            Self::ShutdownTriggered => "shutdown_triggered",
            Self::ProcessExitCalled => "process_exit_called",
            Self::ReconcileSuccess => "reconcile_success",
            Self::ReconcileTimeout => "reconcile_timeout",
            Self::Failed => "failed",
        }
    }
}

impl std::fmt::Display for UpdateStep {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Single-record on-disk snapshot of the latest known install state. Written
/// next to `<data_dir>/desktop-updater.json` (the channel preference) so it
/// is always discoverable from the same root as the updater settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct PersistedUpdateState {
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    pub(crate) step: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) detail: Option<String>,
    pub(crate) ts_unix_ms: u64,
}

pub(crate) fn updater_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_DIR_NAME).join(UPDATER_LOG_FILE)
}

pub(crate) fn updater_state_path(data_dir: &Path) -> PathBuf {
    data_dir.join(UPDATER_STATE_FILE)
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn iso8601_now() -> String {
    // Hand-rolled UTC ISO-8601 (no chrono dep on this crate). Format:
    // `YYYY-MM-DDTHH:MM:SS.mmmZ`. Good enough for human-readable logs.
    let total_ms = now_unix_ms();
    let total_s = total_ms / 1000;
    let ms = total_ms % 1000;
    let (year, month, day, hour, minute, second) = unix_to_ymdhms(total_s);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z"
    )
}

/// Convert seconds-since-epoch to (Y, M, D, h, m, s) in UTC. Implemented
/// inline so the diagnostics module has no extra time-crate dependency.
fn unix_to_ymdhms(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let mut secs_today = (secs % 86_400) as u32;
    let hour = secs_today / 3600;
    secs_today %= 3600;
    let minute = secs_today / 60;
    let second = secs_today % 60;

    // Algorithm based on Howard Hinnant's days_from_civil inverse.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = (y + i64::from(m <= 2)) as u32;
    (year, m, d, hour, minute, second)
}

/// Append a single line to `<data_dir>/logs/updater.log`. Best-effort: any
/// I/O error is swallowed so the install path is never aborted by a logging
/// failure.
pub(crate) fn append_updater_log(data_dir: &Path, message: &str) {
    let log_path = updater_log_path(data_dir);
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let line = format!("{} {}\n", iso8601_now(), message);
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Append a `step=…` line to the updater log and refresh the persisted JSON
/// snapshot. `status` mirrors the in-memory `UpdateStatus::status` discriminant
/// (`installing`, `downloading`, …). Any extra context (paths, byte counts,
/// pids) goes into `detail`.
pub(crate) fn record_update_step(
    data_dir: &Path,
    status: &str,
    step: UpdateStep,
    version: Option<&str>,
    channel: Option<&str>,
    error: Option<&str>,
    detail: Option<&str>,
) {
    let mut parts: Vec<String> = Vec::with_capacity(8);
    parts.push(format!("step={step}"));
    parts.push(format!("status={status}"));
    if let Some(version) = version {
        parts.push(format!("version={version}"));
    }
    if let Some(channel) = channel {
        parts.push(format!("channel={channel}"));
    }
    if let Some(detail) = detail {
        parts.push(format!("detail={detail}"));
    }
    if let Some(error) = error {
        parts.push(format!("error={}", error.replace('\n', " | ")));
    }
    append_updater_log(data_dir, &parts.join(" "));

    let snapshot = PersistedUpdateState {
        status: status.to_string(),
        version: version.map(str::to_string),
        channel: channel.map(str::to_string),
        error: error.map(str::to_string),
        step: step.as_str().to_string(),
        detail: detail.map(str::to_string),
        ts_unix_ms: now_unix_ms(),
    };
    write_state_snapshot(data_dir, &snapshot);
}

fn write_state_snapshot(data_dir: &Path, state: &PersistedUpdateState) {
    let path = updater_state_path(data_dir);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(payload) = serde_json::to_vec_pretty(state) {
        // Best-effort atomic replace: write to a tmp file then rename.
        let tmp_path = path.with_extension("json.tmp");
        if fs::write(&tmp_path, &payload).is_ok() && fs::rename(&tmp_path, &path).is_err() {
            // Fall back to direct write if rename fails (typically because
            // the destination is locked on Windows mid-update).
            let _ = fs::write(&path, &payload);
            let _ = fs::remove_file(&tmp_path);
        }
    }
}

/// Read the last-known persisted state, if any. Returns `Ok(None)` for a
/// missing file (first run or freshly cleaned data dir).
pub(crate) fn load_state_snapshot(data_dir: &Path) -> Result<Option<PersistedUpdateState>, String> {
    let path = updater_state_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let state: PersistedUpdateState = serde_json::from_slice(&bytes)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))?;
    Ok(Some(state))
}

/// Delete the persisted state snapshot. Used after a successful reconcile so
/// we don't keep surfacing a stale warning across restarts.
pub(crate) fn clear_state_snapshot(data_dir: &Path) {
    let _ = fs::remove_file(updater_state_path(data_dir));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aura-updater-diag-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn unix_to_ymd_handles_known_dates() {
        // 1970-01-01T00:00:00Z
        let (y, m, d, h, min, s) = unix_to_ymdhms(0);
        assert_eq!((y, m, d, h, min, s), (1970, 1, 1, 0, 0, 0));
        // 2020-01-01T00:00:00Z = 1577836800 (start of a leap year)
        let (y, m, d, h, min, s) = unix_to_ymdhms(1_577_836_800);
        assert_eq!((y, m, d, h, min, s), (2020, 1, 1, 0, 0, 0));
        // 2024-02-29T12:34:56Z = 1709210096 (verify leap-day handling)
        let (y, m, d, h, min, s) = unix_to_ymdhms(1_709_210_096);
        assert_eq!((y, m, d, h, min, s), (2024, 2, 29, 12, 34, 56));
        // 2099-12-31T23:59:59Z = 4102444799
        let (y, m, d, h, min, s) = unix_to_ymdhms(4_102_444_799);
        assert_eq!((y, m, d, h, min, s), (2099, 12, 31, 23, 59, 59));
    }

    #[test]
    fn appends_lines_to_updater_log_and_creates_dir() {
        let dir = unique_temp_dir("append");
        append_updater_log(&dir, "first");
        append_updater_log(&dir, "second");
        let log = fs::read_to_string(updater_log_path(&dir)).expect("read log");
        let lines: Vec<&str> = log.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" first"), "unexpected line: {}", lines[0]);
        assert!(lines[1].ends_with(" second"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn record_step_writes_log_and_state_snapshot() {
        let dir = unique_temp_dir("record");
        record_update_step(
            &dir,
            "downloading",
            UpdateStep::DownloadStarted,
            Some("0.1.2"),
            Some("nightly"),
            None,
            Some("bytes_pending"),
        );
        let log = fs::read_to_string(updater_log_path(&dir)).expect("read log");
        assert!(log.contains("step=download_started"));
        assert!(log.contains("status=downloading"));
        assert!(log.contains("version=0.1.2"));
        assert!(log.contains("channel=nightly"));
        assert!(log.contains("detail=bytes_pending"));

        let snap = load_state_snapshot(&dir)
            .expect("load state")
            .expect("snapshot present");
        assert_eq!(snap.status, "downloading");
        assert_eq!(snap.step, "download_started");
        assert_eq!(snap.version.as_deref(), Some("0.1.2"));
        assert_eq!(snap.channel.as_deref(), Some("nightly"));
        assert_eq!(snap.detail.as_deref(), Some("bytes_pending"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn clear_snapshot_removes_state_file() {
        let dir = unique_temp_dir("clear");
        record_update_step(
            &dir,
            "installing",
            UpdateStep::HandoffSpawned,
            Some("1.0.0"),
            None,
            None,
            None,
        );
        assert!(updater_state_path(&dir).exists());
        clear_state_snapshot(&dir);
        assert!(!updater_state_path(&dir).exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_snapshot_returns_none_when_missing() {
        let dir = unique_temp_dir("missing");
        let snap = load_state_snapshot(&dir).expect("load");
        assert!(snap.is_none());
        fs::remove_dir_all(&dir).ok();
    }
}
