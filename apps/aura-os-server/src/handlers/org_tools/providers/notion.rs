//! Notion workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Value};

use super::super::args::{optional_string, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::resolve_org_integration;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "notion";
const KIND: AppProviderKind = AppProviderKind::Notion;
const MAX_PARAGRAPH_BLOCKS: usize = 20;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "notion_search_pages" => search_pages(state, org_id, args).await,
        "notion_create_page" => create_page(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown notion app tool `{other}`"
        ))),
    }
}

async fn search_pages(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let query = required_string(args, &["query"])?;
    let url = format!("{}/search", notion_base_url()?);
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
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

async fn create_page(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, args).await?;
    let parent_page_id = required_string(args, &["parent_page_id", "parentPageId"])?;
    let title = required_string(args, &["title"])?;
    let content = optional_string(
        args,
        &["content", "body", "markdown_contents", "markdownContents"],
    );
    let url = format!("{}/pages", notion_base_url()?);
    let response = provider_json_request(
        &state.http_client,
        reqwest::Method::POST,
        &url,
        map_provider_headers(KIND, &integration.secret)?,
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

fn notion_base_url() -> ApiResult<String> {
    app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("notion provider base url missing"))
}

fn notion_children_blocks(content: Option<&str>) -> Vec<Value> {
    content
        .unwrap_or_default()
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .take(MAX_PARAGRAPH_BLOCKS)
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
