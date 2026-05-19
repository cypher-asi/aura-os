//! Small per-turn lookups shared by the bare-agent chat route:
//! resolve the effective project / org id, fetch org integrations
//! once per turn, and surface the workspace-installed integrations
//! list for the harness `SessionConfig`.

use aura_os_core::{OrgId, ProjectId};

use crate::dto::SendChatRequest;
use crate::state::AppState;

use super::super::persist::ChatPersistCtx;

/// Fetch org integrations exactly once per turn and feed both the
/// tool catalog and the installed-integrations list from the same
/// slice. Previously each of those helpers called
/// `integrations_for_org_with_token` independently, doubling the
/// upstream round-trip on every chat message.
pub(super) async fn fetch_org_integrations(
    state: &AppState,
    org_id: Option<&OrgId>,
    jwt: &str,
) -> Option<Vec<aura_os_core::OrgIntegration>> {
    match org_id {
        Some(org_id) => Some(
            crate::handlers::agents::workspace_tools::integrations_for_org_with_token(
                state,
                org_id,
                Some(jwt),
            )
            .await,
        ),
        None => None,
    }
}

/// Resolve the project binding for this turn. Prefer the explicit
/// `body.project_id` (the interface sends it whenever the user is
/// talking to the agent in a project context), and fall back to the
/// `persist_ctx.project_id` inferred from the agent's project-binding
/// record (`find_matching_project_agents`) so the splice fires even
/// for legacy clients that don't thread the project id through the
/// chat body. Without this fallback the CEO-agent flow — where the
/// LLM asks the agent to operate on specs for an implicit project —
/// would still ship a bundle missing `ReadProject`/`WriteProject`,
/// and the harness would deny `list_specs` / `create_spec` by name.
pub(super) fn resolve_effective_project_id(
    body: &SendChatRequest,
    persist_ctx: &Option<ChatPersistCtx>,
) -> Option<String> {
    body.project_id
        .as_deref()
        .filter(|pid| !pid.is_empty())
        .map(|pid| pid.to_string())
        .or_else(|| {
            persist_ctx
                .as_ref()
                .map(|ctx| ctx.project_id.clone())
                .filter(|pid| !pid.is_empty())
        })
}

pub(super) fn resolve_effective_org_id(
    state: &AppState,
    preferred_org_id: Option<&OrgId>,
    effective_project_id: Option<&str>,
) -> Option<OrgId> {
    preferred_org_id.cloned().or_else(|| {
        effective_project_id
            .and_then(|pid| pid.parse::<ProjectId>().ok())
            .and_then(|pid| state.project_service.get_project(&pid).ok())
            .map(|project| project.org_id)
    })
}

pub(super) fn installed_workspace_integrations(
    org_id: Option<&OrgId>,
    org_integrations: Option<&[aura_os_core::OrgIntegration]>,
) -> Option<Vec<aura_os_harness::InstalledIntegration>> {
    match (org_id, org_integrations) {
        (Some(_), Some(ints)) => {
            let installed =
                crate::handlers::agents::workspace_tools::installed_workspace_integrations_with_integrations(
                    ints,
                );
            (!installed.is_empty()).then_some(installed)
        }
        _ => None,
    }
}
