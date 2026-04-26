//! Freepik workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};

use super::super::args::{optional_positive_number, optional_string, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "freepik";
const KIND: AppProviderKind = AppProviderKind::Freepik;
const DEFAULT_PAGE: u64 = 1;
const DEFAULT_PER_PAGE: u64 = 20;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "freepik_list_icons" => list_icons(state, org_id, args).await,
        "freepik_improve_prompt" => improve_prompt(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown freepik app tool `{other}`"
        ))),
    }
}

async fn list_icons(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = build_icons_url(args)?;
    let headers = build_icons_headers(args, &integration.secret)?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        url.as_str(),
        headers,
        None,
    )
    .await?;
    let icons = response
        .pointer("/data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|icon| {
            json!({
                "id": icon.get("id").and_then(Value::as_i64),
                "name": icon.get("name").and_then(Value::as_str).unwrap_or_default(),
                "slug": icon.get("slug").and_then(Value::as_str).unwrap_or_default(),
                "family": icon.pointer("/family/name").and_then(Value::as_str),
                "style": icon.pointer("/style/name").and_then(Value::as_str),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "icons": icons,
        "meta": response.get("meta").cloned().unwrap_or_else(|| json!({})),
    }))
}

fn build_icons_url(args: &Value) -> ApiResult<reqwest::Url> {
    let base_url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("freepik provider base url missing"))?;
    let mut url = reqwest::Url::parse(&format!("{base_url}/v1/icons"))
        .map_err(|e| ApiError::internal(format!("invalid freepik base url: {e}")))?;
    {
        let mut params = url.query_pairs_mut();
        if let Some(term) = optional_string(args, &["term", "query", "q"]) {
            params.append_pair("term", &term);
        }
        if let Some(slug) = optional_string(args, &["slug"]) {
            params.append_pair("slug", &slug);
        }
        params.append_pair(
            "page",
            &optional_positive_number(args, &["page"])
                .unwrap_or(DEFAULT_PAGE)
                .to_string(),
        );
        params.append_pair(
            "per_page",
            &optional_positive_number(args, &["per_page", "perPage", "limit"])
                .unwrap_or(DEFAULT_PER_PAGE)
                .to_string(),
        );
        if let Some(order) = optional_string(args, &["order"]) {
            params.append_pair("order", &order);
        }
    }
    Ok(url)
}

fn build_icons_headers(args: &Value, secret: &str) -> ApiResult<HeaderMap> {
    let mut headers = map_provider_headers(KIND, secret)?;
    if let Some(language) =
        optional_string(args, &["language", "accept_language", "acceptLanguage"])
    {
        let value = HeaderValue::from_str(&language)
            .map_err(|e| ApiError::bad_request(format!("invalid freepik language header: {e}")))?;
        headers.insert("Accept-Language", value);
    }
    Ok(headers)
}

async fn improve_prompt(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let prompt = required_string(args, &["prompt"])?;
    let generation_type = optional_string(args, &["type"]).unwrap_or_else(|| "image".to_string());
    let mut payload = json!({
        "prompt": prompt,
        "type": generation_type,
    });
    if let Some(language) = optional_string(args, &["language"]) {
        payload["language"] = Value::String(language);
    }
    let url = format!(
        "{}/v1/ai/improve-prompt",
        app_provider_base_url(KIND)
            .ok_or_else(|| ApiError::internal("freepik provider base url missing"))?
    );
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
        Some(payload),
    )
    .await?;
    let task = response.get("data").cloned().unwrap_or_else(|| json!({}));
    Ok(json!({
        "task": {
            "task_id": task.get("task_id").and_then(Value::as_str).unwrap_or_default(),
            "status": task.get("status").and_then(Value::as_str).unwrap_or_default(),
            "generated": task.get("generated").cloned().unwrap_or_else(|| json!([])),
        }
    }))
}
