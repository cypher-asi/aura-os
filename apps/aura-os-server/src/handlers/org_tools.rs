use aura_os_integrations::{
    app_provider_authenticated_url, app_provider_base_url, app_provider_contract_by_tool,
    app_provider_headers, trusted_integration_method_by_tool, AppProviderKind, IntegrationsError,
};
use axum::extract::{Path, Query, State};
use axum::Json;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::warn;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_orgs::IntegrationSecretUpdate;

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tool_catalog, integrations_for_org,
};
use crate::handlers::trusted_mcp;
use crate::handlers::trusted_runtime::execute_trusted_integration_tool;
use crate::state::{AppState, AuthJwt};

struct ResolvedOrgIntegration {
    metadata: OrgIntegration,
    secret: String,
}

#[derive(Deserialize)]
pub(crate) struct McpToolQuery {
    tool_name: String,
}

pub(crate) async fn call_tool(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((org_id, tool_name)): Path<(OrgId, String)>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    hydrate_canonical_integration_shadow(&state, &org_id, &jwt).await;
    let result = if tool_name == "list_org_integrations" {
        list_org_integrations(&state, &org_id, &args).await?
    } else {
        let contract = app_provider_contract_by_tool(&tool_name)
            .ok_or_else(|| ApiError::not_found(format!("unknown org tool `{tool_name}`")))?;
        dispatch_app_provider_tool(contract.kind, &state, &org_id, &tool_name, &args).await?
    };

    Ok(Json(result))
}

pub(crate) async fn list_tool_catalog(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Value>> {
    let catalog = installed_workspace_app_tool_catalog(&state, &org_id, &jwt).await;
    let tools = catalog
        .tools
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "namespace": tool.namespace,
                "endpoint": tool.endpoint,
                "sourceKind": tool.metadata.get("aura_source_kind").cloned().unwrap_or(Value::Null),
                "trustClass": tool.metadata.get("aura_trust_class").cloned().unwrap_or(Value::Null),
                "metadata": tool.metadata,
            })
        })
        .collect::<Vec<_>>();
    let warnings = catalog
        .warnings
        .into_iter()
        .map(|warning| {
            json!({
                "code": warning.code,
                "message": warning.message,
                "detail": warning.detail,
                "sourceKind": warning.source_kind,
                "trustClass": warning.trust_class,
                "integrationId": warning.integration_id,
                "integrationName": warning.integration_name,
                "provider": warning.provider,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({ "tools": tools, "warnings": warnings })))
}

pub(crate) async fn call_mcp_tool(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((org_id, integration_id)): Path<(OrgId, String)>,
    Query(query): Query<McpToolQuery>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    hydrate_canonical_integration_shadow(&state, &org_id, &jwt).await;
    let integration = resolve_mcp_server_integration(&state, &org_id, &integration_id).await?;
    let result = trusted_mcp::call_tool(
        &integration.metadata,
        Some(&integration.secret),
        &query.tool_name,
        &args,
    )
    .await
    .map_err(ApiError::bad_gateway)?;
    Ok(Json(result))
}

async fn hydrate_canonical_integration_shadow(state: &AppState, org_id: &OrgId, jwt: &str) {
    let Some(client) = &state.integrations_client else {
        return;
    };

    let integrations = match client.list_integrations(org_id, jwt).await {
        Ok(integrations) => integrations,
        Err(error) => {
            warn!(
                %org_id,
                error = %error,
                "failed to hydrate canonical integration metadata before org tool dispatch"
            );
            return;
        }
    };

    if let Err(error) = state
        .org_service
        .sync_integrations_shadow(org_id, &integrations)
    {
        warn!(
            %org_id,
            error = %error,
            "failed to sync integration shadow before org tool dispatch"
        );
    }

    for integration in integrations
        .into_iter()
        .filter(|integration| integration.has_secret)
    {
        match client
            .get_integration_secret_authed(org_id, &integration.integration_id, jwt)
            .await
        {
            Ok(Some(secret)) if !secret.trim().is_empty() => {
                if let Err(error) = state
                    .org_service
                    .sync_integration_shadow(&integration, IntegrationSecretUpdate::Set(secret))
                {
                    warn!(
                        %org_id,
                        integration_id = %integration.integration_id,
                        error = %error,
                        "failed to sync integration secret shadow before org tool dispatch"
                    );
                }
            }
            Ok(_) => {}
            Err(error) => warn!(
                %org_id,
                integration_id = %integration.integration_id,
                error = %error,
                "failed to hydrate canonical integration secret before org tool dispatch"
            ),
        }
    }
}

async fn dispatch_app_provider_tool(
    kind: AppProviderKind,
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    if let Some(method) = trusted_integration_method_by_tool(tool_name) {
        let integration = resolve_org_integration(state, org_id, &method.provider, args).await?;
        return execute_trusted_integration_tool(
            &state.http_client,
            kind,
            &integration.secret,
            integration.metadata.provider_config.as_ref(),
            args,
            &method.runtime,
        )
        .await;
    }

    match kind {
        AppProviderKind::Github => match tool_name {
            "github_list_repos" => github_list_repos(state, org_id, args).await,
            "github_create_issue" => github_create_issue(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown github app tool `{other}`"
            ))),
        },
        AppProviderKind::Linear => match tool_name {
            "linear_list_teams" => linear_list_teams(state, org_id, args).await,
            "linear_create_issue" => linear_create_issue(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown linear app tool `{other}`"
            ))),
        },
        AppProviderKind::Slack => match tool_name {
            "slack_list_channels" => slack_list_channels(state, org_id, args).await,
            "slack_post_message" => slack_post_message(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown slack app tool `{other}`"
            ))),
        },
        AppProviderKind::Notion => match tool_name {
            "notion_search_pages" => notion_search_pages(state, org_id, args).await,
            "notion_create_page" => notion_create_page(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown notion app tool `{other}`"
            ))),
        },
        AppProviderKind::BraveSearch => {
            let other = tool_name;
            Err(ApiError::not_found(format!(
                "unknown brave search app tool `{other}`"
            )))
        }
        AppProviderKind::Freepik => match tool_name {
            "freepik_list_icons" => freepik_list_icons(state, org_id, args).await,
            "freepik_improve_prompt" => freepik_improve_prompt(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown freepik app tool `{other}`"
            ))),
        },
        AppProviderKind::Buffer => {
            let other = tool_name;
            Err(ApiError::not_found(format!(
                "unknown buffer app tool `{other}`"
            )))
        }
        AppProviderKind::Apify => match tool_name {
            "apify_list_actors" => apify_list_actors(state, org_id, args).await,
            "apify_run_actor" => apify_run_actor(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown apify app tool `{other}`"
            ))),
        },
        AppProviderKind::Metricool => match tool_name {
            "metricool_list_brands" => metricool_list_brands(state, org_id, args).await,
            "metricool_list_posts" => metricool_list_posts(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown metricool app tool `{other}`"
            ))),
        },
        AppProviderKind::Mailchimp => match tool_name {
            "mailchimp_list_audiences" => mailchimp_list_audiences(state, org_id, args).await,
            "mailchimp_list_campaigns" => mailchimp_list_campaigns(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown mailchimp app tool `{other}`"
            ))),
        },
        AppProviderKind::Resend => {
            let other = tool_name;
            Err(ApiError::not_found(format!(
                "unknown resend app tool `{other}`"
            )))
        }
    }
}

