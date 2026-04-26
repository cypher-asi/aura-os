use super::*;

/// Sweep `Executor`-role agent-instance rows that survived a previous
/// process. Ephemeral executors are normally torn down by the per-run
/// reaper inside `dev_loop::adapter::run_single_task`, but a server
/// crash between "registry cleared" and "storage deleted" — or between
/// allocation and the reaper spawning — would orphan a row. We sweep
/// once at startup so orphans don't accumulate across restarts. Best
/// effort: a missing JWT (fresh user, hasn't signed in) or a storage
/// outage degrades to a single warning and the next user-driven request
/// will still allocate fresh executors that the in-process reaper
/// cleans up.
pub(super) fn spawn_executor_janitor(
    project_service: Arc<ProjectService>,
    agent_instance_service: Arc<AgentInstanceService>,
) {
    tokio::spawn(async move {
        let projects = match project_service.list_projects() {
            Ok(projects) => projects,
            Err(error) => {
                tracing::debug!(
                    %error,
                    "executor-janitor: failed to list projects on boot; skipping orphan sweep"
                );
                return;
            }
        };
        let mut total_purged = 0usize;
        for project in &projects {
            match agent_instance_service
                .purge_executor_instances_in_project(&project.project_id)
                .await
            {
                Ok(0) => {}
                Ok(n) => {
                    total_purged += n;
                    tracing::info!(
                        project_id = %project.project_id,
                        purged = n,
                        "executor-janitor: reclaimed orphaned ephemeral executor rows"
                    );
                }
                Err(aura_os_agents::AgentError::NoSession) => {
                    tracing::debug!(
                        "executor-janitor: no JWT cached on boot; deferring sweep until first authenticated request"
                    );
                    return;
                }
                Err(error) => {
                    tracing::warn!(
                        project_id = %project.project_id,
                        %error,
                        "executor-janitor: skipping project after error; will retry on next boot"
                    );
                }
            }
        }
        if total_purged > 0 {
            tracing::info!(
                projects_scanned = projects.len(),
                purged = total_purged,
                "executor-janitor: startup sweep complete"
            );
        }
    });
}
