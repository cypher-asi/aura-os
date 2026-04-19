//! Auto-bind agents to a per-org "Home" project so their direct chats
//! can be persisted.
//!
//! Storage requires every chat session to live under a `project_agent`
//! row (`/api/project-agents/{id}/sessions`). A universe-scoped agent
//! template (including the CEO preset and any user-created agent
//! created via `POST /api/agents`) has no natural project home until
//! it gets explicitly assigned, which means its first chat turn would
//! fail with `chat_persist_unavailable`. This module provides the
//! shared helper that auto-creates (or reuses) a Home project in the
//! agent's org and creates the binding.
//!
//! Previously only the CEO bootstrap path did this (see
//! `handlers::agent_bootstrap::setup_ceo_agent`). This helper
//! generalizes the logic so:
//!
//! 1. `POST /api/agents` can call it after creating any new agent so
//!    chat "just works" out of the box.
//! 2. `setup_agent_chat_persistence` can call it lazily on first chat
//!    if the agent has no binding yet — this self-heals existing
//!    orphans on prod without any manual step.

use tracing::{info, warn};

use aura_os_core::Agent;

use crate::handlers::projects;
use crate::state::AppState;

/// Project name used for the auto-created Home project. A project
/// with this name is only treated as an auto-home if its description
/// also starts with [`AGENT_HOME_PROJECT_MARKER`] or the legacy
/// [`CEO_HOME_PROJECT_MARKER`], so a user-authored project literally
/// called "Home" never gets adopted.
pub(crate) const HOME_PROJECT_NAME: &str = "Home";

/// Current sentinel in the description of the auto-created Home
/// project. Applied to every newly created Home project going forward,
/// regardless of which agent triggered the creation.
pub(crate) const AGENT_HOME_PROJECT_MARKER: &str = "[aura:agent-home]";

/// Legacy sentinel kept for backward compatibility. Existing CEO-home
/// projects on prod were created with this prefix; the find step
/// matches either marker so we transparently reuse them instead of
/// creating a second Home project per org.
pub(crate) const CEO_HOME_PROJECT_MARKER: &str = "[aura:ceo-home]";

fn description_is_auto_home(description: &str) -> bool {
    description.starts_with(AGENT_HOME_PROJECT_MARKER)
        || description.starts_with(CEO_HOME_PROJECT_MARKER)
}

