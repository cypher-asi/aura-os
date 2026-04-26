//! `list_org_integrations` virtual tool.
//!
//! This mirrors the previous `list_org_integrations` helper from
//! `org_tools.rs` exactly. It is exposed at the module boundary so the
//! dispatcher in `org_tools::call_tool` can route the synthetic tool name
//! `list_org_integrations` here without going through any provider contract.

use aura_os_core::OrgId;
use serde_json::{json, Value};

use super::args::optional_string;
use crate::error::ApiResult;
use crate::handlers::agents::workspace_tools::integrations_for_org;
use crate::state::AppState;

pub(super) async fn list_org_integrations(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let provider = optional_string(args, &["provider"]);
    let integrations = integrations_for_org(state, org_id).await;

    let filtered = integrations
        .into_iter()
        .filter(|integration| {
            provider
                .as_deref()
                .map(|expected| integration.provider == expected)
                .unwrap_or(true)
        })
        .map(|integration| {
            json!({
                "integration_id": integration.integration_id,
                "name": integration.name,
                "provider": integration.provider,
                "default_model": integration.default_model,
                "has_secret": integration.has_secret,
                "enabled": integration.enabled,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "integrations": filtered }))
}
