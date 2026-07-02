//! Notion workspace-integration tools.

use aura_os_core::OrgId;
use aura_os_integrations::{app_provider_base_url, AppProviderKind};
use serde_json::{json, Map, Value};

use super::super::args::{optional_positive_number, optional_string, required_string};
use super::super::http::{map_provider_headers, provider_json_request};
use super::super::resolve::{resolve_org_integration, ResolvedOrgIntegration};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const PROVIDER: &str = "notion";
const KIND: AppProviderKind = AppProviderKind::Notion;
const MAX_PARAGRAPH_BLOCKS: usize = 20;
const MAX_PAGE_SIZE: u64 = 100;

pub(super) async fn dispatch(
    state: &AppState,
    org_id: &OrgId,
    tool_name: &str,
    args: &Value,
) -> ApiResult<Value> {
    match tool_name {
        "notion_search_pages" => search_pages(state, org_id, args).await,
        "notion_fetch_page" => fetch_page(state, org_id, args).await,
        "notion_get_block_children" => get_block_children(state, org_id, args).await,
        "notion_append_block_children" => append_block_children(state, org_id, args).await,
        "notion_create_page" => create_page(state, org_id, args).await,
        "notion_update_page" => update_page(state, org_id, args).await,
        "notion_update_page_markdown" => update_page_markdown(state, org_id, args).await,
        "notion_query_data_source" => query_data_source(state, org_id, args).await,
        "notion_create_database" => create_database(state, org_id, args).await,
        "notion_create_data_source" => create_data_source(state, org_id, args).await,
        other => Err(ApiError::not_found(format!(
            "unknown notion app tool `{other}`"
        ))),
    }
}

async fn search_pages(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let query = required_string(args, &["query"])?;
    let mut payload = Map::new();
    payload.insert("query".to_string(), Value::String(query));
    payload.insert(
        "filter".to_string(),
        json!({ "property": "object", "value": "page" }),
    );
    insert_optional_page_size(&mut payload, args);
    insert_optional_string(
        &mut payload,
        args,
        &["start_cursor", "startCursor"],
        "start_cursor",
    );

    let response = notion_request(
        state,
        &integration,
        reqwest::Method::POST,
        notion_url("/search")?.as_str(),
        Some(Value::Object(payload)),
    )
    .await?;
    Ok(notion_page_list_response(response))
}

async fn fetch_page(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let page_id = required_notion_id(args, &["page_id", "pageId", "page"])?;
    let page = notion_request(
        state,
        &integration,
        reqwest::Method::GET,
        notion_url(&format!("/pages/{page_id}"))?.as_str(),
        None,
    )
    .await?;

    let mut response = Map::new();
    response.insert("page".to_string(), notion_page_summary(&page));
    match notion_content_mode(args)?.as_str() {
        "metadata" | "summary" | "none" => {}
        "markdown" | "full" => {
            response.insert(
                "markdown".to_string(),
                fetch_page_markdown(state, &integration, &page_id, args).await?,
            );
        }
        "blocks" => {
            response.insert(
                "blocks".to_string(),
                block_children_response(state, &integration, &page_id, args).await?,
            );
        }
        "both" => {
            response.insert(
                "markdown".to_string(),
                fetch_page_markdown(state, &integration, &page_id, args).await?,
            );
            response.insert(
                "blocks".to_string(),
                block_children_response(state, &integration, &page_id, args).await?,
            );
        }
        mode => {
            return Err(ApiError::bad_request(format!(
                "unsupported notion content_mode `{mode}`"
            )));
        }
    }
    Ok(Value::Object(response))
}

async fn get_block_children(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let block_id = required_notion_id(args, &["block_id", "blockId", "page_id", "pageId"])?;
    block_children_response(state, &integration, &block_id, args).await
}

async fn append_block_children(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let block_id = required_notion_id(args, &["block_id", "blockId", "page_id", "pageId"])?;
    let payload = append_blocks_payload(args)?;
    let response = notion_request(
        state,
        &integration,
        reqwest::Method::PATCH,
        notion_url(&format!("/blocks/{block_id}/children"))?.as_str(),
        Some(payload),
    )
    .await?;
    Ok(notion_block_list_response(response))
}

