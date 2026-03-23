//! Session-init payload for the agent runtime (R9/R10).
//!
//! When the server connects to a runtime WebSocket (e.g. `/stream`), it sends a `session_init`
//! message once after connect. For projects with an Orbit link, the payload includes
//! `workspace.git_repo_url` and `workspace.git_branch` so the runtime can clone the repo.
//! The runtime is given the user's JWT (same zero-auth token as Aura) for Orbit Git HTTP auth.
//!
//! **Where this is used:** The message-streaming path currently goes through
//! `handlers::agents::send_message_stream` to the LLM. When a separate runtime WebSocket
//! is introduced, the code that establishes the session should build the payload with
//! `build_session_init_payload(project, jwt)` and send it as the first message.
//! See `docs/aura-runtime-requirements.md` R9, R10.

use serde::{Deserialize, Serialize};

use aura_os_core::Project;

/// Workspace config for session_init. When present, the runtime clones the repo into its workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct SessionInitWorkspace {
    pub git_repo_url: String,
    pub git_branch: String,
}

/// Payload for the `session_init` message sent to the runtime after WebSocket connect.
/// Aligns with R9/R10 in docs/aura-runtime-requirements.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct SessionInitPayload {
    #[serde(rename = "type")]
    pub message_type: String,
    /// Optional; when set, runtime clones this repo into workspace before session_ready.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<SessionInitWorkspace>,
    /// Optional; passed to runtime for Orbit Git HTTP auth (clone/push). Same JWT as Aura.
    /// Runtime must not log or persist. Env or credential helper can carry it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orbit_jwt: Option<String>,
}

/// Build a session_init payload for the given project and optional JWT.
/// When the project has `git_repo_url` and `git_branch`, sets `workspace` so the runtime
/// can clone the repo. Pass `jwt` when the runtime needs to authenticate to Orbit for Git.
pub(crate) fn build_session_init_payload(
    project: &Project,
    orbit_jwt: Option<&str>,
) -> SessionInitPayload {
    let workspace = match (&project.git_repo_url, &project.git_branch) {
        (Some(url), Some(branch)) if !url.is_empty() => Some(SessionInitWorkspace {
            git_repo_url: url.clone(),
            git_branch: branch.clone(),
        }),
        (Some(url), None) if !url.is_empty() => Some(SessionInitWorkspace {
            git_repo_url: url.clone(),
            git_branch: "main".to_string(),
        }),
        _ => None,
    };

    SessionInitPayload {
        message_type: "session_init".to_string(),
        workspace,
        orbit_jwt: orbit_jwt.map(String::from),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{OrgId, ProjectId, ProjectStatus};
    use chrono::Utc;

    fn project_without_git() -> Project {
        Project {
            project_id: ProjectId::new(),
            org_id: OrgId::new(),
            name: "Test".into(),
            description: String::new(),
            linked_folder_path: "/tmp/x".into(),
            workspace_source: None,
            workspace_display_path: None,
            requirements_doc_path: None,
            current_status: ProjectStatus::Active,
            build_command: None,
            test_command: None,
            specs_summary: None,
            specs_title: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            git_repo_url: None,
            git_branch: None,
            orbit_base_url: None,
            orbit_owner: None,
            orbit_repo: None,
        }
    }

    #[test]
    fn payload_omits_workspace_when_no_git() {
        let p = project_without_git();
        let payload = build_session_init_payload(&p, None);
        assert_eq!(payload.message_type, "session_init");
        assert!(payload.workspace.is_none());
        assert!(payload.orbit_jwt.is_none());
    }

    #[test]
    fn payload_includes_workspace_when_git_set() {
        let mut p = project_without_git();
        p.git_repo_url = Some("https://orbit.example/org/repo.git".into());
        p.git_branch = Some("main".into());
        let payload = build_session_init_payload(&p, Some("jwt-token"));
        assert!(payload.workspace.is_some());
        let w = payload.workspace.unwrap();
        assert_eq!(w.git_repo_url, "https://orbit.example/org/repo.git");
        assert_eq!(w.git_branch, "main");
        assert_eq!(payload.orbit_jwt.as_deref(), Some("jwt-token"));
    }

    #[test]
    fn payload_defaults_branch_to_main() {
        let mut p = project_without_git();
        p.git_repo_url = Some("https://x/y.git".into());
        p.git_branch = None;
        let payload = build_session_init_payload(&p, None);
        assert!(payload.workspace.is_some());
        assert_eq!(payload.workspace.as_ref().unwrap().git_branch, "main");
    }
}
