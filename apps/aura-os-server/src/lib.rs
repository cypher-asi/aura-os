mod app_builder;
mod auth_guard;
mod billing_bridge;
pub(crate) mod channel_ext;
pub(crate) mod dto;
pub(crate) mod error;
pub mod handlers;
pub mod harness_client;
pub(crate) mod harness_gateway;
pub mod harness_super_agent_driver;
mod network_bridge;

pub(crate) mod persistence;
pub(crate) mod router;
pub(crate) mod state;
pub mod super_agent_migration;
pub mod super_agent_migration_seed;

pub use app_builder::build_app_state;
pub use harness_client::{
    bearer_headers, GetHeadResponse, HarnessClient, HarnessClientError, HarnessProbeResult,
    HarnessTxKind, SubmitTxResponse,
};
pub use harness_gateway::HarnessHttpGateway;
pub use harness_super_agent_driver::{
    preview_installed_tools, preview_intent_classifier_spec, preview_session_init,
    HarnessSuperAgentConfig, HarnessSuperAgentDriver, HarnessSuperAgentError,
    HarnessSuperAgentSession,
};
pub use router::{build_local_api_cors_layer, create_router_with_interface};
pub use state::{ActiveAutomaton, AppState, CachedSession, SuperAgentRun};
pub use super_agent_migration::{
    migrate_legacy_super_agents, MigrationError, MigrationReport,
};
pub use super_agent_migration_seed::{
    seed_harness_record_log, SeedError, SeedReport,
};

/// Discover common user-level binary directories (pip `--user` scripts, `~/.local/bin`,
/// etc.) and append any that exist but are missing from `PATH`.  Call once at startup
/// so child processes (the harness, terminals) inherit the augmented `PATH` and can
/// find CLI tools installed via `pip install --user` or `uv tool install`.
pub fn ensure_user_bins_on_path() {
    use std::path::PathBuf;

    let mut extra: Vec<PathBuf> = Vec::new();

    // ~/.local/bin  (uv tool install, pipx, pip --user on Linux/macOS)
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".local").join("bin");
        if p.is_dir() {
            extra.push(p);
        }
    }

    #[cfg(windows)]
    {
        // Microsoft Store Python: %LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.*\…\Scripts
        if let Some(local) = dirs::data_local_dir() {
            let packages = local.join("Packages");
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    if !entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("PythonSoftwareFoundation.Python.3")
                    {
                        continue;
                    }
                    let base = entry.path().join("LocalCache").join("local-packages");
                    if let Ok(inner) = std::fs::read_dir(&base) {
                        for ie in inner.flatten() {
                            if ie.file_name().to_string_lossy().starts_with("Python3") {
                                let s = ie.path().join("Scripts");
                                if s.is_dir() {
                                    extra.push(s);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Standard pip --user: %APPDATA%\Python\Python3*\Scripts
        if let Some(roaming) = dirs::config_dir() {
            let python_dir = roaming.join("Python");
            if let Ok(entries) = std::fs::read_dir(&python_dir) {
                for entry in entries.flatten() {
                    let s = entry.path().join("Scripts");
                    if s.is_dir() {
                        extra.push(s);
                    }
                }
            }
        }
    }

    if extra.is_empty() {
        return;
    }

    let current = std::env::var_os("PATH").unwrap_or_default();
    let existing: std::collections::HashSet<PathBuf> = std::env::split_paths(&current).collect();

    let new_dirs: Vec<&PathBuf> = extra.iter().filter(|d| !existing.contains(*d)).collect();
    if new_dirs.is_empty() {
        return;
    }

    let mut all: Vec<PathBuf> = std::env::split_paths(&current).collect();
    for d in &new_dirs {
        tracing::debug!(path = %d.display(), "Appending user binary directory to PATH");
        all.push(d.to_path_buf());
    }
    if let Ok(joined) = std::env::join_paths(&all) {
        std::env::set_var("PATH", &joined);
    }
}

pub mod handlers_test_support {
    use aura_os_core::{AgentId, AgentInstanceId, SessionEvent};
    use aura_os_link::ConversationMessage;
    use aura_os_storage::StorageSessionEvent;

    use crate::state::AppState;

    pub fn events_to_session_history_pub(
        events: &[StorageSessionEvent],
        project_agent_id: &str,
        project_id: &str,
    ) -> Vec<SessionEvent> {
        crate::handlers::agents::conversions_pub::events_to_session_history(
            events,
            project_agent_id,
            project_id,
        )
    }

    pub fn session_events_to_conversation_history_pub(
        events: &[SessionEvent],
    ) -> Vec<ConversationMessage> {
        crate::handlers::agents::chat_pub::session_events_to_conversation_history(events)
    }

    pub fn session_events_to_super_agent_history_pub(
        events: &[SessionEvent],
    ) -> Vec<serde_json::Value> {
        crate::handlers::agents::chat_pub::session_events_to_super_agent_history(events)
    }

    pub async fn load_current_session_events_for_agent_pub(
        state: &AppState,
        agent_id: &AgentId,
        jwt: &str,
    ) -> Vec<SessionEvent> {
        crate::handlers::agents::chat_pub::load_current_session_events_for_agent(
            state, agent_id, jwt,
        )
        .await
    }

    pub async fn load_current_session_events_for_instance_pub(
        state: &AppState,
        agent_instance_id: &AgentInstanceId,
        jwt: &str,
    ) -> Result<Vec<SessionEvent>, aura_os_storage::StorageError> {
        crate::handlers::agents::chat_pub::load_current_session_events_for_instance(
            state,
            agent_instance_id,
            jwt,
        )
        .await
    }

    pub fn build_project_system_prompt_for_test(
        project_id: &str,
        name: &str,
        description: &str,
        agent_prompt: &str,
    ) -> String {
        let mut ctx = format!(
            "<project_context>\nproject_id: {}\nproject_name: {}\n",
            project_id, name,
        );
        if !description.is_empty() {
            ctx.push_str(&format!("description: {}\n", description));
        }
        ctx.push_str("</project_context>\n\n");
        ctx.push_str(
            "IMPORTANT: When calling tools that accept a project_id parameter, \
             always use the project_id from the project_context above.\n\n",
        );
        format!("{}{}", ctx, agent_prompt)
    }
}