async fn create_page(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let response = notion_request(
        state,
        &integration,
        reqwest::Method::POST,
        notion_url("/pages")?.as_str(),
        Some(create_page_payload(args)?),
    )
    .await?;
    Ok(json!({ "page": notion_page_summary(&response) }))
}

async fn update_page(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let page_id = required_notion_id(args, &["page_id", "pageId", "page"])?;
    let response = notion_request(
        state,
        &integration,
        reqwest::Method::PATCH,
        notion_url(&format!("/pages/{page_id}"))?.as_str(),
        Some(update_page_payload(args)?),
    )
    .await?;
    Ok(json!({ "page": notion_page_summary(&response) }))
}

async fn update_page_markdown(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let page_id = required_notion_id(args, &["page_id", "pageId", "page"])?;
    notion_request(
        state,
        &integration,
        reqwest::Method::PATCH,
        notion_url(&format!("/pages/{page_id}/markdown"))?.as_str(),
        Some(update_page_markdown_payload(args)?),
    )
    .await
}

async fn query_data_source(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let data_source_id = required_notion_id(args, &["data_source_id", "dataSourceId"])?;
    let response = notion_request(
        state,
        &integration,
        reqwest::Method::POST,
        notion_url(&format!("/data_sources/{data_source_id}/query"))?.as_str(),
        Some(query_data_source_payload(args)?),
    )
    .await?;
    Ok(notion_page_list_response(response))
}

async fn create_database(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let response = notion_request(
        state,
        &integration,
        reqwest::Method::POST,
        notion_url("/databases")?.as_str(),
        Some(create_database_payload(args)?),
    )
    .await?;
    Ok(json!({ "database": notion_database_summary(&response) }))
}

async fn create_data_source(state: &AppState, org_id: &OrgId, args: &Value) -> ApiResult<Value> {
    let integration = resolve_org_integration(state, org_id, PROVIDER, None, args).await?;
    let response = notion_request(
        state,
        &integration,
        reqwest::Method::POST,
        notion_url("/data_sources")?.as_str(),
        Some(create_data_source_payload(args)?),
    )
    .await?;
    Ok(json!({ "data_source": notion_data_source_summary(&response) }))
}

async fn fetch_page_markdown(
    state: &AppState,
    integration: &ResolvedOrgIntegration,
    page_id: &str,
    args: &Value,
) -> ApiResult<Value> {
    let mut url = notion_url(&format!("/pages/{page_id}/markdown"))?;
    if optional_bool(args, &["include_transcript", "includeTranscript"])?.unwrap_or(false) {
        url.query_pairs_mut()
            .append_pair("include_transcript", "true");
    }
    notion_request(state, integration, reqwest::Method::GET, url.as_str(), None).await
}

async fn block_children_response(
    state: &AppState,
    integration: &ResolvedOrgIntegration,
    block_id: &str,
    args: &Value,
) -> ApiResult<Value> {
    let mut url = notion_url(&format!("/blocks/{block_id}/children"))?;
    {
        let mut params = url.query_pairs_mut();
        if let Some(cursor) = optional_string(args, &["start_cursor", "startCursor"]) {
            params.append_pair("start_cursor", &cursor);
        }
        if let Some(page_size) = notion_page_size(args) {
            params.append_pair("page_size", &page_size.to_string());
        }
    }
    let response =
        notion_request(state, integration, reqwest::Method::GET, url.as_str(), None).await?;
    Ok(notion_block_list_response(response))
}

async fn notion_request(
    state: &AppState,
    integration: &ResolvedOrgIntegration,
    method: reqwest::Method,
    url: &str,
    body: Option<Value>,
) -> ApiResult<Value> {
    provider_json_request(
        &state.http_client,
        method,
        url,
        map_provider_headers(KIND, &integration.secret)?,
        body,
    )
    .await
}

