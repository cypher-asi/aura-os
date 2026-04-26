//! Apify workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{optional_positive_number, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "apify";
const KIND: AppProviderKind = AppProviderKind::Apify;
const DEFAULT_ACTOR_LIST_LIMIT: u64 = 20;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "apify_list_actors" => list_actors(state, org_id, args).await,
        "apify_run_actor" => run_actor(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown apify app tool `{other}`"
        ))),
    }
}

async fn list_actors(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = build_actor_list_url(args)?;
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let actors = response
        .pointer("/data/items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|actor| {
            json!({
                "id": actor.get("id").and_then(Value::as_str).unwrap_or_default(),
                "name": actor.get("name").and_then(Value::as_str).unwrap_or_default(),
                "username": actor.get("username").and_then(Value::as_str).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "actors": actors }))
}

fn build_actor_list_url(args: &Value) -> ApiResult<reqwest::Url> {
    let base_url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("apify provider base url missing"))?;
    let mut url = reqwest::Url::parse(&format!("{base_url}/acts"))
        .map_err(|e| ApiError::internal(format!("invalid apify base url: {e}")))?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("my", "1");
        params.append_pair(
            "limit",
            &optional_positive_number(args, &["limit"])
                .unwrap_or(DEFAULT_ACTOR_LIST_LIMIT)
                .to_string(),
        );
    }
    Ok(url)
}

async fn run_actor(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let actor_id = required_string(args, &["actor_id", "actorId"])?;
    let mut payload = args.get("input").cloned().unwrap_or_else(|| json!({}));
    if payload.is_null() {
        payload = json!({});
    }
    let url = format!(
        "{}/acts/{actor_id}/runs",
        app_provider_base_url(KIND)
            .ok_or_else(|| ApiError::internal("apify provider base url missing"))?
    );
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
        Some(payload),
    )
    .await?;
    let run = response.get("data").cloned().unwrap_or_else(|| json!({}));
    Ok(json!({
        "run": {
            "id": run.get("id").and_then(Value::as_str).unwrap_or_default(),
            "status": run.get("status").and_then(Value::as_str).unwrap_or_default(),
            "act_id": run.get("actId").and_then(Value::as_str).unwrap_or_default(),
        }
    }))
}
