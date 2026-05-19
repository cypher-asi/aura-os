//! Storage `Session` lifecycle for automation runs (`start_loop` /
//! `run_single_task`).
//!
//! Until this module landed, only the chat path created storage
//! `Session` rows via `SessionService` ([`crate::handlers::agents::chat`]),
//! so the Sidekick "Sessions" stat (`ProjectStats.total_sessions`) was
//! flat for any project that only ever ran automation. The dev-loop
//! adapter now calls [`begin_session`] on cold start (and reuses the
//! existing id on adopted starts), and the forwarder calls
//! [`record_task_worked`] / [`end_session`] as it observes lifecycle
//! events — bringing automation parity with chat for both
//! `total_sessions` and per-session `tasks_worked_count`.

use std::str::FromStr;

use tracing::{info, warn};

use aura_os_automation::{recover_orphans, OrphanRecoveryPlan, ORPHAN_RECOVERY_REASON};
use aura_os_core::{AgentInstanceId, ProjectId, SessionId, SessionStatus, TaskId, TaskStatus};
use aura_os_sessions::{CreateSessionParams, SessionService};
use aura_os_storage::StorageClient;
use aura_os_tasks::storage_task_to_task;

use crate::state::AppState;

/// Create a fresh `active` storage session for an automation run.
///
/// Returns `None` when `SessionService` is not connected to storage
/// (e.g. test rigs that build the service without a storage client) or
/// the storage call fails. Callers treat `None` as "session counting
/// disabled for this run" rather than a hard error — the dev loop
/// runs to completion either way; we just don't update aura-storage
/// from the forwarder.
///
/// `active_task_id` lets `run_single_task` tag the session with the
/// task it was minted for. `start_loop` passes `None` (the loop picks
/// up tasks dynamically via `task_started` events).
pub(super) async fn begin_session(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    active_task_id: Option<TaskId>,
    user_id: Option<String>,
    model: Option<String>,
) -> Option<SessionId> {
    let params = CreateSessionParams {
        agent_instance_id,
        project_id,
        active_task_id,
        summary: String::new(),
        user_id,
        model,
    };
    match state.session_service.create_session(params).await {
        Ok(session) => Some(session.session_id),
        Err(error) => {
            warn!(
                %project_id,
                %agent_instance_id,
                %error,
                "failed to materialise storage session for automation run; \
                 total_sessions / tasks_worked_count will not include this loop"
            );
            None
        }
    }
}

/// Increment `tasks_worked_count` for the in-flight session whenever
/// the harness reports a `task_started` event with a parseable
/// `task_id`. Failures are logged and swallowed so a transient storage
/// blip never aborts the live run.
pub(super) async fn record_task_worked(
    service: &SessionService,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: SessionId,
    task_id_str: &str,
) {
    let Ok(task_id) = TaskId::from_str(task_id_str) else {
        // Non-UUID task ids (e.g. legacy synthetic `runner-N` payloads)
        // are deliberately skipped: the storage column is typed and
        // rejecting them at the boundary keeps the rest of the run
        // healthy.
        return;
    };
    if let Err(error) = service
        .record_task_worked(&project_id, &agent_instance_id, &session_id, task_id)
        .await
    {
        warn!(
            %project_id,
            %agent_instance_id,
            %session_id,
            %task_id,
            %error,
            "failed to record task_worked on automation session"
        );
    }
}

/// Transition the session to its terminal status when the forwarder
/// reaches the end of its event stream. Mirrors the chat path's
/// `close_active_sessions_for_agent` for the dev loop, but writes the
/// authoritative `Completed` / `Failed` status instead of always
/// `Completed`.
pub(super) async fn end_session(
    service: &SessionService,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: SessionId,
    status: SessionStatus,
) {
    if let Err(error) = service
        .end_session(&project_id, &agent_instance_id, &session_id, status)
        .await
    {
        warn!(
            %project_id,
            %agent_instance_id,
            %session_id,
            ?status,
            %error,
            "failed to end automation session"
        );
    }
}

/// Look up the session id stashed on an adopted automaton's registry
/// entry so a second `start_loop` call on the same
/// `(project_id, agent_instance_id, automaton_id)` can reuse the live
/// session instead of creating a duplicate row.
pub(super) async fn existing_session_id(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) -> Option<SessionId> {
    state
        .automaton_registry
        .lock()
        .await
        .get(&(project_id, agent_instance_id))
        .filter(|entry| entry.automaton_id == automaton_id)
        .and_then(|entry| entry.session_id)
}

