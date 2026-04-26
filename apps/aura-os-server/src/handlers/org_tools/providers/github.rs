//! GitHub workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{optional_string, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "github";
const KIND: AppProviderKind = AppProviderKind::Github;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "github_list_repos" => list_repos(state, org_id, args).await,
        "github_create_issue" => create_issue(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown github app tool `{other}`"
        ))),
    }
}

async fn list_repos(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let url = format!(
        "{}/user/repos?per_page=20&sort=updated",
        app_provider_base_url(KIND)
            .ok_or_else(|| ApiError::internal("github provider base url missing"))?
    );
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::GET,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
        None,
    )
    .await?;
    let repos = response
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(repo_summary)
        .collect::<Vec<_>>();
    Ok(json!({ "repos": repos }))
}

fn repo_summary(repo: Value) -> Value {
    json!({
        "name": repo.get("name").and_then(Value::as_str).unwrap_or_default(),
        "full_name": repo.get("full_name").and_then(Value::as_str).unwrap_or_default(),
        "private": repo.get("private").and_then(Value::as_bool).unwrap_or(false),
        "html_url": repo.get("html_url").and_then(Value::as_str).unwrap_or_default(),
        "default_branch": repo.get("default_branch").and_then(Value::as_str).unwrap_or_default(),
        "description": repo.get("description").and_then(Value::as_str),
    })
}

async fn create_issue(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let owner = required_string(args, &["owner"])?;
    let repo = required_string(args, &["repo"])?;
    let title = required_string(args, &["title"])?;
    let body = optional_string(args, &["body", "markdown_contents", "markdownContents"]);
    let url = format!(
        "{}/repos/{owner}/{repo}/issues",
        app_provider_base_url(KIND)
            .ok_or_else(|| ApiError::internal("github provider base url missing"))?
    );
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
        Some(json!({
            "title": title,
            "body": body,
        })),
    )
    .await?;
    Ok(json!({
        "issue": {
            "number": response.get("number").and_then(Value::as_u64),
            "title": response.get("title").and_then(Value::as_str).unwrap_or_default(),
            "state": response.get("state").and_then(Value::as_str).unwrap_or_default(),
            "html_url": response.get("html_url").and_then(Value::as_str).unwrap_or_default(),
        }
    }))
}
