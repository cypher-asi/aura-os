//! System prompt + permissions assembly for the bare-agent chat
//! route. Wraps the agent template prompt with a project-aware
//! `<project_context>` block when the turn is project-bound, splices
//! self-project permission caps into the harness bundle, and folds
//! the project-state snapshot in on cold start.

use aura_os_core::{AgentPermissions, ProjectId};

use crate::dto::SendChatRequest;
use crate::handlers::projects_helpers::resolve_project_tool_workspace_path;
use crate::state::AppState;

use super::super::compaction::{
    append_project_state_to_system_prompt, load_project_state_snapshot,
};
use super::super::identity_preamble::build_identity_preamble;
use super::super::instance_route::build_project_system_prompt;
use super::super::persist::ChatPersistCtx;

/// Project-state continuity: on cold start, load a specs+tasks snapshot
/// for the project we're resolving the chat under so it can be appended
/// to the harness system prompt. Warm sessions keep whatever snapshot
/// was wired into the existing session, so we skip the fetch entirely.
pub(super) async fn load_project_state_for_agent(
    state: &AppState,
    body: &SendChatRequest,
    persist_ctx: &Option<ChatPersistCtx>,
    jwt: &str,
    force_new: bool,
    live_session: bool,
) -> Option<String> {
    if force_new || live_session {
        return None;
    }
    let snapshot_project_id = body
        .project_id
        .as_ref()
        .map(|project_id| project_id.to_string())
        .or_else(|| persist_ctx.as_ref().map(|ctx| ctx.project_id.clone()));
    match snapshot_project_id {
        Some(project_id) => load_project_state_snapshot(state, &project_id, jwt).await,
        None => None,
    }
}

/// When the turn is project-bound (either explicitly via the body or
/// implicitly via the persistence context), splice the self-project
/// `ReadProject` / `WriteProject` caps into the agent's normalized
/// bundle so the harness receives `SessionConfig.agent_permissions`
/// that let `visible_tools_with_permissions` expose the matching
/// project-scoped native tools.
pub(super) fn normalize_agent_perms(
    agent: &aura_os_core::Agent,
    effective_project_id: Option<&str>,
) -> AgentPermissions {
    let base_perms = agent
        .permissions
        .clone()
        .normalized_for_identity(&agent.name, Some(agent.role.as_str()));
    match effective_project_id {
        Some(pid) => base_perms.with_project_self_caps(pid),
        None => base_perms,
    }
}

/// Compose the system prompt + workspace path for the bare-agent
/// chat route, mirroring `instance_route::send_event_stream`'s
/// behaviour:
///
/// * If the turn is project-bound (explicit `body.project_id` or
///   inferred via the persistence context), wrap the agent
///   template prompt with the project-aware `<project_context>`
///   block via [`build_project_system_prompt`] and resolve the
///   workspace path so workspace tools see a real cwd.
/// * Otherwise fall back to the bare template prompt with no
///   workspace path (legacy bare-agent semantics).
///
/// In either case the project-state snapshot (specs / tasks
/// summary) is appended last, matching the instance route.
pub(super) async fn build_agent_system_prompt(
    state: &AppState,
    agent: &aura_os_core::Agent,
    effective_project_id: Option<&str>,
    harness_mode: aura_os_core::HarnessMode,
    project_state_snapshot: Option<&str>,
) -> (String, Option<String>) {
    // Restore parity with the harness-side task-execution path
    // (`build_agent_preamble`): the chat hot path used to forward only
    // `agent.system_prompt`, silently dropping personality / role /
    // skills on every interactive turn. The identity preamble lands
    // FIRST — before the `<project_context>` block — so the LLM reads
    // "who am I" before "what project am I operating in", matching the
    // ordering `agentic_execution_system_prompt` uses.
    let preamble =
        build_identity_preamble(&agent.name, &agent.role, &agent.personality, &agent.skills);
    let (base_prompt, project_path) = match effective_project_id
        .and_then(|pid| pid.parse::<ProjectId>().ok())
    {
        Some(project_id) => {
            // Bare-agent chats have no AgentInstanceId; fall back to
            // project-level workspace resolution (handles both
            // explicit `project.local_workspace_path` and the
            // canonical `data_dir`-rooted layout for Local /
            // Swarm).
            let project_path =
                resolve_project_tool_workspace_path(state, &project_id, harness_mode, None).await;
            let project_block = build_project_system_prompt(
                state,
                &project_id,
                &agent.system_prompt,
                project_path.as_deref(),
            );
            (format!("{preamble}{project_block}"), project_path)
        }
        None => (format!("{preamble}{}", agent.system_prompt), None),
    };
    let with_state = append_project_state_to_system_prompt(&base_prompt, project_state_snapshot);
    (with_state, project_path)
}