/// Ensure `agent` has at least one `project_agent` binding so chat can
/// be persisted. Safe to call more than once — if a binding already
/// exists the function is a cheap no-op.
///
/// Strategy:
/// 1. If any project in the agent's org already has a `project_agent`
///    row pointing at `agent.agent_id`, we're done.
/// 2. Otherwise, find an existing auto-home project in the agent's org
///    (matched by name + either home marker). This transparently reuses
///    the legacy `[aura:ceo-home]` project if one was already created.
/// 3. If none exists, create a new Home project tagged with
///    [`AGENT_HOME_PROJECT_MARKER`].
/// 4. Create a `project_agent` binding for the agent in that project.
///
/// Best-effort: every network/storage failure is logged and swallowed
/// so a transient error never blocks the calling request. Callers that
/// require the binding before proceeding (e.g. lazy repair in the chat
/// handler) should re-check for a binding after calling this helper.
pub(crate) async fn ensure_agent_home_project_and_binding(
    state: &AppState,
    jwt: &str,
    agent: &Agent,
) {
    let Some(storage) = state.storage_client.as_ref().cloned() else {
        warn!(
            agent_id = %agent.agent_id,
            "agent home: storage client not configured; skipping binding"
        );
        return;
    };
    let Some(network) = state.network_client.as_ref().cloned() else {
        warn!(
            agent_id = %agent.agent_id,
            "agent home: network client not configured; skipping binding"
        );
        return;
    };
    let Some(org_id) = agent.org_id.as_ref().map(|o| o.to_string()) else {
        warn!(
            agent_id = %agent.agent_id,
            "agent home: agent has no org_id; skipping binding"
        );
        return;
    };
    let agent_id_str = agent.agent_id.to_string();

    let all_projects = match projects::list_all_projects_from_network(state, jwt).await {
        Ok(p) => p,
        Err(e) => {
            warn!(
                error = ?e,
                %agent_id_str,
                "agent home: failed to list projects; skipping binding"
            );
            return;
        }
    };

    // Step 1: short-circuit if the agent already has a binding anywhere.
    for project in &all_projects {
        let pid = project.project_id.to_string();
        match storage.list_project_agents(&pid, jwt).await {
            Ok(agents) => {
                if agents
                    .iter()
                    .any(|a| a.agent_id.as_deref() == Some(&agent_id_str))
                {
                    info!(
                        %agent_id_str,
                        project_id = %pid,
                        "agent home: agent already bound to a project; nothing to do"
                    );
                    return;
                }
            }
            Err(e) => {
                warn!(
                    project_id = %pid,
                    error = %e,
                    %agent_id_str,
                    "agent home: failed to list project agents"
                );
            }
        }
    }

    // Step 2/3: find or create the Home project in the agent's org.
    let existing_home = all_projects.iter().find(|p| {
        p.org_id.to_string() == org_id
            && p.name == HOME_PROJECT_NAME
            && description_is_auto_home(&p.description)
    });
    let home_pid: String = match existing_home {
        Some(p) => {
            info!(
                project_id = %p.project_id,
                %agent_id_str,
                "agent home: reusing existing Home project"
            );
            p.project_id.to_string()
        }
        None => {
            let req = aura_os_network::CreateProjectRequest {
                name: HOME_PROJECT_NAME.to_string(),
                org_id: org_id.clone(),
                description: Some(format!(
                    "{AGENT_HOME_PROJECT_MARKER} Auto-created workspace so \
                     direct chats with universe-scoped agents have \
                     somewhere to persist. You can rename this project, \
                     but don't delete it or agent chat history will stop \
                     saving."
                )),
                folder: None,
                git_repo_url: None,
                git_branch: None,
                orbit_base_url: None,
                orbit_owner: None,
                orbit_repo: None,
            };
            match network.create_project(jwt, &req).await {
                Ok(p) => {
                    info!(
                        project_id = %p.id,
                        %org_id,
                        %agent_id_str,
                        "agent home: created Home project"
                    );
                    p.id
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        %agent_id_str,
                        "agent home: failed to create Home project; skipping binding"
                    );
                    return;
                }
            }
        }
    };

    // Step 4: create a project_agent binding for the agent in the Home
    // project. Mirrors the request shape used by the standard
    // `create_agent_instance` handler.
    let binding_req = aura_os_storage::CreateProjectAgentRequest {
        agent_id: agent_id_str.clone(),
        name: agent.name.clone(),
        org_id: agent.org_id.as_ref().map(|o| o.to_string()),
        role: Some(agent.role.clone()),
        personality: Some(agent.personality.clone()),
        system_prompt: Some(agent.system_prompt.clone()),
        skills: Some(agent.skills.clone()),
        icon: agent.icon.clone(),
        harness: None,
        permissions: Some(agent.permissions.clone()),
        intent_classifier: agent.intent_classifier.clone(),
    };
    match storage
        .create_project_agent(&home_pid, jwt, &binding_req)
        .await
    {
        Ok(binding) => info!(
            %agent_id_str,
            project_id = %home_pid,
            project_agent_id = %binding.id,
            "agent home: created project-agent binding"
        ),
        Err(e) => warn!(
            error = %e,
            %agent_id_str,
            project_id = %home_pid,
            "agent home: failed to create project-agent binding"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_new_agent_home_marker() {
        let desc = format!("{AGENT_HOME_PROJECT_MARKER} workspace");
        assert!(description_is_auto_home(&desc));
    }

    #[test]
    fn recognizes_legacy_ceo_home_marker() {
        // Existing prod deployments have a Home project created under
        // the CEO-specific marker. The find step must keep matching it
        // so we don't create a second Home project per org after this
        // change rolls out.
        let desc = format!("{CEO_HOME_PROJECT_MARKER} CEO workspace");
        assert!(description_is_auto_home(&desc));
    }

    #[test]
    fn rejects_user_authored_description() {
        assert!(!description_is_auto_home(
            "My personal workspace for side projects"
        ));
        assert!(!description_is_auto_home(""));
    }

    #[test]
    fn marker_only_counts_as_prefix() {
        // A marker embedded mid-description shouldn't trigger adoption
        // — only descriptions we wrote ourselves (prefix position) are
        // safe to claim as auto-home.
        let embedded = format!("user prose {AGENT_HOME_PROJECT_MARKER} suffix");
        assert!(!description_is_auto_home(&embedded));
    }
}
