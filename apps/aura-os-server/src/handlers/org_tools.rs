use axum::extract::{Path, State};
use axum::Json;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde_json::{json, Value};

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const NOTION_VERSION: &str = "2022-06-28";

struct ResolvedOrgIntegration {
    _metadata: OrgIntegration,
    secret: String,
}

pub(crate) async fn call_tool(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path((org_id, tool_name)): Path<(OrgId, String)>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    let result = match tool_name.as_str() {
        "list_org_integrations" => list_org_integrations(&state, &org_id, &args).await?,
        "github_list_repos" => github_list_repos(&state, &org_id, &args).await?,
        "github_create_issue" => github_create_issue(&state, &org_id, &args).await?,
        "linear_list_teams" => linear_list_teams(&state, &org_id, &args).await?,
        "linear_create_issue" => linear_create_issue(&state, &org_id, &args).await?,
        "slack_list_channels" => slack_list_channels(&state, &org_id, &args).await?,
        "slack_post_message" => slack_post_message(&state, &org_id, &args).await?,
        "notion_search_pages" => notion_search_pages(&state, &org_id, &args).await?,
        "notion_create_page" => notion_create_page(&state, &org_id, &args).await?,
        other => return Err(ApiError::not_found(format!("unknown org tool `{other}`"))),
    };

    Ok(Json(result))
}

async fn list_org_integrations(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let provider = optional_string(args, &["provider"]);
    let integrations = state
        .org_service
        .list_integrations(org_id)
        .map_err(|e| ApiError::internal(format!("listing org integrations: {e}")))?;

    let filtered = integrations
        .into_iter()
        .filter(|integration| {
            provider
                .as_deref()
                .map(|expected| integration.provider == expected)
                .unwrap_or(true)
        })
        .map(|integration| {
            json!({
                "integration_id": integration.integration_id,
                "name": integration.name,
                "provider": integration.provider,
                "default_model": integration.default_model,
                "has_secret": integration.has_secret,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "integrations": filtered }))
}

async fn github_list_repos(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "github", args)?;
    let url = format!(
        "{}/user/repos?per_page=20&sort=updated",
        provider_base_url("AURA_GITHUB_API_BASE_URL", "https://api.github.com")
    );
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        &url,
        provider_headers("github", &integration.secret)?,
        None,
    )
    .await?;
    let repos = response
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|repo| {
            json!({
                "name": repo.get("name").and_then(Value::as_str).unwrap_or_default(),
                "full_name": repo.get("full_name").and_then(Value::as_str).unwrap_or_default(),
                "private": repo.get("private").and_then(Value::as_bool).unwrap_or(false),
                "html_url": repo.get("html_url").and_then(Value::as_str).unwrap_or_default(),
                "default_branch": repo.get("default_branch").and_then(Value::as_str).unwrap_or_default(),
                "description": repo.get("description").and_then(Value::as_str),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "repos": repos }))
}

async fn github_create_issue(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "github", args)?;
    let owner = required_string(args, &["owner"])?;
    let repo = required_string(args, &["repo"])?;
    let title = required_string(args, &["title"])?;
    let body = optional_string(args, &["body", "markdown_contents", "markdownContents"]);
    let url = format!(
        "{}/repos/{owner}/{repo}/issues",
        provider_base_url("AURA_GITHUB_API_BASE_URL", "https://api.github.com")
    );
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &url,
        provider_headers("github", &integration.secret)?,
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

async fn linear_list_teams(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "linear", args)?;
    let response = linear_graphql(
        state,
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

async fn linear_create_issue(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "linear", args)?;
    let team_id = required_string(args, &["team_id", "teamId"])?;
    let title = required_string(args, &["title"])?;
    let description = optional_string(args, &["description", "body", "markdown_contents", "markdownContents"]);
    let response = linear_graphql(
        state,
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

async fn slack_list_channels(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "slack", args)?;
    let url = format!(
        "{}/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100",
        provider_base_url("AURA_SLACK_API_BASE_URL", "https://slack.com/api")
    );
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        &url,
        provider_headers("slack", &integration.secret)?,
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

async fn slack_post_message(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "slack", args)?;
    let channel_id = required_string(args, &["channel_id", "channelId"])?;
    let text = required_string(args, &["text", "message"])?;
    let url = format!(
        "{}/chat.postMessage",
        provider_base_url("AURA_SLACK_API_BASE_URL", "https://slack.com/api")
    );
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &url,
        provider_headers("slack", &integration.secret)?,
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

async fn notion_search_pages(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "notion", args)?;
    let query = required_string(args, &["query"])?;
    let url = format!(
        "{}/search",
        provider_base_url("AURA_NOTION_API_BASE_URL", "https://api.notion.com/v1")
    );
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &url,
        provider_headers("notion", &integration.secret)?,
        Some(json!({
            "query": query,
            "filter": { "property": "object", "value": "page" }
        })),
    )
    .await?;
    let pages = response
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|page| {
            json!({
                "id": page.get("id").and_then(Value::as_str).unwrap_or_default(),
                "url": page.get("url").and_then(Value::as_str).unwrap_or_default(),
                "title": notion_page_title(&page),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "pages": pages }))
}

