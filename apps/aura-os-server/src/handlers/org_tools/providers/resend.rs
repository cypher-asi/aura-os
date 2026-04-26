//! Resend workspace-integration tools.
//!
//! These helpers are kept around because they are exercised by the
//! shared-tool manifest tests and may be re-enabled as soon as the resend
//! provider exposes user-facing tools again, but they are not currently
//! reached by [`dispatch`].

#![allow(dead_code)]

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{
    optional_string, optional_string_list, required_string, required_string_list,
};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "resend";
const KIND: AppProviderKind = AppProviderKind::Resend;

pub(super) async fn dispatch(
    _state: &AppState,
    _org_id: &OrgId,
    tool_name: &str,
    _args: &Value,
) -> ApiResult<Value> {
    Err(ApiError::not_found(format!(
        "unknown resend app tool `{tool_name}`"
    )))
}

async fn resend_list_domains(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let base_url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("resend provider base url missing"))?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        &format!("{base_url}/domains"),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let domains = response
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|domain| {
            json!({
                "id": domain.get("id").and_then(Value::as_str).unwrap_or_default(),
                "name": domain.get("name").and_then(Value::as_str).unwrap_or_default(),
                "status": domain.get("status").and_then(Value::as_str).unwrap_or_default(),
                "created_at": domain.get("created_at").and_then(Value::as_str),
                "region": domain.get("region").and_then(Value::as_str),
                "capabilities": domain.get("capabilities").cloned().unwrap_or_else(|| json!({})),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "domains": domains,
        "has_more": response.get("has_more").and_then(Value::as_bool).unwrap_or(false),
    }))
}

async fn resend_send_email(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let from = required_string(args, &["from"])?;
    let to = required_string_list(args, &["to"])?;
    let subject = required_string(args, &["subject"])?;
    let html = optional_string(args, &["html"]);
    let text = optional_string(args, &["text"]);
    let cc = optional_string_list(args, &["cc"]);
    let bcc = optional_string_list(args, &["bcc"]);

    if html.is_none() && text.is_none() {
        return Err(ApiError::bad_request(
            "resend_send_email requires at least one of `html` or `text`",
        ));
    }

    let base_url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("resend provider base url missing"))?;
    let mut payload = json!({
        "from": from,
        "to": to,
        "subject": subject,
    });
    if let Some(html) = html {
        payload["html"] = Value::String(html);
    }
    if let Some(text) = text {
        payload["text"] = Value::String(text);
    }
    if let Some(cc) = cc {
        payload["cc"] = json!(cc);
    }
    if let Some(bcc) = bcc {
        payload["bcc"] = json!(bcc);
    }

    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &format!("{base_url}/emails"),
        map_provider_headers(KIND, &integration.secret)?,
        Some(payload),
    )
    .await?;
    Ok(json!({
        "email": {
            "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
        }
    }))
}