async fn list_org_integrations(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let provider = optional_string(args, &["provider"]);
    let integrations = integrations_for_org(state, org_id).await;

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
                "enabled": integration.enabled,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "integrations": filtered }))
}

async fn github_list_repos(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "github", args).await?;
    let url = format!(
        "{}/user/repos?per_page=20&sort=updated",
        app_provider_base_url(AppProviderKind::Github)
            .ok_or_else(|| ApiError::internal("github provider base url missing"))?
    );
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        &url,
        map_provider_headers(AppProviderKind::Github, &integration.secret)?,
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

async fn github_create_issue(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "github", args).await?;
    let owner = required_string(args, &["owner"])?;
    let repo = required_string(args, &["repo"])?;
    let title = required_string(args, &["title"])?;
    let body = optional_string(args, &["body", "markdown_contents", "markdownContents"]);
    let url = format!(
        "{}/repos/{owner}/{repo}/issues",
        app_provider_base_url(AppProviderKind::Github)
            .ok_or_else(|| ApiError::internal("github provider base url missing"))?
    );
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &url,
        map_provider_headers(AppProviderKind::Github, &integration.secret)?,
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

async fn linear_list_teams(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "linear", args).await?;
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

async fn linear_create_issue(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "linear", args).await?;
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

async fn slack_list_channels(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "slack", args).await?;
    let url = format!(
        "{}/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100",
        app_provider_base_url(AppProviderKind::Slack)
            .expect("slack provider contract must declare a base url")
    );
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        &url,
        map_provider_headers(AppProviderKind::Slack, &integration.secret)?,
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

async fn slack_post_message(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "slack", args).await?;
    let channel_id = required_string(args, &["channel_id", "channelId"])?;
    let text = required_string(args, &["text", "message"])?;
    let url = format!(
        "{}/chat.postMessage",
        app_provider_base_url(AppProviderKind::Slack)
            .expect("slack provider contract must declare a base url")
    );
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &url,
        map_provider_headers(AppProviderKind::Slack, &integration.secret)?,
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

