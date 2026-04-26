//! Startup-time orphan-run reconciliation. Finds bundles still
//! `status: Running` from a previous process lifetime and flips them
//! to `Interrupted` so the Debug UI doesn't list them as live forever.

use std::path::Path;

use chrono::Utc;
use tracing::{debug, info};

use super::{read::render_summary, LoopLogWriter, RunMetadata, RunStatus};

impl LoopLogWriter {
    /// Walk every run bundle on disk and flip any metadata still stuck
    /// at `status: Running` to `Interrupted`. This exists because the
    /// only writer of a terminal status is `on_loop_ended`, which runs
    /// inside a tokio task spawned by the dev-loop handler. If the
    /// server crashes, is killed, or that task is aborted before it
    /// reaches the cleanup path, the bundle is left permanently
    /// "Running" on disk — which the Debug UI then surfaces in its
    /// "Running now" list forever.
    ///
    /// Call this once at startup, *before* handing the writer to
    /// `AppState` / routes. At that point the in-memory `run_state`
    /// is empty so any on-disk `Running` is by definition orphaned
    /// from a previous process lifetime.
    ///
    /// Kept synchronous so it composes with the sync `build_app_state`
    /// constructor without forcing every caller into an async runtime.
    /// The filesystem walk only touches bundle directories and rewrites
    /// a small JSON file per orphan, so blocking briefly on startup is
    /// fine.
    pub fn reconcile_orphan_runs(&self) -> usize {
        let mut reconciled = 0usize;
        let project_entries = match std::fs::read_dir(&self.base_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return 0,
            Err(error) => {
                debug!(
                    path = %self.base_dir.display(),
                    %error,
                    "loop_log: failed to scan base_dir during reconciliation",
                );
                return 0;
            }
        };

        for project_entry in project_entries.flatten() {
            let project_dir = project_entry.path();
            if !project_dir.is_dir() {
                continue;
            }
            let run_entries = match std::fs::read_dir(&project_dir) {
                Ok(entries) => entries,
                Err(error) => {
                    debug!(
                        path = %project_dir.display(),
                        %error,
                        "loop_log: failed to scan project dir during reconciliation",
                    );
                    continue;
                }
            };
            for run_entry in run_entries.flatten() {
                let run_dir = run_entry.path();
                if !run_dir.is_dir() {
                    continue;
                }
                match reconcile_one_run(&run_dir) {
                    Ok(true) => reconciled += 1,
                    Ok(false) => {}
                    Err(error) => debug!(
                        path = %run_dir.display(),
                        %error,
                        "loop_log: failed to reconcile orphan run",
                    ),
                }
            }
        }

        if reconciled > 0 {
            info!(
                reconciled,
                base_dir = %self.base_dir.display(),
                "loop_log: marked orphaned running runs as interrupted on startup",
            );
        }
        reconciled
    }
}

/// Reconcile a single run directory. Returns `Ok(true)` when the
/// metadata was actually rewritten (i.e. we flipped a `Running` to
/// `Interrupted`), `Ok(false)` when the bundle was already terminal
/// or had no metadata.json.
fn reconcile_one_run(run_dir: &Path) -> std::io::Result<bool> {
    let metadata_path = run_dir.join("metadata.json");
    let raw = match std::fs::read(&metadata_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let mut metadata: RunMetadata = match serde_json::from_slice(&raw) {
        Ok(meta) => meta,
        Err(error) => {
            debug!(
                path = %metadata_path.display(),
                %error,
                "loop_log: metadata.json unreadable during reconciliation",
            );
            return Ok(false);
        }
    };
    if metadata.status != RunStatus::Running {
        return Ok(false);
    }

    // Prefer the events.jsonl mtime as the "last observed activity"
    // timestamp — metadata.json is re-written on every event, so its
    // own mtime is effectively the same value, but events.jsonl is a
    // better fit when bundles exist without a recent metadata write.
    // Fall back to metadata.json, then to now().
    let ended_at = last_activity(run_dir).unwrap_or_else(Utc::now);

    metadata.status = RunStatus::Interrupted;
    if metadata.ended_at.is_none() {
        metadata.ended_at = Some(ended_at);
    }

    let body = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    std::fs::write(&metadata_path, body)?;

    // Backfill summary.md for anything that never reached `on_loop_ended`
    // so the Debug sidekick's summary tab isn't empty for interrupted
    // runs.
    let summary_path = run_dir.join("summary.md");
    if !summary_path.exists() {
        let summary = render_summary(&metadata);
        if let Err(error) = std::fs::write(&summary_path, summary) {
            debug!(
                path = %summary_path.display(),
                %error,
                "loop_log: failed to backfill summary.md during reconciliation",
            );
        }
    }

    info!(
        run_id = %metadata.run_id,
        project_id = %metadata.project_id,
        ended_at = %metadata.ended_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
        "loop_log: reconciled orphan run -> interrupted",
    );
    Ok(true)
}

/// Most recent modified-time across `events.jsonl` and `metadata.json`,
/// converted to UTC. Used to backfill `ended_at` for interrupted runs.
fn last_activity(run_dir: &Path) -> Option<chrono::DateTime<Utc>> {
    let mut best: Option<std::time::SystemTime> = None;
    for name in ["events.jsonl", "metadata.json"] {
        if let Ok(meta) = std::fs::metadata(run_dir.join(name)) {
            if let Ok(modified) = meta.modified() {
                best = Some(match best {
                    Some(current) if current >= modified => current,
                    _ => modified,
                });
            }
        }
    }
    best.map(chrono::DateTime::<Utc>::from)
}
