use axum::extract::{Path, RawQuery, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::AgentId;

use crate::state::AppState;

/// Escape a string for use as a YAML double-quoted scalar value.
/// The caller wraps the result in `"..."` — this function escapes the interior.
fn yaml_escape_scalar(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

pub(crate) fn harness_base_url() -> String {
    std::env::var("LOCAL_HARNESS_URL").unwrap_or_else(|_| "http://localhost:8080".to_string())
}

pub(crate) async fn install_skill_for_agent(agent_id: &str, skill_name: &str) -> bool {
    let base = harness_base_url();
    let url = format!("{base}/api/agents/{agent_id}/skills");
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(serde_json::json!({"name": skill_name}).to_string())
        .send()
        .await;
    matches!(resp, Ok(r) if r.status().is_success())
}

async fn proxy_to_harness(
    method: Method,
    path: &str,
    query: Option<String>,
    body: Option<String>,
) -> Result<Response, StatusCode> {
    let base = harness_base_url();
    let url = match query {
        Some(q) => format!("{base}/{path}?{q}"),
        None => format!("{base}/{path}"),
    };

    let client = reqwest::Client::new();
    let mut req = match method {
        Method::GET => client.get(&url),
        Method::POST => client.post(&url),
        Method::PUT => client.put(&url),
        Method::DELETE => client.delete(&url),
        _ => return Err(StatusCode::METHOD_NOT_ALLOWED),
    };

    req = req.header("Content-Type", "application/json");
    if let Some(body) = body {
        req = req.body(body);
    }

    let resp = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = resp.text().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok((status, [(header::CONTENT_TYPE, "application/json")], body).into_response())
}

// ---------------------------------------------------------------------------
// Memory – Facts
// ---------------------------------------------------------------------------

pub(crate) async fn list_facts(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/facts"),
        query,
        None,
    )
    .await
}

pub(crate) async fn get_fact(
    State(_state): State<AppState>,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
        None,
        None,
    )
    .await
}

