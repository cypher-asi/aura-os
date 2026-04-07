use axum::extract::{Path, RawQuery, State};
use axum::http::Method;
use axum::response::Response;

use aura_os_core::AgentId;

use crate::state::AppState;

pub(crate) async fn list_facts(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/facts"),
            query,
            None,
        )
        .await
}

pub(crate) async fn get_fact(
    State(state): State<AppState>,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
            None,
            None,
        )
        .await
}

pub(crate) async fn create_fact(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/agents/{agent_id}/memory/facts"),
            None,
            Some(body),
        )
        .await
}

pub(crate) async fn update_fact(
    State(state): State<AppState>,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
    body: String,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::PUT,
            &format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
            None,
            Some(body),
        )
        .await
}

pub(crate) async fn delete_fact(
    State(state): State<AppState>,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::DELETE,
            &format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
            None,
            None,
        )
        .await
}

pub(crate) async fn get_fact_by_key(
    State(state): State<AppState>,
    Path((agent_id, key)): Path<(AgentId, String)>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/facts/by-key/{key}"),
            None,
            None,
        )
        .await
}

pub(crate) async fn list_events(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/events"),
            query,
            None,
        )
        .await
}

pub(crate) async fn create_event(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/agents/{agent_id}/memory/events"),
            None,
            Some(body),
        )
        .await
}

pub(crate) async fn delete_event(
    State(state): State<AppState>,
    Path((agent_id, event_id)): Path<(AgentId, String)>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::DELETE,
            &format!("api/agents/{agent_id}/memory/events/{event_id}"),
            None,
            None,
        )
        .await
}

pub(crate) async fn list_procedures(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/procedures"),
            query,
            None,
        )
        .await
}

pub(crate) async fn get_procedure(
    State(state): State<AppState>,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
            None,
            None,
        )
        .await
}

pub(crate) async fn create_procedure(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/agents/{agent_id}/memory/procedures"),
            None,
            Some(body),
        )
        .await
}

pub(crate) async fn update_procedure(
    State(state): State<AppState>,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
    body: String,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::PUT,
            &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
            None,
            Some(body),
        )
        .await
}

pub(crate) async fn delete_procedure(
    State(state): State<AppState>,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::DELETE,
            &format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
            None,
            None,
        )
        .await
}

pub(crate) async fn list_procedures_by_skill(
    State(state): State<AppState>,
    Path((agent_id, skill_name)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, axum::http::StatusCode> {
    let mut qs = format!("skill={skill_name}");
    if let Some(q) = query {
        qs = format!("{qs}&{q}");
    }
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/procedures"),
            Some(qs),
            None,
        )
        .await
}

pub(crate) async fn get_memory_snapshot(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory"),
            query,
            None,
        )
        .await
}

pub(crate) async fn wipe_memory(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::DELETE,
            &format!("api/agents/{agent_id}/memory"),
            None,
            None,
        )
        .await
}

pub(crate) async fn get_memory_stats(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::GET,
            &format!("api/agents/{agent_id}/memory/stats"),
            query,
            None,
        )
        .await
}

pub(crate) async fn trigger_consolidation(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, axum::http::StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/agents/{agent_id}/memory/consolidate"),
            None,
            Some(body),
        )
        .await
}
