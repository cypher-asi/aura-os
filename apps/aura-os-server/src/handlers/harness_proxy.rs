use axum::extract::{Path, RawQuery, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

fn harness_base_url() -> String {
    std::env::var("LOCAL_HARNESS_URL").unwrap_or_else(|_| "http://localhost:8080".to_string())
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