async fn notion_create_page(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "notion", args)?;
    let parent_page_id = required_string(args, &["parent_page_id", "parentPageId"])?;
    let title = required_string(args, &["title"])?;
    let content = optional_string(args, &["content", "body", "markdown_contents", "markdownContents"]);
    let url = format!(
        "{}/pages",
        provider_base_url("AURA_NOTION_API_BASE_URL", "https://api.notion.com/v1")
    );
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &url,
        provider_headers("notion", &integration.secret)?,
        Some(json!({
            "parent": { "page_id": parent_page_id },
            "properties": {
                "title": {
                    "title": [{
                        "text": { "content": title }
                    }]
                }
            },
            "children": notion_children_blocks(content.as_deref()),
        })),
    )
    .await?;
    Ok(json!({
        "page": {
            "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
            "url": response.get("url").and_then(Value::as_str).unwrap_or_default(),
            "title": notion_page_title(&response),
        }
    }))
}

fn resolve_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    args: &Value,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration_id = optional_string(args, &["integration_id", "integrationId"]);
    let integration = if let Some(integration_id) = integration_id {
        let integration = state
            .org_service
            .get_integration(org_id, &integration_id)
            .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
            .ok_or_else(|| ApiError::not_found("integration not found"))?;
        if integration.provider != provider {
            return Err(ApiError::bad_request(format!(
                "integration `{}` uses provider `{}` instead of `{provider}`",
                integration.name, integration.provider
            )));
        }
        if integration.kind != OrgIntegrationKind::WorkspaceIntegration {
            return Err(ApiError::bad_request(format!(
                "integration `{}` is not a workspace integration",
                integration.name
            )));
        }
        integration
    } else {
        state
            .org_service
            .list_integrations(org_id)
            .map_err(|e| ApiError::internal(format!("listing org integrations: {e}")))?
            .into_iter()
            .find(|integration| {
                integration.provider == provider
                    && integration.has_secret
                    && integration.kind == OrgIntegrationKind::WorkspaceIntegration
            })
            .ok_or_else(|| {
                ApiError::bad_request(format!(
                    "no saved `{provider}` org integration with a key is available"
                ))
            })?
    };

    let secret = state
        .org_service
        .get_integration_secret(&integration.integration_id)
        .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("selected integration is missing a stored secret"))?;

    Ok(ResolvedOrgIntegration {
        _metadata: integration,
        secret,
    })
}

fn provider_base_url(env_key: &str, default_url: &str) -> String {
    std::env::var(env_key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_url.to_string())
}

fn provider_headers(provider: &str, secret: &str) -> ApiResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    match provider {
        "github" => {
            headers.insert(
                "X-GitHub-Api-Version",
                HeaderValue::from_static("2022-11-28"),
            );
            headers.insert("User-Agent", HeaderValue::from_static("aura-os"));
            let value = HeaderValue::from_str(&format!("Bearer {secret}"))
                .map_err(|e| ApiError::bad_request(format!("invalid github auth header: {e}")))?;
            headers.insert(AUTHORIZATION, value);
        }
        "linear" | "slack" | "notion" => {
            let value = HeaderValue::from_str(&format!("Bearer {secret}"))
                .map_err(|e| ApiError::bad_request(format!("invalid auth header: {e}")))?;
            headers.insert(AUTHORIZATION, value);
            if provider == "notion" {
                headers.insert(
                    "Notion-Version",
                    HeaderValue::from_static(NOTION_VERSION),
                );
            }
        }
        other => return Err(ApiError::bad_request(format!("unsupported provider `{other}`"))),
    }

    Ok(headers)
}

async fn provider_json_request(
    client: &reqwest::Client,
    _state: &AppState,
    method: reqwest::Method,
    url: &str,
    headers: HeaderMap,
    body: Option<Value>,
) -> ApiResult<Value> {
    let mut request = client.request(method, url).headers(headers);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("provider request failed: {e}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("reading provider response failed: {e}")))?;
    if !status.is_success() {
        return Err(ApiError::bad_gateway(format!(
            "provider request failed with {}: {}",
            status,
            text
        )));
    }
    serde_json::from_str(&text)
        .map_err(|e| ApiError::bad_gateway(format!("provider returned invalid JSON: {e}")))
}

async fn linear_graphql(
    state: &AppState,
    secret: &str,
    query: &str,
    variables: Value,
) -> ApiResult<Value> {
    let url = provider_base_url("AURA_LINEAR_API_BASE_URL", "https://api.linear.app/graphql");
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &url,
        provider_headers("linear", secret)?,
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
            return Err(ApiError::bad_gateway(format!("linear graphql error: {message}")));
        }
    }
    Ok(response)
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

fn required_string(args: &Value, keys: &[&str]) -> ApiResult<String> {
    optional_string(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

fn optional_string(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn notion_children_blocks(content: Option<&str>) -> Vec<Value> {
    content
        .unwrap_or_default()
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .take(20)
        .map(|paragraph| {
            json!({
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{
                        "type": "text",
                        "text": { "content": paragraph }
                    }]
                }
            })
        })
        .collect()
}

fn notion_page_title(page: &Value) -> String {
    page.get("properties")
        .and_then(Value::as_object)
        .and_then(|properties| {
            properties.values().find_map(|property| {
                property
                    .get("title")
                    .and_then(Value::as_array)
                    .map(|title| {
                        title
                            .iter()
                            .filter_map(|fragment| {
                                fragment
                                    .get("plain_text")
                                    .and_then(Value::as_str)
                                    .or_else(|| {
                                        fragment
                                            .get("text")
                                            .and_then(|text| text.get("content"))
                                            .and_then(Value::as_str)
                                    })
                            })
                            .collect::<String>()
                    })
                    .filter(|title| !title.is_empty())
            })
        })
        .unwrap_or_default()
}