async fn notion_search_pages(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "notion", args).await?;
    let query = required_string(args, &["query"])?;
    let url = format!(
        "{}/search",
        app_provider_base_url(AppProviderKind::Notion)
            .expect("notion provider contract must declare a base url")
    );
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &url,
        map_provider_headers(AppProviderKind::Notion, &integration.secret)?,
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

async fn notion_create_page(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "notion", args).await?;
    let parent_page_id = required_string(args, &["parent_page_id", "parentPageId"])?;
    let title = required_string(args, &["title"])?;
    let content = optional_string(
        args,
        &["content", "body", "markdown_contents", "markdownContents"],
    );
    let url = format!(
        "{}/pages",
        app_provider_base_url(AppProviderKind::Notion)
            .expect("notion provider contract must declare a base url")
    );
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &url,
        map_provider_headers(AppProviderKind::Notion, &integration.secret)?,
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

#[allow(dead_code)]
async fn brave_search_web(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "brave_search", args).await?;
    brave_search(state, &integration, args, "web").await
}

#[allow(dead_code)]
async fn brave_search_news(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "brave_search", args).await?;
    brave_search(state, &integration, args, "news").await
}

#[allow(dead_code)]
async fn brave_search(
    state: &AppState,
    integration: &ResolvedOrgIntegration,
    args: &Value,
    vertical: &str,
) -> ApiResult<Value> {
    let query = required_string(args, &["query", "q"])?;
    let base_url = app_provider_base_url(AppProviderKind::BraveSearch)
        .expect("brave provider contract must declare a base url");
    let mut url = reqwest::Url::parse(&format!("{base_url}/res/v1/{vertical}/search"))
        .map_err(|e| ApiError::internal(format!("invalid brave search base url: {e}")))?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("q", &query);
        params.append_pair(
            "count",
            &optional_positive_number(args, &["count"])
                .unwrap_or(10)
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
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(AppProviderKind::BraveSearch, &integration.secret)?,
        None,
    )
    .await?;
    let items = response
        .pointer(&format!("/{vertical}/results"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
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
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "query": query,
        "results": items,
        "more_results_available": response.pointer("/query/more_results_available").and_then(Value::as_bool).unwrap_or(false),
    }))
}

async fn freepik_list_icons(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "freepik", args).await?;
    let base_url = app_provider_base_url(AppProviderKind::Freepik)
        .expect("freepik provider contract must declare a base url");
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
                .unwrap_or(1)
                .to_string(),
        );
        params.append_pair(
            "per_page",
            &optional_positive_number(args, &["per_page", "perPage", "limit"])
                .unwrap_or(20)
                .to_string(),
        );
        if let Some(order) = optional_string(args, &["order"]) {
            params.append_pair("order", &order);
        }
    }
    let mut headers = map_provider_headers(AppProviderKind::Freepik, &integration.secret)?;
    if let Some(language) =
        optional_string(args, &["language", "accept_language", "acceptLanguage"])
    {
        let value = HeaderValue::from_str(&language)
            .map_err(|e| ApiError::bad_request(format!("invalid freepik language header: {e}")))?;
        headers.insert("Accept-Language", value);
    }
    let response = provider_json_request(
        &state.http_client,
        state,
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

async fn freepik_improve_prompt(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "freepik", args).await?;
    let prompt = required_string(args, &["prompt"])?;
    let generation_type = optional_string(args, &["type"]).unwrap_or_else(|| "image".to_string());
    let mut payload = json!({
        "prompt": prompt,
        "type": generation_type,
    });
    if let Some(language) = optional_string(args, &["language"]) {
        payload["language"] = Value::String(language);
    }
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &format!(
            "{}/v1/ai/improve-prompt",
            app_provider_base_url(AppProviderKind::Freepik)
                .expect("freepik provider contract must declare a base url")
        ),
        map_provider_headers(AppProviderKind::Freepik, &integration.secret)?,
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

#[allow(dead_code)]
async fn buffer_list_profiles(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "buffer", args).await?;
    let url = app_provider_authenticated_url(
        AppProviderKind::Buffer,
        "/profiles.json",
        &integration.secret,
    )
    .map_err(ApiError::bad_request)?;
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(AppProviderKind::Buffer, &integration.secret)?,
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

#[allow(dead_code)]
async fn buffer_create_update(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "buffer", args).await?;
    let profile_id = required_string(args, &["profile_id", "profileId"])?;
    let text = required_string(args, &["text"])?;
    let url = app_provider_authenticated_url(
        AppProviderKind::Buffer,
        "/updates/create.json",
        &integration.secret,
    )
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

async fn apify_list_actors(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "apify", args).await?;
    let base_url = app_provider_base_url(AppProviderKind::Apify)
        .expect("apify provider contract must declare a base url");
    let mut url = reqwest::Url::parse(&format!("{base_url}/acts"))
        .map_err(|e| ApiError::internal(format!("invalid apify base url: {e}")))?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("my", "1");
        params.append_pair(
            "limit",
            &optional_positive_number(args, &["limit"])
                .unwrap_or(20)
                .to_string(),
        );
    }
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(AppProviderKind::Apify, &integration.secret)?,
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

