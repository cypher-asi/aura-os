//! Permissions + project-state continuity helpers for the bare-agent
//! chat route. The chat-WS migration moved the system-prompt assembly
//! into the harness's `SystemPromptBuilder`; this module now only
//! carries the helpers the route still needs server-side
//! (project-state snapshot fetch, agent permission normalisation, and
//! workspace-path resolution for the typed `project_info` wire field).

use std::path::Path;

use aura_os_core::{AgentPermissions, ProjectId};

use crate::dto::SendChatRequest;
use crate::error::ApiResult;
use crate::handlers::projects_helpers::resolve_project_tool_workspace_path;
use crate::state::AppState;
use crate::workspace_index::build_workspace_index_block;

use super::super::compaction::load_project_state_snapshot;
use super::super::persist::ChatPersistCtx;
use super::super::typed_session::{
    build_typed_session_fields, TypedProjectInputs, TypedSessionFields, TypedSessionInputs,
};

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

/// Normalize the agent's persisted permission bundle for a chat
/// session. Splices the subagent caps (`SpawnAgent` + `ReadAgent`) so
/// every chat agent can fan a turn out into foreground subagents (the
/// harness only surfaces `task` / `spawn_agent` when the bundle
/// satisfies `SpawnAgent`). When the turn is project-bound (either
/// explicitly via the body or implicitly via the persistence context),
/// also splice the self-project `ReadProject` / `WriteProject` caps so
/// the harness receives `SessionConfig.agent_permissions` that let
/// `visible_tools_with_permissions` expose the matching project-scoped
/// native tools.
pub(super) fn normalize_agent_perms(
    agent: &aura_os_core::Agent,
    effective_project_id: Option<&str>,
) -> AgentPermissions {
    let base_perms = agent
        .permissions
        .clone()
        .normalized_for_identity(&agent.name, Some(agent.role.as_str()))
        .with_subagent_caps();
    match effective_project_id {
        Some(pid) => base_perms.with_project_self_caps(pid),
        None => base_perms,
    }
}

/// Compose the typed wire-field bundle + workspace path for the
/// bare-agent chat route, mirroring `instance_route::send_event_stream`:
///
/// * If the turn is project-bound (explicit `body.project_id` or
///   inferred via the persistence context), resolve the workspace
///   path so the harness can render `<project_context>` and the
///   workspace tools see a real cwd.
/// * Otherwise the helper produces typed fields with `project_info =
///   None`, matching legacy bare-agent semantics (no project block).
///
/// In either case the project-state snapshot (specs / tasks summary)
/// and plan-mode suffix are folded into `agent_system_prompt` by the
/// shared `build_typed_session_fields` helper, matching the instance
/// route's behaviour.
pub(super) async fn build_agent_session_fields(
    state: &AppState,
    agent: &aura_os_core::Agent,
    effective_project_id: Option<&str>,
    harness_mode: aura_os_core::HarnessMode,
    project_state_snapshot: Option<&str>,
    plan_mode: bool,
) -> ApiResult<(TypedSessionFields, Option<String>)> {
    let project = effective_project_id.and_then(|pid| pid.parse::<ProjectId>().ok());

    let project_path = match project.as_ref() {
        Some(project_id) => {
            // Bare-agent chats have no AgentInstanceId; fall back to
            // project-level workspace resolution (handles both
            // explicit `project.local_workspace_path` and the
            // canonical `data_dir`-rooted layout for Local /
            // Swarm).
            resolve_project_tool_workspace_path(state, project_id, harness_mode, None).await?
        }
        None => None,
    };

    let typed_project = project.as_ref().map(|project_id| TypedProjectInputs {
        project_id,
        workspace_path: project_path.as_deref(),
    });

    let mut fields = build_typed_session_fields(
        state,
        TypedSessionInputs {
            name: &agent.name,
            role: &agent.role,
            personality: &agent.personality,
            skills: &agent.skills,
            agent_template_prompt: &agent.system_prompt,
            project_state_snapshot,
            plan_mode,
            project: typed_project,
        },
    );

    // Phase 4 (reread-efficiency): seed the workspace digest into the
    // server-baked `agent_system_prompt` addenda so the harness echoes
    // it inside the chat envelope. Loaded only when the turn is
    // project-bound (we have a resolved workspace path); otherwise the
    // bare-agent chat falls through unchanged.
    let server_can_read_project_path = !(harness_mode == aura_os_core::HarnessMode::Local
        && state.harness_http.hosted_local_runtime_available());
    if server_can_read_project_path {
        if let Some(path) = project_path.as_deref() {
            if let Some(block) = build_workspace_index_block(Path::new(path)) {
                let merged = match fields.agent_system_prompt.take() {
                    Some(existing) if !existing.trim().is_empty() => {
                        format!("{existing}\n\n{block}")
                    }
                    _ => block,
                };
                fields.agent_system_prompt = Some(merged);
            }
        }
    }

    Ok((fields, project_path))
}
