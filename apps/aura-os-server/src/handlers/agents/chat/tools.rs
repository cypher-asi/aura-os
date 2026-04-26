//! Build the server-contributed `installed_tools` payload shipped to
//! the harness `SessionConfig`.
//!
//! This list is intentionally limited to workspace and integration
//! tools. Capability-gated native agent tools such as `send_to_agent`
//! are owned by the harness catalog and become visible through
//! `visible_tools_with_permissions` using `SessionConfig.agent_permissions`.

use aura_os_core::{AgentPermissions, OrgId};
use aura_os_harness::InstalledTool;

use crate::error::ApiResult;
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::installed_workspace_app_tools;
use crate::state::AppState;

/// Configuration bundle for installed-tool assembly. Avoids the >5
/// parameter limit while keeping the call sites compact.
pub(super) struct InstalledToolsCtx<'a> {
    pub(super) state: &'a AppState,
    pub(super) org_id: Option<&'a OrgId>,
    pub(super) jwt: &'a str,
    pub(super) context: &'static str,
    pub(super) agent_id: &'a str,
    pub(super) integrations: Option<&'a [aura_os_core::OrgIntegration]>,
}

/// Build the `installed_tools` payload for a harness chat session.
///
/// The returned manifest is server-tool-only. Cross-agent capabilities
/// are expressed through `SessionConfig.agent_permissions`; the harness
/// uses that bundle to expose its native agent tools.
pub(super) async fn build_session_installed_tools(
    ctx: &InstalledToolsCtx<'_>,
    _permissions: &AgentPermissions,
) -> ApiResult<Option<Vec<InstalledTool>>> {
    let mut tools = if let Some(org_id) = ctx.org_id {
        match ctx.integrations {
            Some(ints) => {
                crate::handlers::agents::workspace_tools::installed_workspace_app_tools_with_integrations(
                    ctx.state, org_id, ctx.jwt, ints,
                )
                .await
            }
            None => installed_workspace_app_tools(ctx.state, org_id, ctx.jwt).await,
        }
    } else {
        Vec::new()
    };

    dedupe_and_log_installed_tools(ctx.context, ctx.agent_id, &mut tools);

    Ok((!tools.is_empty()).then_some(tools))
}
