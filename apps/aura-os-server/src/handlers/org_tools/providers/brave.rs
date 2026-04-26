//! Brave Search workspace-integration tools.
//!
//! These helpers are kept around because they are exercised by the
//! shared-tool manifest tests and may be re-enabled as soon as the brave
//! provider exposes user-facing tools again, but they are not currently
//! reached by [`dispatch`].

#![allow(dead_code)]

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{optional_positive_number, optional_string, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::{resolve_org_integration, ResolvedOrgIntegration};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "brave_search";
const KIND: AppProviderKind = AppProviderKind::BraveSearch;
const DEFAULT_RESULT_COUNT: u64 = 10;

pub(super) async fn dispatch(
    _state: &AppState,
    _org_id: &OrgId,
    tool_name: &str,
    _args: &Value,
) -> ApiResult<Value> {
    Err(ApiError::not_found(format!(
        "unknown brave search app tool `{tool_name}`"
    )))
}

async fn brave_search_web(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    brave_search(state, &integration, args, "web").await
}

async fn brave_search_news(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    brave_search(state, &integration, args, "news").await
}

async fn brave_search(
    state: &AppState,
    integration: &ResolvedOrgIntegration,
    args: &Value,
    vertical: &str,
) -> ApiResult<Value> {
    let query = required_string(args, &["query", "q"])?;
    let url = build_search_url(args, vertical, &query)?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let items = response
        .pointer(&format!("/{vertical}/results"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(brave_result_summary)
        .collect::<Vec<_>>();
    Ok(json!({
        "query": query,
        "results": items,
        "more_results_available": response
            .pointer("/query/more_results_available")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }))
}

fn build_search_url(args: &Value, vertical: &str, query: &str) -> ApiResult<reqwest::Url> {
    let base_url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("brave search provider base url missing"))?;
    let mut url = reqwest::Url::parse(&format!("{base_url}/res/v1/{vertical}/search"))
        .map_err(|e| ApiError::internal(format!("invalid brave search base url: {e}")))?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("q", query);
        params.append_pair(
            "count",
            &optional_positive_number(args, &["count"])
                .unwrap_or(DEFAULT_RESULT_COUNT)
                .to_string(),
        );
        if let Some(freshness) = optional_string(args, &["freshness"]) {
            params.append_pair("freshness", &freshness);
        }
        if let Some(country) = optional_string(args, &["country"]) {
            params.append_pair("country", &country);
        }
        if let Some(search_lang) = optional_string(args, &["search_lang", "searchLang"]) {
            params.append_pair("search_lang", &search_lang);
        }
    }
    Ok(url)
}

fn brave_result_summary(item: Value) -> Value {
    json!({
        "title": item.get("title").and_then(Value::as_str).unwrap_or_default(),
        "url": item
            .get("url")
            .or_else(|| item.get("profile"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "description": item
            .get("description")
            .or_else(|| item.get("snippet"))
            .and_then(Value::as_str),
        "age": item.get("age").and_then(Value::as_str),
        "source": item.get("source").and_then(Value::as_str),
    })
}