async fn apify_run_actor(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "apify", args).await?;
    let actor_id = required_string(args, &["actor_id", "actorId"])?;
    let mut payload = args.get("input").cloned().unwrap_or_else(|| json!({}));
    if payload.is_null() {
        payload = json!({});
    }
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &format!(
            "{}/acts/{actor_id}/runs",
            app_provider_base_url(AppProviderKind::Apify)
                .expect("apify provider contract must declare a base url")
        ),
        map_provider_headers(AppProviderKind::Apify, &integration.secret)?,
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

async fn metricool_list_brands(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "metricool", args).await?;
    let url = metricool_url(
        &app_provider_base_url(AppProviderKind::Metricool)
            .expect("metricool provider contract must declare a base url"),
        "/admin/simpleProfiles",
        &integration,
        args,
        false,
    )?;
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(AppProviderKind::Metricool, &integration.secret)?,
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

async fn metricool_list_posts(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "metricool", args).await?;
    let url = metricool_url(
        &app_provider_base_url(AppProviderKind::Metricool)
            .expect("metricool provider contract must declare a base url"),
        "/stats/posts",
        &integration,
        args,
        true,
    )?;
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        map_provider_headers(AppProviderKind::Metricool, &integration.secret)?,
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

async fn mailchimp_list_audiences(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "mailchimp", args).await?;
    let base_url = mailchimp_base_url(&integration)?;
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        &format!("{base_url}/lists"),
        map_provider_headers(AppProviderKind::Mailchimp, &integration.secret)?,
        None,
    )
    .await?;
    let audiences = response
        .get("lists")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|audience| {
            json!({
                "id": audience.get("id").and_then(Value::as_str).unwrap_or_default(),
                "name": audience.get("name").and_then(Value::as_str).unwrap_or_default(),
                "member_count": audience.get("stats").and_then(|stats| stats.get("member_count")).and_then(Value::as_u64),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "audiences": audiences }))
}

async fn mailchimp_list_campaigns(
    state: &AppState,
    org_id: &OrgId,
    args: &Value,
) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "mailchimp", args).await?;
    let base_url = mailchimp_base_url(&integration)?;
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        &format!("{base_url}/campaigns"),
        map_provider_headers(AppProviderKind::Mailchimp, &integration.secret)?,
        None,
    )
    .await?;
    let campaigns = response
        .get("campaigns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|campaign| {
            json!({
                "id": campaign.get("id").and_then(Value::as_str).unwrap_or_default(),
                "status": campaign.get("status").and_then(Value::as_str).unwrap_or_default(),
                "title": campaign.pointer("/settings/title").and_then(Value::as_str).unwrap_or_default(),
                "emails_sent": campaign.get("emails_sent").and_then(Value::as_u64),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "campaigns": campaigns }))
}

#[allow(dead_code)]
async fn resend_list_domains(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "resend", args).await?;
    let base_url = app_provider_base_url(AppProviderKind::Resend)
        .expect("resend provider contract must declare a base url");
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::GET,
        &format!("{base_url}/domains"),
        map_provider_headers(AppProviderKind::Resend, &integration.secret)?,
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

#[allow(dead_code)]
async fn resend_send_email(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "resend", args).await?;
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

    let base_url = app_provider_base_url(AppProviderKind::Resend)
        .expect("resend provider contract must declare a base url");
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
        state,
        reqwest::Method::POST,
        &format!("{base_url}/emails"),
        map_provider_headers(AppProviderKind::Resend, &integration.secret)?,
        Some(payload),
    )
    .await?;
    Ok(json!({
        "email": {
            "id": response.get("id").and_then(Value::as_str).unwrap_or_default(),
        }
    }))
}

