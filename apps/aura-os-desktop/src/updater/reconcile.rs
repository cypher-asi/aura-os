//! Boot-time reconciliation of the persisted updater state.
//!
//! Every install attempt writes its progress to
//! `<data_dir>/updater-state.json` via [`super::diagnostics`]. When Aura
//! relaunches (either after a successful update or after the install
//! aborted), we read that snapshot and decide whether to:
//!
//! * Mark the install as a success (the running binary now matches the
//!   persisted target version) and clear the snapshot.
//! * Surface the previous failure to the UI so the user sees *why* the
//!   last install attempt did not complete instead of a silent reset.

use std::time::{SystemTime, UNIX_EPOCH};

use tracing::{info, warn};

use super::diagnostics::{
    clear_state_snapshot, load_state_snapshot, record_update_step, PersistedUpdateState,
    UpdateStep,
};
use super::{set_status, UpdateState, UpdateStatus};

/// How long an install attempt may stay in a non-terminal step before we
/// declare it stalled. 30 minutes leaves enough headroom for slow downloads
/// and Windows installer wizards while still catching truly stuck states.
const STALE_THRESHOLD_MS: u64 = 30 * 60 * 1000;

/// Statuses that are still "in flight" — finding one in the snapshot means
/// the previous Aura instance died mid-install. Any other persisted status
/// (`up_to_date`, `failed`, `idle`, `available`) is informational and
/// requires no reconciliation action beyond a log line.
fn is_in_flight(status: &str) -> bool {
    matches!(status, "checking" | "downloading" | "installing")
}

/// Read the persisted state and apply the appropriate reconciliation. Safe
/// to call before any other updater work — never blocks longer than a
/// handful of disk reads.
pub(crate) fn reconcile_persisted_state(state: &UpdateState, current_version: &str) {
    let snapshot = match load_state_snapshot(state.data_dir.as_ref()) {
        Ok(Some(snap)) => snap,
        Ok(None) => return,
        Err(error) => {
            warn!(%error, "failed to load persisted updater state; skipping reconcile");
            return;
        }
    };

    if let Some(version) = snapshot.version.as_deref() {
        if version == current_version {
            // The running binary matches the version we were trying to
            // install — treat that as a success even if the previous
            // process exited before logging `process_exit_called`.
            info!(version = %version, "reconciled completed update");
            set_status(&state.status, UpdateStatus::UpToDate);
            record_update_step(
                state.data_dir.as_ref(),
                "up_to_date",
                UpdateStep::ReconcileSuccess,
                Some(version),
                snapshot.channel.as_deref(),
                None,
                Some(&format!(
                    "previous_step={} previous_status={}",
                    snapshot.step, snapshot.status
                )),
            );
            clear_state_snapshot(state.data_dir.as_ref());
            return;
        }
    }

    if is_in_flight(&snapshot.status) {
        // Previous install was mid-flight when Aura died.
        let stalled = is_stalled(&snapshot);
        let last_step = snapshot.step.clone();
        let detail = stalled_detail(&snapshot, stalled);
        warn!(
            previous_status = %snapshot.status,
            previous_step = %last_step,
            stalled,
            "previous update attempt did not complete; surfacing failure"
        );
        set_status(
            &state.status,
            UpdateStatus::Failed {
                error: format!(
                    "Previous update attempt did not complete (stopped at step '{last_step}'). \
                     Open Settings → About → Reveal updater logs for details."
                ),
                last_step: Some(last_step),
            },
        );
        record_update_step(
            state.data_dir.as_ref(),
            "failed",
            UpdateStep::ReconcileTimeout,
            snapshot.version.as_deref(),
            snapshot.channel.as_deref(),
            snapshot.error.as_deref(),
            Some(&detail),
        );
        // Intentionally keep the snapshot file so subsequent restarts still
        // surface the failure until the user explicitly retries.
    }
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_stalled(snapshot: &PersistedUpdateState) -> bool {
    let elapsed = now_unix_ms().saturating_sub(snapshot.ts_unix_ms);
    elapsed >= STALE_THRESHOLD_MS
}

fn stalled_detail(snapshot: &PersistedUpdateState, stalled: bool) -> String {
    let elapsed_ms = now_unix_ms().saturating_sub(snapshot.ts_unix_ms);
    format!(
        "previous_status={} previous_step={} elapsed_ms={} stalled={}",
        snapshot.status, snapshot.step, elapsed_ms, stalled
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(status: &str, step: UpdateStep, version: Option<&str>) -> PersistedUpdateState {
        PersistedUpdateState {
            status: status.to_string(),
            version: version.map(str::to_string),
            channel: Some("nightly".into()),
            error: None,
            step: step.as_str().to_string(),
            detail: None,
            ts_unix_ms: now_unix_ms(),
        }
    }

    #[test]
    fn in_flight_set_matches_active_statuses() {
        assert!(is_in_flight("checking"));
        assert!(is_in_flight("downloading"));
        assert!(is_in_flight("installing"));
        assert!(!is_in_flight("up_to_date"));
        assert!(!is_in_flight("failed"));
        assert!(!is_in_flight("idle"));
        assert!(!is_in_flight("available"));
    }

    #[test]
    fn stalled_detail_includes_step_and_status() {
        let snap = snapshot("installing", UpdateStep::HandoffSpawned, Some("1.2.3"));
        let detail = stalled_detail(&snap, true);
        assert!(detail.contains("previous_status=installing"));
        assert!(detail.contains("previous_step=handoff_spawned"));
        assert!(detail.contains("stalled=true"));
    }

    #[test]
    fn old_snapshot_is_stalled() {
        let mut snap = snapshot("installing", UpdateStep::HandoffSpawned, Some("1.2.3"));
        snap.ts_unix_ms = snap.ts_unix_ms.saturating_sub(STALE_THRESHOLD_MS + 1);
        assert!(is_stalled(&snap));
    }

    #[test]
    fn fresh_snapshot_is_not_stalled() {
        let snap = snapshot("installing", UpdateStep::HandoffSpawned, Some("1.2.3"));
        assert!(!is_stalled(&snap));
    }
}
