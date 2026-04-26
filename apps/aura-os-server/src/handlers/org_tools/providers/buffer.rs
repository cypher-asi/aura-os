//! Buffer workspace-integration tools.
//!
//! These helpers are kept around because they are exercised by the
//! shared-tool manifest tests and may be re-enabled as soon as the buffer
//! provider exposes user-facing tools again, but they are not currently
//! reached by [`dispatch`].

#![allow(dead_code)]

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_authenticated_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::required_string;
use super::super::http::{map_provider_headers, provider_form_request, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "buffer";
const KIND: AppProviderKind = AppProviderKind::Buffer;

pub(super) async fn dispatch(
    _state: &AppState,
    _org_id: &OrgId,
    tool_name: &str,
    _args: &Value,
) -> ApiResult<Value> {
    Err(ApiError::not_found(format!(
        "unknown buffer app tool `{tool_name}`"
    )))
}

async fn buffer_list_profiles(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = app_provider_authenticated_url(KIND, "/profiles.json", &integration.secret)
        .map_err(ApiError::bad_request)?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let profiles = response
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|profile| {
            json!({
                "id": profile.get("id").and_then(Value::as_str).unwrap_or_default(),
                "formatted_username": profile.get("formatted_username").and_then(Value::as_str),
                "service": profile.get("service").and_then(Value::as_str).unwrap_or_default(),
                "service_username": profile.get("service_username").and_then(Value::as_str),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "profiles": profiles }))
}

async fn buffer_create_update(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let profile_id = required_string(args, &["profile_id", "profileId"])?;
    let text = required_string(args, &["text"])?;
    let url = app_provider_authenticated_url(KIND, "/updates/create.json", &integration.secret)
        .map_err(ApiError::bad_request)?;
    let response = provider_form_request(
        &state.http_client,
        reqwest::Method::POST,
        url.as_str(),
        vec![
            ("text".to_string(), text),
            ("profile_ids[]".to_string(), profile_id),
        ],
    )
    .await?;
    let updates = response
        .get("updates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|update| {
            json!({
                "id": update.get("id").and_then(Value::as_str).unwrap_or_default(),
                "status": update.get("status").and_then(Value::as_str).unwrap_or_default(),
                "text": update.get("text").and_then(Value::as_str).unwrap_or_default(),
                "service": update.get("service").and_then(Value::as_str),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "updates": updates,
        "success": response.get("success").and_then(Value::as_bool).unwrap_or(!updates.is_empty()),
    }))
}