async fn resolve_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    args: &Value,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration_id = optional_string(args, &["integration_id", "integrationId"]);
    let integration = if let Some(integration) =
        load_canonical_org_integration(state, org_id, provider, integration_id.as_deref()).await?
    {
        integration
    } else if let Some(integration_id) = integration_id {
        load_shadow_org_integration_by_id(state, org_id, provider, &integration_id)?
    } else {
        load_shadow_org_integration_for_provider(state, org_id, provider)?
    };

    let secret = if let Some(client) = &state.integrations_client {
        match client
            .get_integration_secret(org_id, &integration.integration_id)
            .await
        {
            Ok(secret) => {
                if let Some(secret) = secret.filter(|value| !value.trim().is_empty()) {
                    secret
                } else {
                    warn!(
                        %org_id,
                        integration_id = %integration.integration_id,
                        provider = %integration.provider,
                        "canonical aura-integrations secret missing or empty; falling back to compatibility-only local shadow for org tool dispatch"
                    );
                    state
                        .org_service
                        .get_integration_secret(&integration.integration_id)
                        .map_err(|e| {
                            ApiError::internal(format!("loading integration secret: {e}"))
                        })?
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| {
                            ApiError::bad_request("selected integration is missing a stored secret")
                        })?
                }
            }
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    provider = %integration.provider,
                    error = %error,
                    "failed to load canonical aura-integrations secret; falling back to compatibility-only local shadow for org tool dispatch"
                );
                state
                    .org_service
                    .get_integration_secret(&integration.integration_id)
                    .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        ApiError::bad_request("selected integration is missing a stored secret")
                    })?
            }
        }
    } else {
        state
            .org_service
            .get_integration_secret(&integration.integration_id)
            .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ApiError::bad_request("selected integration is missing a stored secret")
            })?
    };

    Ok(ResolvedOrgIntegration {
        metadata: integration,
        secret,
    })
}

async fn load_canonical_org_integration(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    integration_id: Option<&str>,
) -> ApiResult<Option<OrgIntegration>> {
    let Some(client) = &state.integrations_client else {
        return Ok(None);
    };

    if let Some(integration_id) = integration_id {
        return match client
            .get_integration_internal(org_id, integration_id)
            .await
        {
            Ok(integration) => {
                let integration = validate_org_tool_integration(integration, provider)?;
                if let Err(error) = state.org_service.sync_integration_shadow(
                    &integration,
                    aura_os_orgs::IntegrationSecretUpdate::Preserve,
                ) {
                    warn!(
                        %org_id,
                        integration_id = %integration.integration_id,
                        error = %error,
                        "failed to sync compatibility-only local integration shadow after canonical org tool lookup"
                    );
                }
                Ok(Some(integration))
            }
            Err(IntegrationsError::Server { status: 404, .. }) => {
                Err(ApiError::not_found("integration not found"))
            }
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id,
                    provider,
                    error = %error,
                    "failed to load canonical aura-integrations metadata for org tool dispatch; falling back to compatibility-only local shadow"
                );
                Ok(None)
            }
        };
    }

    match client.list_integrations_internal(org_id).await {
        Ok(integrations) => {
            if let Err(error) = state
                .org_service
                .sync_integrations_shadow(org_id, &integrations)
            {
                warn!(
                    %org_id,
                    error = %error,
                    "failed to sync compatibility-only local integration shadow after canonical org tool list"
                );
            }
            let integration = integrations
                .into_iter()
                .find(|integration| matches_org_tool_provider(integration, provider))
                .ok_or_else(|| {
                    ApiError::bad_request(format!(
                        "no enabled `{provider}` org integration with a key is available"
                    ))
                })?;
            Ok(Some(integration))
        }
        Err(error) => {
            warn!(
                %org_id,
                provider,
                error = %error,
                "failed to load canonical aura-integrations list for org tool dispatch; falling back to compatibility-only local shadow"
            );
            Ok(None)
        }
    }
}

fn load_shadow_org_integration_by_id(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
    integration_id: &str,
) -> ApiResult<OrgIntegration> {
    let integration = state
        .org_service
        .get_integration(org_id, integration_id)
        .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
        .ok_or_else(|| ApiError::not_found("integration not found"))?;
    validate_org_tool_integration(integration, provider)
}

fn load_shadow_org_integration_for_provider(
    state: &AppState,
    org_id: &OrgId,
    provider: &str,
) -> ApiResult<OrgIntegration> {
    state
        .org_service
        .list_integrations(org_id)
        .map_err(|e| ApiError::internal(format!("listing org integrations: {e}")))?
        .into_iter()
        .find(|integration| matches_org_tool_provider(integration, provider))
        .ok_or_else(|| {
            ApiError::bad_request(format!(
                "no enabled `{provider}` org integration with a key is available"
            ))
        })
}

fn validate_org_tool_integration(
    integration: OrgIntegration,
    provider: &str,
) -> ApiResult<OrgIntegration> {
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
    if !integration.enabled {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is disabled",
            integration.name
        )));
    }
    Ok(integration)
}

fn validate_mcp_tool_integration(integration: OrgIntegration) -> ApiResult<OrgIntegration> {
    if integration.kind != OrgIntegrationKind::McpServer {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is not an MCP server integration",
            integration.name
        )));
    }
    if !integration.enabled {
        return Err(ApiError::bad_request(format!(
            "integration `{}` is disabled",
            integration.name
        )));
    }
    Ok(integration)
}

