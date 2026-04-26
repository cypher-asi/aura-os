use aura_os_core::ProjectId;

/// Compute a workspace path hint for an agent instance.
///
/// For **local** agents the server is the authority. Resolution order:
///   1. `agent_local_path` — per-agent override from the agent template shadow.
///   2. `project_local_path` — per-project override from the project shadow.
///   3. `{data_dir}/workspaces/{project_id}` — canonical default.
///
/// For **remote / swarm** agents the harness is the authoritative source (via
/// `AutomatonClient::resolve_workspace`). This function returns a best-guess
/// hint using the same slug convention so that API responses are consistent
/// even before the harness has been queried. Callers that need the true path
/// (dev loop, task runner) should call `resolve_workspace` on the client.
pub(crate) fn resolve_workspace_path(
    machine_type: &str,
    project_id: &ProjectId,
    data_dir: &std::path::Path,
    project_name: &str,
    project_local_path: Option<&str>,
    agent_local_path: Option<&str>,
) -> String {
    fn non_empty(value: Option<&str>) -> Option<&str> {
        value.map(str::trim).filter(|s| !s.is_empty())
    }

    if machine_type == "local" {
        if let Some(path) = non_empty(agent_local_path) {
            return path.to_string();
        }
        if let Some(path) = non_empty(project_local_path) {
            return path.to_string();
        }
        crate::handlers::projects_helpers::canonical_workspace_path(data_dir, project_id)
            .to_string_lossy()
            .to_string()
    } else {
        let slug = crate::handlers::projects_helpers::slugify(project_name);
        format!("/home/aura/{slug}")
    }
}