fn create_page_payload(args: &Value) -> ApiResult<Value> {
    let mut body = Map::new();
    body.insert("parent".to_string(), notion_page_parent(args)?);
    body.insert("properties".to_string(), notion_page_properties(args)?);
    insert_page_content(&mut body, args)?;
    insert_optional_object(&mut body, args, &["icon"], "icon")?;
    insert_optional_object(&mut body, args, &["cover"], "cover")?;
    insert_optional_object(&mut body, args, &["template"], "template")?;
    insert_optional_object(&mut body, args, &["position"], "position")?;
    Ok(Value::Object(body))
}

fn update_page_payload(args: &Value) -> ApiResult<Value> {
    if let Some(payload) = optional_object(args, &["payload"])? {
        return Ok(payload);
    }

    let mut body = Map::new();
    if has_any(args, &["properties", "title"]) {
        body.insert("properties".to_string(), notion_page_properties(args)?);
    }
    insert_optional_object(&mut body, args, &["icon"], "icon")?;
    insert_optional_object(&mut body, args, &["cover"], "cover")?;
    insert_optional_object(&mut body, args, &["template"], "template")?;
    insert_optional_bool(
        &mut body,
        args,
        &["in_trash", "inTrash", "archived"],
        "in_trash",
    )?;
    insert_optional_bool(&mut body, args, &["is_locked", "isLocked"], "is_locked")?;
    insert_optional_bool(
        &mut body,
        args,
        &["erase_content", "eraseContent"],
        "erase_content",
    )?;
    if body.is_empty() {
        return Err(ApiError::bad_request(
            "missing page update fields such as `title`, `properties`, `in_trash`, `icon`, or `cover`",
        ));
    }
    Ok(Value::Object(body))
}

fn update_page_markdown_payload(args: &Value) -> ApiResult<Value> {
    if let Some(payload) = optional_object(args, &["payload"])? {
        return Ok(payload);
    }

    let markdown = required_string(args, &["markdown", "content", "body"])?;
    let mut replace_content = Map::new();
    replace_content.insert("new_str".to_string(), Value::String(markdown));
    insert_optional_bool(
        &mut replace_content,
        args,
        &["allow_deleting_content", "allowDeletingContent"],
        "allow_deleting_content",
    )?;

    let mut body = Map::new();
    body.insert(
        "type".to_string(),
        Value::String("replace_content".to_string()),
    );
    body.insert(
        "replace_content".to_string(),
        Value::Object(replace_content),
    );
    insert_optional_bool(
        &mut body,
        args,
        &["allow_async", "allowAsync"],
        "allow_async",
    )?;
    Ok(Value::Object(body))
}

fn append_blocks_payload(args: &Value) -> ApiResult<Value> {
    let mut body = Map::new();
    body.insert("children".to_string(), Value::Array(notion_blocks(args)?));
    if let Some(position) = optional_object(args, &["position"])? {
        body.insert("position".to_string(), position);
    } else if let Some(after) = optional_string(args, &["after_block_id", "afterBlockId"]) {
        body.insert(
            "position".to_string(),
            json!({ "type": "after_block", "after_block": { "id": notion_id_from_ref(&after) } }),
        );
    }
    Ok(Value::Object(body))
}

fn query_data_source_payload(args: &Value) -> ApiResult<Value> {
    if let Some(payload) = optional_object(args, &["payload", "query"])? {
        return Ok(payload);
    }

    let mut body = Map::new();
    insert_optional_object(&mut body, args, &["filter"], "filter")?;
    insert_optional_array(&mut body, args, &["sorts"], "sorts")?;
    insert_optional_page_size(&mut body, args);
    insert_optional_string(
        &mut body,
        args,
        &["start_cursor", "startCursor"],
        "start_cursor",
    );
    Ok(Value::Object(body))
}

fn create_database_payload(args: &Value) -> ApiResult<Value> {
    let mut body = Map::new();
    let title = required_string(args, &["title"])?;
    body.insert("parent".to_string(), notion_database_parent(args)?);
    body.insert("title".to_string(), notion_rich_text_array(&title));
    if let Some(description) = optional_string(args, &["description"]) {
        body.insert(
            "description".to_string(),
            notion_rich_text_array(&description),
        );
    }
    insert_optional_bool(&mut body, args, &["is_inline", "isInline"], "is_inline")?;
    insert_optional_object(&mut body, args, &["icon"], "icon")?;
    insert_optional_object(&mut body, args, &["cover"], "cover")?;

    let initial_data_source = optional_object(args, &["initial_data_source", "initialDataSource"])?
        .unwrap_or_else(|| json!({ "properties": data_source_properties(args) }));
    body.insert("initial_data_source".to_string(), initial_data_source);
    Ok(Value::Object(body))
}

