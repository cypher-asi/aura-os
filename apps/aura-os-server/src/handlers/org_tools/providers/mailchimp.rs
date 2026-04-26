//! Mailchimp workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::AppProviderKind;
use serde_json::{json, Value};

use super::super::args::integration_config_string;
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::{resolve_org_integration, ResolvedOrgIntegration};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "mailchimp";
const KIND: AppProviderKind = AppProviderKind::Mailchimp;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "mailchimp_list_audiences" => list_audiences(state, org_id, args).await,
        "mailchimp_list_campaigns" => list_campaigns(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown mailchimp app tool `{other}`"
        ))),
    }
}

async fn list_audiences(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let base_url = mailchimp_base_url(&integration)?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        &format!("{base_url}/lists"),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let audiences = response
        .get("lists")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|audience| {
            json!({
                "id": audience.get("id").and_then(Value::as_str).unwrap_or_default(),
                "name": audience.get("name").and_then(Value::as_str).unwrap_or_default(),
                "member_count": audience.get("stats").and_then(|stats| stats.get("member_count")).and_then(Value::as_u64),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "audiences": audiences }))
}

async fn list_campaigns(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let base_url = mailchimp_base_url(&integration)?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        &format!("{base_url}/campaigns"),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let campaigns = response
        .get("campaigns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|campaign| {
            json!({
                "id": campaign.get("id").and_then(Value::as_str).unwrap_or_default(),
                "status": campaign.get("status").and_then(Value::as_str).unwrap_or_default(),
                "title": campaign.pointer("/settings/title").and_then(Value::as_str).unwrap_or_default(),
                "emails_sent": campaign.get("emails_sent").and_then(Value::as_u64),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "campaigns": campaigns }))
}

fn mailchimp_base_url(integration: &ResolvedOrgIntegration) -> ApiResult<String> {
    if let Some(base_url) = std::env::var("AURA_MAILCHIMP_API_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(base_url);
    }
    if let Some(server_prefix) = integration_config_string(integration, "serverPrefix") {
        return Ok(format!("https://{server_prefix}.api.mailchimp.com/3.0"));
    }
    let server_prefix = integration
        .secret
        .rsplit('-')
        .next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ApiError::bad_request(
                "Mailchimp API keys must include a data-center suffix like `us19`, or save `serverPrefix` in provider config.",
            )
        })?;
    Ok(format!("https://{server_prefix}.api.mailchimp.com/3.0"))
}