async fn resolve_mcp_server_integration(
    state: &AppState,
    org_id: &OrgId,
    integration_id: &str,
) -> ApiResult<ResolvedOrgIntegration> {
    let integration = if let Some(client) = &state.integrations_client {
        match client
            .get_integration_internal(org_id, integration_id)
            .await
        {
            Ok(integration) => {
                let integration = validate_mcp_tool_integration(integration)?;
                if let Err(error) = state.org_service.sync_integration_shadow(
                    &integration,
                    aura_os_orgs::IntegrationSecretUpdate::Preserve,
                ) {
                    warn!(
                        %org_id,
                        integration_id = %integration.integration_id,
                        error = %error,
                        "failed to sync compatibility-only local MCP integration shadow after canonical lookup"
                    );
                }
                integration
            }
            Err(IntegrationsError::Server { status: 404, .. }) => {
                return Err(ApiError::not_found("integration not found"));
            }
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id,
                    error = %error,
                    "failed to load canonical aura-integrations MCP metadata; falling back to compatibility-only local shadow"
                );
                validate_mcp_tool_integration(
                    state
                        .org_service
                        .get_integration(org_id, integration_id)
                        .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
                        .ok_or_else(|| ApiError::not_found("integration not found"))?,
                )?
            }
        }
    } else {
        validate_mcp_tool_integration(
            state
                .org_service
                .get_integration(org_id, integration_id)
                .map_err(|e| ApiError::internal(format!("loading org integration: {e}")))?
                .ok_or_else(|| ApiError::not_found("integration not found"))?,
        )?
    };

    let secret = if let Some(client) = &state.integrations_client {
        match client.get_integration_secret(org_id, integration_id).await {
            Ok(secret) => secret.filter(|value| !value.trim().is_empty()),
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id,
                    error = %error,
                    "failed to load canonical aura-integrations MCP secret"
                );
                None
            }
        }
    } else {
        state
            .org_service
            .get_integration_secret(integration_id)
            .map_err(|e| ApiError::internal(format!("loading integration secret: {e}")))?
            .filter(|value| !value.trim().is_empty())
    }
    .unwrap_or_default();

    Ok(ResolvedOrgIntegration {
        metadata: integration,
        secret,
    })
}

fn matches_org_tool_provider(integration: &OrgIntegration, provider: &str) -> bool {
    integration.provider == provider
        && integration.has_secret
        && integration.enabled
        && integration.kind == OrgIntegrationKind::WorkspaceIntegration
}

fn map_provider_headers(kind: AppProviderKind, secret: &str) -> ApiResult<HeaderMap> {
    app_provider_headers(kind, secret).map_err(ApiError::bad_request)
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
            status, text
        )));
    }
    serde_json::from_str(&text)
        .map_err(|e| ApiError::bad_gateway(format!("provider returned invalid JSON: {e}")))
}

#[allow(dead_code)]
async fn provider_form_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    form: Vec<(String, String)>,
) -> ApiResult<Value> {
    let response = client
        .request(method, url)
        .header(ACCEPT, "application/json")
        .form(&form)
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
            status, text
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
    let url = app_provider_base_url(AppProviderKind::Linear)
        .expect("linear provider contract must declare a base url");
    let response = provider_json_request(
        &state.http_client,
        state,
        reqwest::Method::POST,
        &url,
        map_provider_headers(AppProviderKind::Linear, secret)?,
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

#[allow(dead_code)]
fn required_string_list(args: &Value, keys: &[&str]) -> ApiResult<Vec<String>> {
    optional_string_list(args, keys)
        .ok_or_else(|| ApiError::bad_request(format!("missing required field `{}`", keys[0])))
}

#[allow(dead_code)]
fn optional_string_list(args: &Value, keys: &[&str]) -> Option<Vec<String>> {
    keys.iter().find_map(|key| {
        let value = args.get(*key)?;
        if let Some(single) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(vec![single.to_string()]);
        }
        value
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
    })
}

fn optional_positive_number(args: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_u64))
}

fn integration_config_string(integration: &ResolvedOrgIntegration, key: &str) -> Option<String> {
    integration
        .metadata
        .provider_config
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|config| config.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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

fn mailchimp_base_url(integration: &ResolvedOrgIntegration) -> ApiResult<String> {
    if let Some(base_url) = std::env::var("AURA_MAILCHIMP_API_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(base_url);
    }
    if let Some(server_prefix) = integration_config_string(integration, "serverPrefix") {
        return Ok(format!("https://{server_prefix}.api.mailchimp.com/3.0"));
    }
    let server_prefix = integration
        .secret
        .rsplit('-')
        .next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ApiError::bad_request(
                "Mailchimp API keys must include a data-center suffix like `us19`, or save `serverPrefix` in provider config.",
            )
        })?;
    Ok(format!("https://{server_prefix}.api.mailchimp.com/3.0"))
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