fn create_data_source_payload(args: &Value) -> ApiResult<Value> {
    let mut body = Map::new();
    body.insert("parent".to_string(), notion_data_source_parent(args)?);
    body.insert("properties".to_string(), data_source_properties(args));
    if let Some(title) = optional_string(args, &["title"]) {
        body.insert("title".to_string(), notion_rich_text_array(&title));
    }
    insert_optional_object(&mut body, args, &["icon"], "icon")?;
    Ok(Value::Object(body))
}

fn insert_page_content(body: &mut Map<String, Value>, args: &Value) -> ApiResult<()> {
    if let Some(markdown) =
        optional_string(args, &["markdown", "markdown_contents", "markdownContents"])
    {
        body.insert("markdown".to_string(), Value::String(markdown));
        return Ok(());
    }
    if let Some(children) = optional_array(args, &["children", "blocks"])? {
        if !children.is_empty() {
            body.insert("children".to_string(), Value::Array(children));
        }
        return Ok(());
    }
    let blocks = notion_children_blocks(optional_string(args, &["content", "body"]).as_deref());
    if !blocks.is_empty() {
        body.insert("children".to_string(), Value::Array(blocks));
    }
    Ok(())
}

fn notion_blocks(args: &Value) -> ApiResult<Vec<Value>> {
    if let Some(children) = optional_array(args, &["children", "blocks"])? {
        if !children.is_empty() {
            return Ok(children);
        }
    }
    let blocks = notion_children_blocks(optional_string(args, &["content", "body"]).as_deref());
    if blocks.is_empty() {
        Err(ApiError::bad_request(
            "missing block content: provide `children`, `blocks`, or `content`",
        ))
    } else {
        Ok(blocks)
    }
}

fn notion_page_parent(args: &Value) -> ApiResult<Value> {
    if let Some(parent) = optional_object(args, &["parent"])? {
        return Ok(parent);
    }
    if let Some(page_id) = optional_notion_id(args, &["parent_page_id", "parentPageId"]) {
        return Ok(json!({ "page_id": page_id }));
    }
    if let Some(data_source_id) = optional_notion_id(args, &["data_source_id", "dataSourceId"]) {
        return Ok(json!({ "data_source_id": data_source_id }));
    }
    if let Some(database_id) = optional_notion_id(args, &["database_id", "databaseId"]) {
        return Ok(json!({ "database_id": database_id }));
    }
    if optional_bool(args, &["workspace"])?.unwrap_or(false) {
        return Ok(json!({ "workspace": true }));
    }
    Err(ApiError::bad_request(
        "missing required field `parent_page_id`, `data_source_id`, `database_id`, or `parent`",
    ))
}

fn notion_database_parent(args: &Value) -> ApiResult<Value> {
    if let Some(parent) = optional_object(args, &["parent"])? {
        return Ok(parent);
    }
    if let Some(page_id) = optional_notion_id(args, &["parent_page_id", "parentPageId"]) {
        return Ok(json!({ "page_id": page_id }));
    }
    if optional_bool(args, &["workspace"])?.unwrap_or(false) {
        return Ok(json!({ "workspace": true }));
    }
    Err(ApiError::bad_request(
        "missing required field `parent_page_id` or `parent`",
    ))
}

fn notion_data_source_parent(args: &Value) -> ApiResult<Value> {
    if let Some(parent) = optional_object(args, &["parent"])? {
        return Ok(parent);
    }
    let database_id = required_notion_id(args, &["database_id", "databaseId"])?;
    Ok(json!({ "database_id": database_id }))
}

