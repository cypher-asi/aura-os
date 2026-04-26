//! Linear workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{optional_string, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "linear";
const KIND: AppProviderKind = AppProviderKind::Linear;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "linear_list_teams" => list_teams(state, org_id, args).await,
        "linear_create_issue" => create_issue(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown linear app tool `{other}`"
        ))),
    }
}

async fn list_teams(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let response = linear_graphql(
        &state.http_client,
        &integration.secret,
        "query AuraLinearTeams { teams { nodes { id name key } } }",
        json!({}),
    )
    .await?;
    let teams = response
        .pointer("/data/teams/nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(json!({ "teams": teams }))
}

async fn create_issue(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let team_id = required_string(args, &["team_id", "teamId"])?;
    let title = required_string(args, &["title"])?;
    let description = optional_string(
        args,
        &[
            "description",
            "body",
            "markdown_contents",
            "markdownContents",
        ],
    );
    let response = linear_graphql(
        &state.http_client,
        &integration.secret,
        "mutation AuraLinearCreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url state { name } team { id name key } } } }",
        json!({
            "input": {
                "teamId": team_id,
                "title": title,
                "description": description,
            }
        }),
    )
    .await?;
    Ok(json!({
        "issue": response.pointer("/data/issueCreate/issue").cloned().unwrap_or_else(|| json!({}))
    }))
}

async fn linear_graphql(
    client: &reqwest::Client,
    secret: &str,
    query: &str,
    variables: Value,
) -> ApiResult<Value> {
    let url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("linear provider base url missing"))?;
    let response = provider_json_request(
        client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, secret)?,
        Some(json!({
            "query": query,
            "variables": variables,
        })),
    )
    .await?;
    if let Some(errors) = response.get("errors").and_then(Value::as_array) {
        if !errors.is_empty() {
            let message = errors
                .iter()
                .filter_map(|error| error.get("message").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(ApiError::bad_gateway(format!(
                "linear graphql error: {message}"
            )));
        }
    }
    Ok(response)
}
