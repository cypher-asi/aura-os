//! Persisted "active run handle" files so a restarted server can
//! rediscover dev loops that are still running on the harness.
//!
//! The harness sidecar outlives aura-os-server restarts, but every
//! piece of state the UI uses to show a running loop
//! (`automaton_registry`, `loop_registry`, the event forwarder) is
//! in-memory and dies with the process. The result is a "headless"
//! loop: the harness keeps executing tasks while `/loop/status`
//! reports idle and no WS events reach the frontend.
//!
//! Each Automation run writes one small JSON file keyed by
//! `(project_id, agent_instance_id)` under
//! `{loop_log_base}/run_handles/`. On a `/loop/status` query with an
//! empty registry, [`find_detached_run`] probes the harness with the
//! persisted `automaton_id`; if the run is still alive the status
//! response reports `loop_state: "detached"` and the frontend
//! re-adopts via the ordinary `POST /loop/start` conflict path.
//!
//! Files are removed on explicit stop / displacement
//! (`abort_and_remove`), on forwarder teardown, and lazily whenever a
//! probe confirms the harness run is gone.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_harness::{HarnessLink, LocalHarness};

use crate::state::AppState;

use super::start::run_status_indicates_active;

/// On-disk pointer to a harness run this server (or a previous
/// incarnation of it) started for `(project_id, agent_instance_id)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct RunHandle {
    pub automaton_id: String,
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    /// Base URL the run was started against, so a probe after restart
    /// targets the same harness (local sidecar or swarm agent base).
    pub harness_base_url: String,
    pub saved_at: chrono::DateTime<chrono::Utc>,
}

fn handles_dir(state: &AppState) -> PathBuf {
    state.loop_log.base_dir().join("run_handles")
}

fn handle_path(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
) -> PathBuf {
    handles_dir(state).join(format!("{project_id}_{agent_instance_id}.json"))
}

/// Persist (or overwrite) the handle for an Automation run.
/// Best-effort: a write failure only costs restart-survivability,
/// never the run itself.
pub(super) fn save(state: &AppState, handle: &RunHandle) {
    let dir = handles_dir(state);
    if let Err(error) = std::fs::create_dir_all(&dir) {
        warn!(path = %dir.display(), %error, "run_handles: failed to create dir");
        return;
    }
    let path = handle_path(state, handle.project_id, handle.agent_instance_id);
    let body = match serde_json::to_vec_pretty(handle) {
        Ok(body) => body,
        Err(error) => {
            warn!(%error, "run_handles: failed to serialize handle");
            return;
        }
    };
    if let Err(error) = std::fs::write(&path, body) {
        warn!(path = %path.display(), %error, "run_handles: failed to write handle");
    }
}

/// Delete the handle for `(project_id, agent_instance_id)`
/// unconditionally. Used by explicit stop / displacement paths where
/// the caller owns the slot.
pub(super) fn remove(state: &AppState, project_id: ProjectId, agent_instance_id: AgentInstanceId) {
    let path = handle_path(state, project_id, agent_instance_id);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            debug!(path = %path.display(), %error, "run_handles: failed to remove handle");
        }
    }
}

/// Delete the handle only when it still points at `automaton_id`.
/// Used by forwarder teardown, which may fire for a displaced run
/// after a newer run has already re-saved the slot's handle.
pub(super) fn remove_matching(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) {
    let Some(handle) = read_handle(&handle_path(state, project_id, agent_instance_id)) else {
        return;
    };
    if handle.automaton_id == automaton_id {
        remove(state, project_id, agent_instance_id);
    }
}

/// All persisted handles for a project, in directory order.
pub(super) fn list_for_project(state: &AppState, project_id: ProjectId) -> Vec<RunHandle> {
    let entries = match std::fs::read_dir(handles_dir(state)) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    entries
        .flatten()
        .filter_map(|entry| read_handle(&entry.path()))
        .filter(|handle| handle.project_id == project_id)
        .collect()
}

fn read_handle(path: &std::path::Path) -> Option<RunHandle> {
    let raw = std::fs::read(path).ok()?;
    match serde_json::from_slice(&raw) {
        Ok(handle) => Some(handle),
        Err(error) => {
            debug!(path = %path.display(), %error, "run_handles: unreadable handle file");
            None
        }
    }
}

/// Find a harness run that is still alive but has no live registry
/// entry in this process — the "headless loop after server restart"
/// state. Probes `GET /v1/run/:id/status` for every persisted handle
/// in the project:
///
/// * probe says active and no registry slot → detached, return it
/// * probe says terminal → the handle is stale, delete it
/// * probe fails (harness unreachable) → keep the handle, report
///   nothing; the next status query retries
pub(super) async fn find_detached_run(
    state: &AppState,
    project_id: ProjectId,
) -> Option<RunHandle> {
    for handle in list_for_project(state, project_id) {
        let has_live_entry = state
            .automaton_registry
            .lock()
            .await
            .contains_key(&(project_id, handle.agent_instance_id));
        if has_live_entry {
            continue;
        }
        let client = LocalHarness::new(handle.harness_base_url.clone());
        match client.run_status(&handle.automaton_id, None).await {
            Ok(status) if run_status_indicates_active(&status) => {
                info!(
                    %project_id,
                    agent_instance_id = %handle.agent_instance_id,
                    automaton_id = %handle.automaton_id,
                    "run_handles: harness run is alive with no local forwarder (detached)"
                );
                return Some(handle);
            }
            Ok(_) => {
                debug!(
                    automaton_id = %handle.automaton_id,
                    "run_handles: harness run is terminal; dropping stale handle"
                );
                remove(state, project_id, handle.agent_instance_id);
            }
            Err(error) => {
                debug!(
                    automaton_id = %handle.automaton_id,
                    %error,
                    "run_handles: harness status probe failed; keeping handle for retry"
                );
            }
        }
    }
    None
}