fn notion_page_properties(args: &Value) -> ApiResult<Value> {
    if let Some(properties) = optional_object(args, &["properties"])? {
        return Ok(properties);
    }
    let title = required_string(args, &["title"])?;
    let title_property = optional_string(args, &["title_property", "titleProperty"])
        .unwrap_or_else(|| {
            if has_any(
                args,
                &[
                    "data_source_id",
                    "dataSourceId",
                    "database_id",
                    "databaseId",
                ],
            ) {
                "Name".to_string()
            } else {
                "title".to_string()
            }
        });
    let mut properties = Map::new();
    properties.insert(title_property, notion_title_property(&title));
    Ok(Value::Object(properties))
}

fn data_source_properties(args: &Value) -> Value {
    args.get("properties")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({ "Name": { "title": {} } }))
}

fn notion_page_list_response(response: Value) -> Value {
    let results = response
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let pages = results
        .iter()
        .map(notion_page_summary)
        .collect::<Vec<Value>>();
    json!({
        "pages": pages,
        "results": results,
        "next_cursor": response.get("next_cursor").cloned().unwrap_or(Value::Null),
        "has_more": response.get("has_more").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn notion_block_list_response(response: Value) -> Value {
    json!({
        "blocks": response.get("results").cloned().unwrap_or_else(|| json!([])),
        "next_cursor": response.get("next_cursor").cloned().unwrap_or(Value::Null),
        "has_more": response.get("has_more").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn notion_page_summary(page: &Value) -> Value {
    json!({
        "id": page.get("id").and_then(Value::as_str).unwrap_or_default(),
        "url": page.get("url").and_then(Value::as_str).unwrap_or_default(),
        "title": notion_page_title(page),
        "properties": page.get("properties").cloned().unwrap_or_else(|| json!({})),
        "parent": page.get("parent").cloned().unwrap_or(Value::Null),
        "created_time": page.get("created_time").cloned().unwrap_or(Value::Null),
        "last_edited_time": page.get("last_edited_time").cloned().unwrap_or(Value::Null),
        "in_trash": page.get("in_trash").cloned().unwrap_or(Value::Null),
        "is_locked": page.get("is_locked").cloned().unwrap_or(Value::Null),
    })
}

fn notion_database_summary(database: &Value) -> Value {
    json!({
        "id": database.get("id").and_then(Value::as_str).unwrap_or_default(),
        "url": database.get("url").and_then(Value::as_str).unwrap_or_default(),
        "title": notion_rich_text_plain(database.get("title")),
        "properties": database.pointer("/initial_data_source/properties")
            .or_else(|| database.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "data_sources": database.get("data_sources").cloned().unwrap_or_else(|| json!([])),
    })
}

fn notion_data_source_summary(data_source: &Value) -> Value {
    json!({
        "id": data_source.get("id").and_then(Value::as_str).unwrap_or_default(),
        "title": notion_rich_text_plain(data_source.get("title")),
        "properties": data_source.get("properties").cloned().unwrap_or_else(|| json!({})),
    })
}

fn notion_page_title(page: &Value) -> String {
    page.get("properties")
        .and_then(Value::as_object)
        .and_then(|properties| {
            properties.values().find_map(|property| {
                property
                    .get("title")
                    .and_then(Value::as_array)
                    .map(|title| notion_rich_text_plain(Some(&Value::Array(title.clone()))))
                    .filter(|title| !title.is_empty())
            })
        })
        .or_else(|| notion_rich_text_plain(page.get("title")).into())
        .unwrap_or_default()
}

fn notion_rich_text_plain(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_array)
        .map(|fragments| {
            fragments
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
        .unwrap_or_default()
}

fn notion_title_property(title: &str) -> Value {
    json!({ "title": notion_rich_text_array(title) })
}

fn notion_rich_text_array(text: &str) -> Value {
    json!([{ "type": "text", "text": { "content": text } }])
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

fn notion_content_mode(args: &Value) -> ApiResult<String> {
    Ok(optional_string(args, &["content_mode", "contentMode"])
        .unwrap_or_else(|| "metadata".to_string())
        .to_ascii_lowercase())
}

fn notion_url(path: &str) -> ApiResult<reqwest::Url> {
    let base_url = app_provider_base_url(KIND)
        .ok_or_else(|| ApiError::internal("notion provider base url missing"))?;
    reqwest::Url::parse(&format!("{}{}", base_url.trim_end_matches('/'), path))
        .map_err(|e| ApiError::internal(format!("invalid notion provider base url: {e}")))
}

fn required_notion_id(args: &Value, keys: &[&str]) -> ApiResult<String> {
    required_string(args, keys).map(|value| notion_id_from_ref(&value))
}

fn optional_notion_id(args: &Value, keys: &[&str]) -> Option<String> {
    optional_string(args, keys).map(|value| notion_id_from_ref(&value))
}

fn notion_id_from_ref(value: &str) -> String {
    let trimmed = value.trim();
    if let Ok(url) = reqwest::Url::parse(trimmed) {
        if let Some(segment) = url
            .path_segments()
            .and_then(|segments| segments.filter(|segment| !segment.is_empty()).last())
        {
            let candidate = segment.rsplit('-').next().unwrap_or(segment);
            if is_notion_id(candidate) {
                return candidate.to_string();
            }
        }
    }
    trimmed.to_string()
}

fn is_notion_id(value: &str) -> bool {
    let normalized = value.replace('-', "");
    normalized.len() == 32 && normalized.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn insert_optional_object(
    body: &mut Map<String, Value>,
    args: &Value,
    keys: &[&str],
    field: &str,
) -> ApiResult<()> {
    if let Some(value) = optional_object(args, keys)? {
        body.insert(field.to_string(), value);
    }
    Ok(())
}

fn insert_optional_array(
    body: &mut Map<String, Value>,
    args: &Value,
    keys: &[&str],
    field: &str,
) -> ApiResult<()> {
    if let Some(value) = optional_array(args, keys)? {
        body.insert(field.to_string(), Value::Array(value));
    }
    Ok(())
}

fn insert_optional_bool(
    body: &mut Map<String, Value>,
    args: &Value,
    keys: &[&str],
    field: &str,
) -> ApiResult<()> {
    if let Some(value) = optional_bool(args, keys)? {
        body.insert(field.to_string(), Value::Bool(value));
    }
    Ok(())
}

fn insert_optional_string(body: &mut Map<String, Value>, args: &Value, keys: &[&str], field: &str) {
    if let Some(value) = optional_string(args, keys) {
        body.insert(field.to_string(), Value::String(value));
    }
}

fn insert_optional_page_size(body: &mut Map<String, Value>, args: &Value) {
    if let Some(page_size) = notion_page_size(args) {
        body.insert("page_size".to_string(), Value::Number(page_size.into()));
    }
}

fn optional_object(args: &Value, keys: &[&str]) -> ApiResult<Option<Value>> {
    optional_typed_value(args, keys, Value::is_object, "object")
}

fn optional_array(args: &Value, keys: &[&str]) -> ApiResult<Option<Vec<Value>>> {
    match optional_typed_value(args, keys, Value::is_array, "array")? {
        Some(Value::Array(values)) => Ok(Some(values)),
        _ => Ok(None),
    }
}

fn optional_bool(args: &Value, keys: &[&str]) -> ApiResult<Option<bool>> {
    keys.iter()
        .find_map(|key| args.get(*key).map(|value| (*key, value)))
        .map(|(key, value)| {
            value
                .as_bool()
                .ok_or_else(|| ApiError::bad_request(format!("field `{key}` must be a boolean")))
        })
        .transpose()
}

fn optional_typed_value(
    args: &Value,
    keys: &[&str],
    predicate: fn(&Value) -> bool,
    expected_type: &str,
) -> ApiResult<Option<Value>> {
    for key in keys {
        if let Some(value) = args.get(*key) {
            if value.is_null() {
                return Ok(None);
            }
            if predicate(value) {
                return Ok(Some(value.clone()));
            }
            return Err(ApiError::bad_request(format!(
                "field `{key}` must be an {expected_type}"
            )));
        }
    }
    Ok(None)
}

fn notion_page_size(args: &Value) -> Option<u64> {
    optional_positive_number(args, &["page_size", "pageSize"])
        .map(|page_size| page_size.clamp(1, MAX_PAGE_SIZE))
}

fn has_any(args: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| args.get(*key).is_some())
}