#[cfg(test)]
mod tests {
    use super::{
        app_provider_contract_by_tool, list_org_integrations, resolve_mcp_server_integration,
        resolve_org_integration,
    };
    use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
    use aura_os_integrations::{
        app_provider_authenticated_url, app_provider_contracts, app_provider_headers,
        org_integration_tool_manifest_entries, AppProviderKind, IntegrationsClient,
    };
    use aura_os_orgs::IntegrationSecretUpdate;
    use axum::extract::Path;
    use axum::routing::get;
    use axum::Json;
    use axum::Router;
    use chrono::Utc;
    use reqwest::header::AUTHORIZATION;
    use serde_json::Value;
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;
    use tokio::net::TcpListener;

    fn sample_integration(
        org_id: OrgId,
        integration_id: &str,
        name: &str,
        provider: &str,
        enabled: bool,
        has_secret: bool,
    ) -> OrgIntegration {
        let now = Utc::now();
        OrgIntegration {
            integration_id: integration_id.to_string(),
            org_id,
            name: name.to_string(),
            provider: provider.to_string(),
            kind: OrgIntegrationKind::WorkspaceIntegration,
            default_model: None,
            provider_config: None,
            has_secret,
            enabled,
            secret_last4: has_secret.then(|| "1234".to_string()),
            created_at: now,
            updated_at: now,
        }
    }

    async fn start_mock_integrations_server(
        integration: OrgIntegration,
        secret: Option<&'static str>,
    ) -> String {
        let list_integration = integration.clone();
        let get_integration = integration.clone();
        let app = Router::new()
            .route(
                "/internal/orgs/:org_id/integrations",
                get(move |Path(_org_id): Path<String>| {
                    let integration = list_integration.clone();
                    async move { Json(vec![integration]) }
                }),
            )
            .route(
                "/internal/orgs/:org_id/integrations/:integration_id",
                get(
                    move |Path((_org_id, integration_id)): Path<(String, String)>| {
                        let integration = get_integration.clone();
                        async move {
                            if integration.integration_id == integration_id {
                                Ok::<_, axum::http::StatusCode>(Json(integration))
                            } else {
                                Err(axum::http::StatusCode::NOT_FOUND)
                            }
                        }
                    },
                ),
            )
            .route(
                "/internal/orgs/:org_id/integrations/:integration_id/secret",
                get(
                    move |Path((_org_id, _integration_id)): Path<(String, String)>| async move {
                        Json(serde_json::json!({ "secret": secret }))
                    },
                ),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn shared_app_tool_manifest_matches_provider_registry() {
        let manifest_entries = org_integration_tool_manifest_entries();
        assert!(manifest_entries
            .iter()
            .all(|entry| !entry.prompt_signature.trim().is_empty()));
        let manifest_by_provider = manifest_entries.iter().fold(
            HashMap::<&str, HashSet<&str>>::new(),
            |mut acc, entry| {
                if let Some(provider) = entry.provider.as_deref() {
                    acc.entry(provider).or_default().insert(entry.name.as_str());
                }
                acc
            },
        );

        for contract in app_provider_contracts() {
            let expected = manifest_entries
                .iter()
                .filter(|entry| entry.provider.as_deref() == Some(contract.kind.provider_id()))
                .map(|entry| entry.name.as_str())
                .collect::<HashSet<_>>();
            let actual = manifest_by_provider
                .get(contract.kind.provider_id())
                .cloned()
                .unwrap_or_default();
            assert_eq!(
                actual,
                expected,
                "shared app manifest drifted from the {} provider contract",
                contract.kind.provider_id()
            );
        }

        let registered_tools = manifest_entries
            .iter()
            .filter_map(|entry| entry.provider.as_deref().map(|_| entry.name.as_str()))
            .collect::<HashSet<_>>();
        let manifest_tools = manifest_entries
            .iter()
            .filter_map(|entry| entry.provider.as_deref().map(|_| entry.name.as_str()))
            .collect::<HashSet<_>>();
        assert_eq!(manifest_tools, registered_tools);
    }

    #[test]
    fn app_tool_lookup_uses_registered_provider_contracts() {
        let github = app_provider_contract_by_tool("github_create_issue").expect("github tool");
        assert_eq!(github.kind.provider_id(), "github");

        let linear = app_provider_contract_by_tool("linear_list_teams").expect("linear tool");
        assert_eq!(linear.kind.provider_id(), "linear");

        assert!(app_provider_contract_by_tool("list_org_integrations").is_none());
        assert!(app_provider_contract_by_tool("missing_tool").is_none());
    }

    #[test]
    fn linear_headers_use_raw_api_key_without_bearer_prefix() {
        let headers =
            app_provider_headers(AppProviderKind::Linear, "lin_test_123").expect("linear headers");
        let auth = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .expect("authorization header");
        assert_eq!(auth, "lin_test_123");
    }

    #[test]
    fn buffer_authenticated_url_uses_query_token_contract() {
        let url = app_provider_authenticated_url(
            AppProviderKind::Buffer,
            "/profiles.json",
            "buf_test_123",
        )
        .expect("buffer url");
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "access_token"),
            Some(("access_token".into(), "buf_test_123".into()))
        );
    }