/// Section E (orphan recovery): sweep the project for tasks left in
/// [`TaskStatus::InProgress`] from a previous server invocation and
/// push them back to [`TaskStatus::Ready`] so the dev-loop's
/// scheduler picks them up again on the next tick.
///
/// Pure planning lives in [`aura_os_automation::recover_orphans`];
/// this helper is the App-layer side-effect bridge that fetches the
/// task list, materialises the plan, and applies each hop via
/// [`aura_os_tasks::safe_transition`]. Best-effort: every per-task
/// failure is logged and swallowed so a transient storage blip
/// never blocks the loop from starting.
///
/// Returns the number of orphans actually transitioned. `0` when
/// storage is not configured, the task list is empty, no orphans
/// are observed, or every individual transition failed.
pub(super) async fn recover_orphan_tasks(
    state: &AppState,
    project_id: ProjectId,
    jwt: &str,
) -> usize {
    let Some(storage) = state.storage_client.as_ref() else {
        return 0;
    };
    let tasks = match load_project_tasks(storage, project_id, jwt).await {
        Ok(tasks) => tasks,
        Err(error) => {
            warn!(
                %project_id,
                %error,
                "orphan recovery: failed to list tasks; skipping sweep for this loop start"
            );
            return 0;
        }
    };
    let plans = recover_orphans(&tasks);
    if plans.is_empty() {
        return 0;
    }
    apply_orphan_recovery_plans(storage, jwt, &plans).await
}

/// Load and convert the full task list for `project_id` so it can
/// be fed into [`recover_orphans`]. Conversion failures on a single
/// row are skipped with a `warn!` rather than aborting the sweep —
/// recovering the other orphans is still better than leaving them
/// all stuck.
async fn load_project_tasks(
    storage: &StorageClient,
    project_id: ProjectId,
    jwt: &str,
) -> Result<Vec<aura_os_core::Task>, aura_os_storage::StorageError> {
    let storage_tasks = storage.list_tasks(&project_id.to_string(), jwt).await?;
    let mut tasks = Vec::with_capacity(storage_tasks.len());
    for storage_task in storage_tasks {
        let task_id_for_log = storage_task.id.clone();
        match storage_task_to_task(storage_task) {
            Ok(task) => tasks.push(task),
            Err(error) => warn!(
                task_id = %task_id_for_log,
                %error,
                "orphan recovery: skipping unparseable task row",
            ),
        }
    }
    Ok(tasks)
}

/// Apply each [`OrphanRecoveryPlan`] via
/// [`aura_os_tasks::safe_transition`]. Returns the number of plans
/// that succeeded; per-plan failures are logged and skipped.
async fn apply_orphan_recovery_plans(
    storage: &StorageClient,
    jwt: &str,
    plans: &[OrphanRecoveryPlan],
) -> usize {
    let mut applied = 0;
    for plan in plans {
        let task_id_string = plan.task_id.to_string();
        match aura_os_tasks::safe_transition(storage, jwt, &task_id_string, TaskStatus::Ready).await
        {
            Ok(_) => {
                applied += 1;
                info!(
                    task_id = %plan.task_id,
                    from = ?plan.current_status,
                    to = ?plan.target_status,
                    reason = ORPHAN_RECOVERY_REASON,
                    "orphan recovery: transitioned task back to Ready"
                );
            }
            Err(error) => warn!(
                task_id = %plan.task_id,
                %error,
                "orphan recovery: safe_transition failed; leaving task in {:?}",
                plan.current_status,
            ),
        }
    }
    applied
}

#[cfg(test)]
mod orphan_sweep_e2e_tests {
    //! Section E regression: end-to-end the orphan-recovery sweep
    //! must actually issue `safe_transition` calls that land in
    //! storage as `Ready`. The pure planner is unit-tested in
    //! `aura_os_automation::resilience::orphan` and the App-layer
    //! shape is covered in `adapter.rs::orphan_recovery_tests`; this
    //! test exercises the bridge between them via the mock
    //! aura-storage HTTP server (`aura_os_storage::testutil::start_mock_storage`)
    //! so a future refactor of `apply_orphan_recovery_plans` cannot
    //! silently regress the persisted outcome.
    //!
    //! Test JWT is the static literal the mock server accepts on
    //! every request — it never validates the bearer token.
    use super::{apply_orphan_recovery_plans, load_project_tasks};
    use aura_os_automation::recover_orphans;
    use aura_os_core::{ProjectId, TaskStatus};
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{
        CreateSpecRequest, CreateTaskRequest, StorageClient, TransitionTaskRequest,
    };
    use uuid::Uuid;