pub(crate) async fn create_fact(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::POST,
        &format!("api/agents/{agent_id}/memory/facts"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn update_fact(
    State(_state): State<AppState>,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::PUT,
        &format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn delete_fact(
    State(_state): State<AppState>,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::DELETE,
        &format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
        None,
        None,
    )
    .await
}

pub(crate) async fn get_fact_by_key(
    State(_state): State<AppState>,
    Path((agent_id, key)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/facts/by-key/{key}"),
        None,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Memory – Events
// ---------------------------------------------------------------------------

pub(crate) async fn list_events(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/events"),
        query,
        None,
    )
    .await
}

pub(crate) async fn create_event(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::POST,
        &format!("api/agents/{agent_id}/memory/events"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn delete_event(
    State(_state): State<AppState>,
    Path((agent_id, event_id)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::DELETE,
        &format!("api/agents/{agent_id}/memory/events/{event_id}"),
        None,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Memory – Procedures
// ---------------------------------------------------------------------------

pub(crate) async fn list_procedures(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/procedures"),
        query,
        None,
    )
    .await
}

pub(crate) async fn get_procedure(
    State(_state): State<AppState>,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        None,
        None,
    )
    .await
}

pub(crate) async fn create_procedure(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::POST,
        &format!("api/agents/{agent_id}/memory/procedures"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn update_procedure(
    State(_state): State<AppState>,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::PUT,
        &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn delete_procedure(
    State(_state): State<AppState>,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::DELETE,
        &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        None,
        None,
    )
    .await
}

pub(crate) async fn list_procedures_by_skill(
    State(_state): State<AppState>,
    Path((agent_id, skill_name)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let mut qs = format!("skill={skill_name}");
    if let Some(q) = query {
        qs = format!("{qs}&{q}");
    }
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/procedures"),
        Some(qs),
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Memory – Aggregate
// ---------------------------------------------------------------------------

pub(crate) async fn get_memory_snapshot(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory"),
        query,
        None,
    )
    .await
}

pub(crate) async fn wipe_memory(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::DELETE,
        &format!("api/agents/{agent_id}/memory"),
        None,
        None,
    )
    .await
}

pub(crate) async fn get_memory_stats(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/memory/stats"),
        query,
        None,
    )
    .await
}

pub(crate) async fn trigger_consolidation(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::POST,
        &format!("api/agents/{agent_id}/memory/consolidate"),
        None,
        Some(body),
    )
    .await
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

pub(crate) async fn list_skills(
    State(_state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_to_harness(Method::GET, "api/skills", query, None).await
}

#[derive(Deserialize)]
pub(crate) struct CreateSkillBody {
    pub name: String,
    pub description: String,
    pub body: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub context: Option<String>,
    pub user_invocable: Option<bool>,
    pub model_invocable: Option<bool>,
}

#[derive(Serialize)]
struct CreateSkillResponse {
    name: String,
    path: String,
    created: bool,
}

pub(crate) async fn create_skill(
    State(_state): State<AppState>,
    Json(payload): Json<CreateSkillBody>,
) -> Result<Response, StatusCode> {
    let valid = !payload.name.is_empty()
        && payload.name.len() <= 64
        && payload
            .name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(StatusCode::BAD_REQUEST);
    }

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&payload.name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut frontmatter = format!(
        "---\ndescription: \"{}\"\n",
        yaml_escape_scalar(&payload.description)
    );
    if let Some(ref tools) = payload.allowed_tools {
        frontmatter.push_str(&format!("allowed_tools: [{}]\n", tools.join(", ")));
    }
    if let Some(ref model) = payload.model {
        frontmatter.push_str(&format!("model: \"{}\"\n", yaml_escape_scalar(model)));
    }
    if let Some(ref context) = payload.context {
        frontmatter.push_str(&format!("context: \"{}\"\n", yaml_escape_scalar(context)));
    }
    frontmatter.push_str(&format!(
        "user_invocable: {}\n",
        payload.user_invocable.unwrap_or(true)
    ));
    frontmatter.push_str(&format!(
        "model_invocable: {}\n",
        payload.model_invocable.unwrap_or(false)
    ));
    frontmatter.push_str("---\n");

    let body_text = payload.body.unwrap_or_default();
    let content = format!("{frontmatter}\n{body_text}");

    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let resp = CreateSkillResponse {
        name: payload.name,
        path: skill_path.to_string_lossy().into_owned(),
        created: true,
    };
    let body = serde_json::to_string(&resp).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

pub(crate) async fn get_skill(
    State(_state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(Method::GET, &format!("api/skills/{name}"), None, None).await
}

pub(crate) async fn activate_skill(
    State(_state): State<AppState>,
    Path(name): Path<String>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::POST,
        &format!("api/skills/{name}/activate"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn list_agent_skills(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let resp = proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/skills"),
        query,
        None,
    )
    .await?;

    if resp.status() == StatusCode::BAD_REQUEST {
        return Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            "[]",
        )
            .into_response());
    }

    Ok(resp)
}

pub(crate) async fn install_agent_skill(
    State(_state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    let path = format!("api/agents/{agent_id}/skills");

    let clean_body = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .map(|v| {
            let name = v.get("name").and_then(|n| n.as_str()).unwrap_or_default();
            let approved_paths = v
                .get("approved_paths")
                .cloned()
                .unwrap_or(serde_json::json!([]));
            let approved_commands = v
                .get("approved_commands")
                .cloned()
                .unwrap_or(serde_json::json!([]));
            serde_json::json!({
                "name": name,
                "approved_paths": approved_paths,
                "approved_commands": approved_commands,
            })
            .to_string()
        });

    let send_body = clean_body.unwrap_or(body);
    proxy_to_harness(Method::POST, &path, None, Some(send_body)).await
}

pub(crate) async fn uninstall_agent_skill(
    State(_state): State<AppState>,
    Path((agent_id, name)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::DELETE,
        &format!("api/agents/{agent_id}/skills/{name}"),
        None,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Install skill from shop (fetch SKILL.md from URL)
// ---------------------------------------------------------------------------

fn skills_base_dir() -> std::path::PathBuf {
    std::env::var("SKILLS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("skills"))
}

#[derive(Deserialize)]
pub(crate) struct InstallFromShopBody {
    pub name: String,
    pub category: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

pub(crate) async fn install_from_shop(
    State(_state): State<AppState>,
    Json(body): Json<InstallFromShopBody>,
) -> Result<Response, StatusCode> {
    let name = body.name.trim().to_lowercase().replace(' ', "-");
    if name.is_empty()
        || name.len() > 64
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let content = if let Some(ref category) = body.category {
        let local_path = skills_base_dir()
            .join(category)
            .join(&name)
            .join("SKILL.md");
        std::fs::read_to_string(&local_path).map_err(|_| StatusCode::NOT_FOUND)?
    } else if let Some(ref source_url) = body.source_url {
        reqwest::Client::new()
            .get(source_url)
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .text()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
    } else {
        return Err(StatusCode::BAD_REQUEST);
    };

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let description = extract_frontmatter_field(&content, "description")
        .unwrap_or_else(|| format!("{name} skill"));
    let body_text = strip_frontmatter(&content);

    let base = harness_base_url();
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("{base}/api/skills"))
        .header("Content-Type", "application/json")
        .body(
            serde_json::json!({
                "name": name,
                "description": description,
                "body": body_text,
                "user_invocable": true,
            })
            .to_string(),
        )
        .send()
        .await;

    let resp_json = serde_json::json!({
        "name": name,
        "path": skill_path.to_string_lossy(),
        "installed": true,
    });

    Ok((
        StatusCode::CREATED,
        [(header::CONTENT_TYPE, "application/json")],
        resp_json.to_string(),
    )
        .into_response())
}

pub(crate) async fn discover_skill_paths(Path(name): Path<String>) -> Result<Response, StatusCode> {
    let paths = match name.as_str() {
        "obsidian" => discover_obsidian_vaults(),
        _ => vec![],
    };

    let resp = serde_json::json!({ "paths": paths });
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        resp.to_string(),
    )
        .into_response())
}

fn discover_obsidian_vaults() -> Vec<String> {
    let appdata = match std::env::var("APPDATA") {
        Ok(v) => std::path::PathBuf::from(v),
        Err(_) => {
            if let Some(home) = dirs::home_dir() {
                home.join("Library/Application Support")
            } else {
                return vec![];
            }
        }
    };

    let obsidian_config_dir = appdata.join("obsidian");
    let config_path = obsidian_config_dir.join("obsidian.json");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let parsed: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let Some(vaults) = parsed.get("vaults").and_then(|v| v.as_object()) else {
        return vec![];
    };

    let mut paths: Vec<String> = vec![obsidian_config_dir.to_string_lossy().to_string()];
    for v in vaults.values() {
        let open = v.get("open").and_then(|o| o.as_bool()).unwrap_or(false);
        if let (true, Some(path)) = (open, v.get("path").and_then(|p| p.as_str())) {
            paths.push(path.to_string());
        }
    }
    paths
}

pub(crate) async fn get_skill_content(
    Path((category, name)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    let safe = |s: &str| {
        !s.is_empty()
            && !s.contains("..")
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    if !safe(&category) || !safe(&name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let local_path = skills_base_dir()
        .join(&category)
        .join(&name)
        .join("SKILL.md");
    let content = std::fs::read_to_string(&local_path).map_err(|_| StatusCode::NOT_FOUND)?;

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        content,
    )
        .into_response())
}

fn extract_frontmatter_field(content: &str, key: &str) -> Option<String> {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return None;
    }
    let end = trimmed[3..].find("\n---")?;
    let yaml = &trimmed[3..3 + end];
    let prefix = format!("{key}:");
    for line in yaml.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix(&prefix) {
            return Some(val.trim().trim_matches('"').to_string());
        }
    }
    None
}

fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return content.to_string();
    }
    match trimmed[3..].find("\n---") {
        Some(end) => trimmed[3 + end + 4..].trim_start().to_string(),
        None => content.to_string(),
    }
}