    #[tokio::test]
    async fn resolve_org_integration_prefers_canonical_metadata_for_selected_id() {
        let store_dir = tempfile::tempdir().unwrap();
        let store_path = store_dir.path().join("store");
        let mut state = crate::build_app_state(&store_path).expect("build app state");
        let org_id = OrgId::new();
        let integration_id = "github-ops";

        state
            .org_service
            .upsert_integration(
                &org_id,
                Some(integration_id),
                "Local Shadow".to_string(),
                "github".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(false),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save local shadow");

        let canonical = sample_integration(
            org_id,
            integration_id,
            "Canonical GitHub",
            "github",
            true,
            true,
        );
        let base_url =
            start_mock_integrations_server(canonical.clone(), Some("canonical-secret")).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let resolved = resolve_org_integration(
            &state,
            &org_id,
            "github",
            &serde_json::json!({ "integration_id": integration_id }),
        )
        .await
        .expect("resolve canonical integration");

        assert_eq!(resolved.metadata, canonical);
        assert_eq!(resolved.secret, "canonical-secret");
    }

    #[tokio::test]
    async fn resolve_org_integration_prefers_canonical_provider_list() {
        let store_dir = tempfile::tempdir().unwrap();
        let store_path = store_dir.path().join("store");
        let mut state = crate::build_app_state(&store_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Local Disabled GitHub".to_string(),
                "github".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(false),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save local shadow");

        let canonical = sample_integration(
            org_id,
            "canonical-github",
            "Canonical GitHub",
            "github",
            true,
            true,
        );
        let base_url =
            start_mock_integrations_server(canonical.clone(), Some("canonical-secret")).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let resolved = resolve_org_integration(&state, &org_id, "github", &serde_json::json!({}))
            .await
            .expect("resolve canonical provider integration");

        assert_eq!(resolved.metadata, canonical);
        assert_eq!(resolved.secret, "canonical-secret");
    }

    #[tokio::test]
    async fn list_org_integrations_prefers_canonical_backend() {
        let store_dir = tempfile::tempdir().unwrap();
        let store_path = store_dir.path().join("store");
        let mut state = crate::build_app_state(&store_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                Some("local-github"),
                "Local Disabled GitHub".to_string(),
                "github".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(false),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save local shadow");

        let canonical = sample_integration(
            org_id,
            "canonical-github",
            "Canonical GitHub",
            "github",
            true,
            true,
        );
        let base_url =
            start_mock_integrations_server(canonical.clone(), Some("canonical-secret")).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let listed = list_org_integrations(&state, &org_id, &serde_json::json!({}))
            .await
            .expect("list org integrations");
        let integrations = listed
            .get("integrations")
            .and_then(Value::as_array)
            .expect("integrations array");

        assert_eq!(integrations.len(), 1);
        assert_eq!(
            integrations[0]
                .get("integration_id")
                .and_then(Value::as_str),
            Some("canonical-github")
        );
        assert_eq!(
            integrations[0].get("name").and_then(Value::as_str),
            Some("Canonical GitHub")
        );
    }

    #[tokio::test]
    async fn resolve_mcp_server_integration_accepts_enabled_mcp_server() {
        let store_dir = tempfile::tempdir().unwrap();
        let store_path = store_dir.path().join("store");
        let state = crate::build_app_state(&store_path).expect("build app state");
        let org_id = OrgId::new();

        let integration = state
            .org_service
            .upsert_integration(
                &org_id,
                Some("mcp-1"),
                "Docs MCP".to_string(),
                "mcp_server".to_string(),
                OrgIntegrationKind::McpServer,
                None,
                Some(serde_json::json!({"transport":"stdio","command":"demo"})),
                Some(true),
                IntegrationSecretUpdate::Preserve,
            )
            .expect("save mcp integration");

        let resolved = resolve_mcp_server_integration(&state, &org_id, "mcp-1")
            .await
            .expect("resolve mcp integration");

        assert_eq!(resolved.metadata, integration);
        assert_eq!(resolved.secret, "");
    }
}
