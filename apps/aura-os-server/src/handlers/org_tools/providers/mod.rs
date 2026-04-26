//! Provider dispatch table for org-installed app integrations.
//!
//! Each provider lives in its own submodule and exposes a private
//! `dispatch(state, org_id, tool_name, args)` function. This module just
//! routes the resolved [`AppProviderKind`] to the right submodule, mirroring
//! the previous big match in `org_tools.rs::dispatch_app_provider_tool`.

use aura_os_core::OrgId;
use aura_os_integrations::{trusted_integration_method_by_tool, AppProviderKind};
use serde_json::Value;

use super::resolve::resolve_org_integration;
use crate::error::ApiResult;
use crate::handlers::trusted_runtime::execute_trusted_integration_tool;
use crate::state::AppState;

mod apify;
mod brave;
mod buffer;
mod freepik;
mod github;
mod linear;
mod mailchimp;
mod metricool;
mod notion;
mod resend;
mod slack;

pub(super) async fn dispatch_app_provider_tool(
    kind: AppProviderKind,
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    if let Some(method) = trusted_integration_method_by_tool(tool_name) {
        let integration = resolve_org_integration(state, org_id, &method.provider, args).await?;
        return execute_trusted_integration_tool(
            &state.http_client,
            kind,
            &integration.secret,
            integration.metadata.provider_config.as_ref(),
            args,
            &method.runtime,
        )
        .await;
    }

    match kind {
        AppProviderKind::Github => github::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Linear => linear::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Slack => slack::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Notion => notion::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::BraveSearch => brave::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Freepik => freepik::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Buffer => buffer::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Apify => apify::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Metricool => metricool::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Mailchimp => mailchimp::dispatch(state, org_id, tool_name, args).await,
        AppProviderKind::Resend => resend::dispatch(state, org_id, tool_name, args).await,
    }
}
