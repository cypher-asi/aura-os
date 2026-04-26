//! Slack workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::required_string;
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "slack";
const KIND: AppProviderKind = AppProviderKind::Slack;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "slack_list_channels" => list_channels(state, org_id, args).await,
        "slack_post_message" => post_message(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown slack app tool `{other}`"
        ))),
    }
}

async fn list_channels(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = format!(
        "{}/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100",
        slack_base_url()?
    );
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    ensure_slack_ok(&response)?;
    let channels = response
        .get("channels")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|channel| {
            json!({
                "id": channel.get("id").and_then(Value::as_str).unwrap_or_default(),
                "name": channel.get("name").and_then(Value::as_str).unwrap_or_default(),
                "is_private": channel.get("is_private").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "channels": channels }))
}

async fn post_message(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let channel_id = required_string(args, &["channel_id", "channelId"])?;
    let text = required_string(args, &["text", "message"])?;
    let url = format!("{}/chat.postMessage", slack_base_url()?);
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
        Some(json!({
            "channel": channel_id,
            "text": text,
        })),
    )
    .await?;
    ensure_slack_ok(&response)?;
    Ok(json!({
        "message": {
            "channel": response.get("channel").and_then(Value::as_str).unwrap_or_default(),
            "ts": response.get("ts").and_then(Value::as_str).unwrap_or_default(),
        }
    }))
}

fn slack_base_url() -> ApiResult<String> {
    app_provider_base_url(KIND).ok_or_else(|| ApiError::internal("slack provider base url missing"))
}

fn ensure_slack_ok(response: &Value) -> ApiResult<()> {
    if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(());
    }
    let error = response
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("unknown slack error");
    Err(ApiError::bad_gateway(format!("slack api error: {error}")))
}
