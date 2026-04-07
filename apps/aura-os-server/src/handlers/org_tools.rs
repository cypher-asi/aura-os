use axum::extract::{Path, State};
use axum::Json;
use aura_os_integrations::{app_provider_contract_by_tool, AppProviderKind};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const NOTION_VERSION: &str = "2022-06-28";

struct ResolvedOrgIntegration {
    metadata: OrgIntegration,
    secret: String,
}

pub(crate) async fn call_tool(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    Path((org_id, tool_name)): Path<(OrgId, String)>,
    Json(args): Json<Value>,
) -> ApiResult<Json<Value>> {
    let result = if tool_name == "list_org_integrations" {
        list_org_integrations(&state, &org_id, &args).await?
    } else {
        let contract = app_provider_contract_by_tool(&tool_name)
            .ok_or_else(|| ApiError::not_found(format!("unknown org tool `{tool_name}`")))?;
        dispatch_app_provider_tool(contract.kind, &state, &org_id, &tool_name, &args).await?
    };

    Ok(Json(result))
}

async fn dispatch_app_provider_tool(
    kind: AppProviderKind,
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
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
        AppProviderKind::BraveSearch => match tool_name {
            "brave_search_web" => brave_search_web(state, org_id, args).await,
            "brave_search_news" => brave_search_news(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown brave search app tool `{other}`"
            ))),
        },
        AppProviderKind::Freepik => match tool_name {
            "freepik_list_icons" => freepik_list_icons(state, org_id, args).await,
            "freepik_improve_prompt" => freepik_improve_prompt(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown freepik app tool `{other}`"
            ))),
        },
        AppProviderKind::Buffer => match tool_name {
            "buffer_list_profiles" => buffer_list_profiles(state, org_id, args).await,
            "buffer_create_update" => buffer_create_update(state, org_id, args).await,
            other => Err(ApiError::not_found(format!(
                "unknown buffer app tool `{other}`"
            ))),
        },
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
    }
}

async fn list_org_integrations(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
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
                "enabled": integration.enabled,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "integrations": filtered }))
}

