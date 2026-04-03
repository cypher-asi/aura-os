use axum::extract::{Path, RawQuery, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

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
        .body(format!(r#"{{"name":"{}"}}"#, skill_name))
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
    Path(agent_id): Path<String>,
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
    Path((agent_id, fact_id)): Path<(String, String)>,
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
    Path(agent_id): Path<String>,
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
    Path((agent_id, fact_id)): Path<(String, String)>,
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
    Path((agent_id, fact_id)): Path<(String, String)>,
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
    Path((agent_id, key)): Path<(String, String)>,
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
    Path(agent_id): Path<String>,
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
    Path(agent_id): Path<String>,
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
    Path((agent_id, event_id)): Path<(String, String)>,
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
    Path(agent_id): Path<String>,
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
    Path((agent_id, proc_id)): Path<(String, String)>,
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
    Path(agent_id): Path<String>,
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
    Path((agent_id, proc_id)): Path<(String, String)>,
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
    Path((agent_id, proc_id)): Path<(String, String)>,
) -> Result<Response, StatusCode> {
    proxy_to_harness(
        Method::DELETE,
        &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        None,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Memory – Aggregate
// ---------------------------------------------------------------------------

pub(crate) async fn get_memory_snapshot(
    State(_state): State<AppState>,
    Path(agent_id): Path<String>,
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
    Path(agent_id): Path<String>,
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
    Path(agent_id): Path<String>,
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
    Path(agent_id): Path<String>,
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
        payload.description.replace('"', "\\\"")
    );
    if let Some(ref tools) = payload.allowed_tools {
        frontmatter.push_str(&format!("allowed_tools: [{}]\n", tools.join(", ")));
    }
    if let Some(ref model) = payload.model {
        frontmatter.push_str(&format!("model: \"{model}\"\n"));
    }
    if let Some(ref context) = payload.context {
        frontmatter.push_str(&format!("context: \"{context}\"\n"));
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
    proxy_to_harness(
        Method::GET,
        &format!("api/skills/{name}"),
        None,
        None,
    )
    .await
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
    Path(agent_id): Path<String>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let resp = proxy_to_harness(
        Method::GET,
        &format!("api/agents/{agent_id}/skills"),
        query,
        None,
    )
    .await?;

    // Harness returns 400 for agents it hasn't seen yet (no session opened).
    // Return an empty list so the UI degrades gracefully.
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
    Path(agent_id): Path<String>,
    body: String,
) -> Result<Response, StatusCode> {
    let path = format!("api/agents/{agent_id}/skills");

    // Forward only the "name" field to the harness — it rejects unknown fields
    // like source_url, and returns 400 for agents it hasn't bootstrapped yet.
    let clean_body = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("name")?.as_str().map(String::from))
        .map(|name| format!(r#"{{"name":"{}"}}"#, name));

    let send_body = clean_body.unwrap_or(body);

    let resp = proxy_to_harness(Method::POST, &path, None, Some(send_body.clone())).await?;

    if resp.status() != StatusCode::BAD_REQUEST {
        return Ok(resp);
    }

    // Harness may not know this agent yet. Bootstrap it by ensuring the agent
    // entry exists (POST to agent root), then retry the skill installation.
    let base = harness_base_url();
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("{base}/api/agents/{agent_id}"))
        .header("Content-Type", "application/json")
        .body(format!(r#"{{"agent_id":"{}"}}"#, agent_id))
        .send()
        .await;

    proxy_to_harness(Method::POST, &path, None, Some(send_body)).await
}

pub(crate) async fn uninstall_agent_skill(
    State(_state): State<AppState>,
    Path((agent_id, name)): Path<(String, String)>,
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

#[derive(Deserialize)]
pub(crate) struct InstallFromShopBody {
    pub name: String,
    pub source_url: String,
}

pub(crate) async fn install_from_shop(
    State(_state): State<AppState>,
    Json(body): Json<InstallFromShopBody>,
) -> Result<Response, StatusCode> {
    let name = body.name.trim().to_lowercase().replace(' ', "-");
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let content = reqwest::Client::new()
        .get(&body.source_url)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .text()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Register the skill with the harness. Try POST first (explicit
    // registration), then fall back to a GET poke for lazy-indexing harnesses.
    let base = harness_base_url();
    let client = reqwest::Client::new();
    let post_ok = client
        .post(format!("{base}/api/skills"))
        .header("Content-Type", "application/json")
        .body(
            serde_json::json!({
                "name": name,
                "path": skill_path.to_string_lossy().to_string(),
                "content": content,
            })
            .to_string(),
        )
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    if !post_ok {
        let _ = client
            .get(format!("{base}/api/skills/{name}"))
            .send()
            .await;
    }

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