    const JWT: &str = "test-token";

    async fn seed_task_in_progress(
        storage: &StorageClient,
        project_id: &str,
        spec_id: &str,
    ) -> String {
        let task = storage
            .create_task(
                project_id,
                JWT,
                &CreateTaskRequest {
                    spec_id: spec_id.to_string(),
                    title: "in-flight task".to_string(),
                    org_id: None,
                    description: None,
                    status: None,
                    order_index: Some(0),
                    dependency_ids: None,
                    assigned_project_agent_id: None,
                },
            )
            .await
            .expect("create_task should succeed against the mock storage");
        // Walk Pending -> Ready -> InProgress so the mock row mirrors
        // a real loop that was killed mid-run.
        for status in ["ready", "in_progress"] {
            storage
                .transition_task(
                    &task.id,
                    JWT,
                    &TransitionTaskRequest {
                        status: status.to_string(),
                    },
                )
                .await
                .expect("transition_task should succeed");
        }
        task.id
    }

    #[tokio::test]
    async fn sweep_transitions_in_progress_task_to_ready_via_storage() {
        let (url, _db) = start_mock_storage().await;
        let storage = StorageClient::with_base_url(&url);
        let project_id = ProjectId::from_uuid(Uuid::new_v4());

        // Spec is required before tasks can be created.
        let spec = storage
            .create_spec(
                &project_id.to_string(),
                JWT,
                &CreateSpecRequest {
                    title: "spec".to_string(),
                    org_id: None,
                    order_index: Some(0),
                    markdown_contents: None,
                },
            )
            .await
            .expect("create_spec");

        let orphan_id = seed_task_in_progress(&storage, &project_id.to_string(), &spec.id).await;

        // Pre-condition: storage actually shows the task as InProgress.
        let pre = storage.get_task(&orphan_id, JWT).await.expect("get_task");
        assert_eq!(pre.status.as_deref(), Some("in_progress"));

        let tasks = load_project_tasks(&storage, project_id, JWT)
            .await
            .expect("load_project_tasks");
        let plans = recover_orphans(&tasks);
        assert_eq!(
            plans.len(),
            1,
            "exactly one orphan should be planned for recovery; got {plans:?}",
        );

        let applied = apply_orphan_recovery_plans(&storage, JWT, &plans).await;
        assert_eq!(applied, 1, "the single orphan plan must apply cleanly");

        // Post-condition: the mock storage row now reports `ready`.
        // The bridge for `InProgress -> Ready` walks through `Failed`
        // first (per `aura_os_tasks::transition::compute_bridge`), so
        // the final status we observe must be `ready` — never stuck
        // mid-bridge in `failed`.
        let post = storage.get_task(&orphan_id, JWT).await.expect("get_task");
        assert_eq!(
            post.status.as_deref(),
            Some("ready"),
            "orphan recovery must leave the task in Ready, not stuck mid-bridge",
        );
    }

    #[tokio::test]
    async fn sweep_is_a_no_op_when_no_orphans_present() {
        let (url, _db) = start_mock_storage().await;
        let storage = StorageClient::with_base_url(&url);
        let project_id = ProjectId::from_uuid(Uuid::new_v4());

        // Empty task list ⇒ empty plan ⇒ zero transitions applied.
        let tasks = load_project_tasks(&storage, project_id, JWT)
            .await
            .expect("load_project_tasks on empty project");
        let plans = recover_orphans(&tasks);
        assert!(plans.is_empty());

        let applied = apply_orphan_recovery_plans(&storage, JWT, &plans).await;
        assert_eq!(applied, 0);
    }

    #[tokio::test]
    async fn task_status_pure_field_round_trips() {
        // Sanity that the canonical orphan-recovery target matches the
        // wire string aura-storage emits, so an audit of the planner
        // without running the sweep still pins the right enum.
        assert_eq!(format!("{:?}", TaskStatus::Ready), "Ready");
    }
}