async fn github_list_repos(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
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

async fn github_create_issue(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
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

async fn linear_list_teams(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
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

async fn linear_create_issue(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "linear", args)?;
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

async fn slack_post_message(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
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

async fn notion_search_pages(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
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

async fn notion_create_page(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "notion", args)?;
    let parent_page_id = required_string(args, &["parent_page_id", "parentPageId"])?;
    let title = required_string(args, &["title"])?;
    let content = optional_string(
        args,
        &["content", "body", "markdown_contents", "markdownContents"],
    );
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

async fn brave_search_web(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "brave_search", args)?;
    brave_search(state, &integration, args, "web").await
}

async fn brave_search_news(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "brave_search", args)?;
    brave_search(state, &integration, args, "news").await
}

async fn brave_search(
    state: &AppState,
    integration: &ResolvedOrgIntegration,
    args: &Value,
    vertical: &str,
) -> ApiResult<Value> {
    let query = required_string(args, &["query", "q"])?;
    let base_url = provider_base_url(
        "AURA_BRAVE_SEARCH_API_BASE_URL",
        "https://api.search.brave.com",
    );
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
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        provider_headers("brave_search", &integration.secret)?,
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
    let integration = resolve_org_integration(state, org_id, "freepik", args)?;
    let base_url = provider_base_url("AURA_FREEPIK_API_BASE_URL", "https://api.freepik.com");
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
    let mut headers = provider_headers("freepik", &integration.secret)?;
    if let Some(language) =
        optional_string(args, &["language", "accept_language", "acceptLanguage"])
    {
        let value = HeaderValue::from_str(&language)
            .map_err(|e| ApiError::bad_request(format!("invalid freepik language header: {e}")))?;
        headers.insert("Accept-Language", value);
    }
    let response = provider_json_request(
        &state.super_agent_service.http_client,
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
    let integration = resolve_org_integration(state, org_id, "freepik", args)?;
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
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &format!(
            "{}/v1/ai/improve-prompt",
            provider_base_url("AURA_FREEPIK_API_BASE_URL", "https://api.freepik.com")
        ),
        provider_headers("freepik", &integration.secret)?,
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

async fn buffer_list_profiles(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, "buffer", args)?;
    let url = buffer_authenticated_url(
        &provider_base_url("AURA_BUFFER_API_BASE_URL", "https://api.bufferapp.com/1"),
        "/profiles.json",
        &integration.secret,
    )?;
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        default_json_headers(),
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
    let integration = resolve_org_integration(state, org_id, "buffer", args)?;
    let profile_id = required_string(args, &["profile_id", "profileId"])?;
    let text = required_string(args, &["text"])?;
    let url = buffer_authenticated_url(
        &provider_base_url("AURA_BUFFER_API_BASE_URL", "https://api.bufferapp.com/1"),
        "/updates/create.json",
        &integration.secret,
    )?;
    let response = provider_form_request(
        &state.super_agent_service.http_client,
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
    let integration = resolve_org_integration(state, org_id, "apify", args)?;
    let base_url = provider_base_url("AURA_APIFY_API_BASE_URL", "https://api.apify.com/v2");
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
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        provider_headers("apify", &integration.secret)?,
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
    let integration = resolve_org_integration(state, org_id, "apify", args)?;
    let actor_id = required_string(args, &["actor_id", "actorId"])?;
    let mut payload = args.get("input").cloned().unwrap_or_else(|| json!({}));
    if payload.is_null() {
        payload = json!({});
    }
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::POST,
        &format!(
            "{}/acts/{actor_id}/runs",
            provider_base_url("AURA_APIFY_API_BASE_URL", "https://api.apify.com/v2")
        ),
        provider_headers("apify", &integration.secret)?,
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
    let integration = resolve_org_integration(state, org_id, "metricool", args)?;
    let url = metricool_url(
        &provider_base_url(
            "AURA_METRICOOL_API_BASE_URL",
            "https://app.metricool.com/api",
        ),
        "/admin/simpleProfiles",
        &integration,
        args,
        false,
    )?;
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        provider_headers("metricool", &integration.secret)?,
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
    let integration = resolve_org_integration(state, org_id, "metricool", args)?;
    let url = metricool_url(
        &provider_base_url(
            "AURA_METRICOOL_API_BASE_URL",
            "https://app.metricool.com/api",
        ),
        "/stats/posts",
        &integration,
        args,
        true,
    )?;
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        url.as_str(),
        provider_headers("metricool", &integration.secret)?,
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
    let integration = resolve_org_integration(state, org_id, "mailchimp", args)?;
    let base_url = mailchimp_base_url(&integration)?;
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        &format!("{base_url}/lists"),
        provider_headers("mailchimp", &integration.secret)?,
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
    let integration = resolve_org_integration(state, org_id, "mailchimp", args)?;
    let base_url = mailchimp_base_url(&integration)?;
    let response = provider_json_request(
        &state.super_agent_service.http_client,
        state,
        reqwest::Method::GET,
        &format!("{base_url}/campaigns"),
        provider_headers("mailchimp", &integration.secret)?,
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
        if !integration.enabled {
            return Err(ApiError::bad_request(format!(
                "integration `{}` is disabled",
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
                    && integration.enabled
                    && integration.kind == OrgIntegrationKind::WorkspaceIntegration
            })
            .ok_or_else(|| {
                ApiError::bad_request(format!(
                    "no enabled `{provider}` org integration with a key is available"
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
        metadata: integration,
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
    let mut headers = default_json_headers();

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
        "linear" | "slack" | "notion" | "apify" => {
            let value = HeaderValue::from_str(&format!("Bearer {secret}"))
                .map_err(|e| ApiError::bad_request(format!("invalid auth header: {e}")))?;
            headers.insert(AUTHORIZATION, value);
            if provider == "notion" {
                headers.insert("Notion-Version", HeaderValue::from_static(NOTION_VERSION));
            }
        }
        "brave_search" => {
            let value = HeaderValue::from_str(secret).map_err(|e| {
                ApiError::bad_request(format!("invalid brave search auth header: {e}"))
            })?;
            headers.insert("X-Subscription-Token", value);
        }
        "freepik" => {
            let value = HeaderValue::from_str(secret).map_err(|e| {
                ApiError::bad_request(format!("invalid freepik api key header: {e}"))
            })?;
            headers.insert("x-freepik-api-key", value);
        }
        "metricool" => {
            let value = HeaderValue::from_str(secret).map_err(|e| {
                ApiError::bad_request(format!("invalid metricool auth header: {e}"))
            })?;
            headers.insert("X-Mc-Auth", value);
        }
        "mailchimp" => {
            let basic_auth = BASE64_STANDARD.encode(format!("anystring:{secret}"));
            let value = HeaderValue::from_str(&format!("Basic {basic_auth}")).map_err(|e| {
                ApiError::bad_request(format!("invalid mailchimp auth header: {e}"))
            })?;
            headers.insert(AUTHORIZATION, value);
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "unsupported provider `{other}`"
            )))
        }
    }

    Ok(headers)
}

fn default_json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
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

fn buffer_authenticated_url(base_url: &str, path: &str, secret: &str) -> ApiResult<reqwest::Url> {
    let mut url = reqwest::Url::parse(&format!("{base_url}{path}"))
        .map_err(|e| ApiError::internal(format!("invalid buffer base url: {e}")))?;
    url.query_pairs_mut().append_pair("access_token", secret);
    Ok(url)
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
    use super::app_provider_contract_by_tool;
    use aura_os_integrations::{app_provider_contracts, org_integration_tool_manifest_entries};
    use std::collections::{HashMap, HashSet};

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
            let expected = contract.tool_names.iter().copied().collect::<HashSet<_>>();
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

        let registered_tools = app_provider_contracts()
            .iter()
            .flat_map(|contract| contract.tool_names.iter().copied())
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
}
