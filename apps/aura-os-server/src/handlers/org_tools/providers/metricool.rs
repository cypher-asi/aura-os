//! Metricool workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{integration_config_string, optional_positive_number};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::{resolve_org_integration, ResolvedOrgIntegration};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "metricool";
const KIND: AppProviderKind = AppProviderKind::Metricool;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "metricool_list_brands" => list_brands(state, org_id, args).await,
        "metricool_list_posts" => list_posts(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown metricool app tool `{other}`"
        ))),
    }
}

async fn list_brands(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = metricool_url(
        &metricool_base_url()?,
        "/admin/simpleProfiles",
        &integration,
        args,
        false,
    )?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let brands = response
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|brand| {
            json!({
                "id": brand.get("id").and_then(Value::as_i64),
                "user_id": brand.get("userId").and_then(Value::as_i64),
                "label": brand.get("label").and_then(Value::as_str).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "brands": brands }))
}

async fn list_posts(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = metricool_url(
        &metricool_base_url()?,
        "/stats/posts",
        &integration,
        args,
        true,
    )?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let posts = response
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|post| {
            json!({
                "id": post.get("id").and_then(Value::as_i64),
                "title": post.get("title").and_then(Value::as_str),
                "url": post.get("url").and_then(Value::as_str),
                "published": post.get("published").and_then(Value::as_bool),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "posts": posts }))
}

fn metricool_base_url() -> ApiResult<String> {
    app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("metricool provider base url missing"))
}

fn metricool_url(
    base_url: &str,
    path: &str,
    integration: &ResolvedOrgIntegration,
    args: &Value,
    include_range: bool,
) -> ApiResult<reqwest::Url> {
    let user_id = integration_config_string(integration, "userId").ok_or_else(|| {
        ApiError::bad_request("Metricool integrations require a saved `userId` config.")
    })?;
    let blog_id = integration_config_string(integration, "blogId").ok_or_else(|| {
        ApiError::bad_request("Metricool integrations require a saved `blogId` config.")
    })?;
    let mut url = reqwest::Url::parse(&format!("{base_url}{path}"))
        .map_err(|e| ApiError::internal(format!("invalid metricool base url: {e}")))?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("userId", &user_id);
        params.append_pair("blogId", &blog_id);
        if include_range {
            if let Some(start) = optional_positive_number(args, &["start"]) {
                params.append_pair("start", &start.to_string());
            }
            if let Some(end) = optional_positive_number(args, &["end"]) {
                params.append_pair("end", &end.to_string());
            }
        }
    }
    Ok(url)
}
