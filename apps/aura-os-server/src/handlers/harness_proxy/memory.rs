use axum::extract::{Path, RawQuery, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;

use aura_os_core::{AgentId, ZeroAuthSession};

use super::require_agent_proxy_access;
use crate::state::{AppState, AuthJwt, AuthSession};

async fn proxy_agent_json(
    state: &AppState,
    jwt: &str,
    session: &ZeroAuthSession,
    agent_id: &AgentId,
    method: Method,
    path: String,
    query: Option<String>,
    body: Option<String>,
) -> Result<Response, StatusCode> {
    require_agent_proxy_access(state, jwt, session, agent_id).await?;
    let query = authenticated_memory_query(state, jwt, session, agent_id, query).await?;
    state
        .harness_http
        .proxy_json(method, &path, query, body)
        .await
}

async fn authenticated_memory_query(
    state: &AppState,
    jwt: &str,
    session: &ZeroAuthSession,
    agent_id: &AgentId,
    query: Option<String>,
) -> Result<Option<String>, StatusCode> {
    let (mut pairs, project_id) = canonical_memory_query(query.as_deref(), &session.user_id)?;

    if let Some(project_id) = project_id.as_deref() {
        let storage = state
            .storage_client
            .as_deref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        let bindings = crate::handlers::agents::chat::find_matching_project_agents(
            state,
            storage,
            jwt,
            &agent_id.to_string(),
        )
        .await;
        let has_binding = bindings
            .iter()
            .any(|binding| binding.project_id.as_deref() == Some(project_id));
        if !has_binding
            && !owned_session_matches_project(storage, jwt, agent_id, project_id).await?
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    if let Some(project_id) = project_id {
        pairs.push(("project_id".to_string(), project_id));
    }
    let encoded = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs)
        .finish();
    Ok(Some(encoded))
}

async fn owned_session_matches_project(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id: &AgentId,
    project_id: &str,
) -> Result<bool, StatusCode> {
    let agent_id = agent_id.to_string();
    let sessions = storage
        .list_my_sessions(jwt)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(sessions.iter().any(|entry| {
        entry.agent_id.as_deref() == Some(agent_id.as_str())
            && entry.session.project_id.as_deref() == Some(project_id)
    }))
}

type MemoryQueryPairs = Vec<(String, String)>;

fn canonical_memory_query(
    query: Option<&str>,
    authenticated_user_id: &str,
) -> Result<(MemoryQueryPairs, Option<String>), StatusCode> {
    let mut pairs: MemoryQueryPairs = query
        .map(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .filter(|(key, _)| key != "user_id")
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect()
        })
        .unwrap_or_default();

    let project_ids: std::collections::HashSet<String> = pairs
        .iter()
        .filter(|(key, value)| key == "project_id" && !value.trim().is_empty())
        .map(|(_, value)| value.clone())
        .collect();
    if project_ids.len() > 1 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let project_id = project_ids.into_iter().next();
    pairs.retain(|(key, _)| key != "project_id");

    pairs.push(("user_id".to_string(), authenticated_user_id.to_string()));
    Ok((pairs, project_id))
}

pub(crate) async fn list_facts(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/facts"),
        query,
        None,
    )
    .await
}

pub(crate) async fn get_fact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
        query,
        None,
    )
    .await
}

pub(crate) async fn create_fact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::POST,
        format!("api/agents/{agent_id}/memory/facts"),
        query,
        Some(body),
    )
    .await
}

pub(crate) async fn update_fact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::PUT,
        format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
        query,
        Some(body),
    )
    .await
}

pub(crate) async fn delete_fact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, fact_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::DELETE,
        format!("api/agents/{agent_id}/memory/facts/{fact_id}"),
        query,
        None,
    )
    .await
}

pub(crate) async fn get_fact_by_key(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, key)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/facts/by-key/{key}"),
        query,
        None,
    )
    .await
}

pub(crate) async fn list_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/events"),
        query,
        None,
    )
    .await
}

pub(crate) async fn create_event(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::POST,
        format!("api/agents/{agent_id}/memory/events"),
        query,
        Some(body),
    )
    .await
}

pub(crate) async fn delete_event(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, event_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::DELETE,
        format!("api/agents/{agent_id}/memory/events/{event_id}"),
        query,
        None,
    )
    .await
}

pub(crate) async fn list_procedures(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/procedures"),
        query,
        None,
    )
    .await
}

pub(crate) async fn get_procedure(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        query,
        None,
    )
    .await
}

pub(crate) async fn create_procedure(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::POST,
        format!("api/agents/{agent_id}/memory/procedures"),
        query,
        Some(body),
    )
    .await
}

pub(crate) async fn update_procedure(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::PUT,
        format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        query,
        Some(body),
    )
    .await
}

pub(crate) async fn delete_procedure(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, proc_id)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::DELETE,
        format!("api/agents/{agent_id}/memory/procedures/{proc_id}"),
        query,
        None,
    )
    .await
}

pub(crate) async fn list_procedures_by_skill(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, skill_name)): Path<(AgentId, String)>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let mut qs = format!("skill={skill_name}");
    if let Some(q) = query {
        qs = format!("{qs}&{q}");
    }
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/procedures"),
        Some(qs),
        None,
    )
    .await
}

pub(crate) async fn get_memory_snapshot(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory"),
        query,
        None,
    )
    .await
}

pub(crate) async fn wipe_memory(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::DELETE,
        format!("api/agents/{agent_id}/memory"),
        query,
        None,
    )
    .await
}

pub(crate) async fn get_memory_stats(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/stats"),
        query,
        None,
    )
    .await
}

pub(crate) async fn trigger_consolidation(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::POST,
        format!("api/agents/{agent_id}/memory/consolidate"),
        query,
        Some(body),
    )
    .await
}

pub(crate) async fn get_continuity_config(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/continuity"),
        None,
        None,
    )
    .await
}

pub(crate) async fn update_continuity_config(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::PUT,
        format!("api/agents/{agent_id}/memory/continuity"),
        None,
        Some(body),
    )
    .await
}

pub(crate) async fn get_latest_retrieval_trace(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    proxy_agent_json(
        &state,
        &jwt,
        &session,
        &agent_id,
        Method::GET,
        format!("api/agents/{agent_id}/memory/retrieval/latest"),
        query,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::canonical_memory_query;
    use axum::http::StatusCode;

    #[test]
    fn memory_query_replaces_spoofed_user_identity() {
        let (pairs, project_id) = canonical_memory_query(
            Some("project_id=project-a&user_id=attacker&include_legacy=true"),
            "signed-in-user",
        )
        .expect("query should canonicalize");

        assert_eq!(project_id.as_deref(), Some("project-a"));
        assert_eq!(
            pairs
                .iter()
                .filter(|(key, _)| key == "user_id")
                .map(|(_, value)| value.as_str())
                .collect::<Vec<_>>(),
            vec!["signed-in-user"]
        );
        assert!(pairs
            .iter()
            .any(|(key, value)| key == "include_legacy" && value == "true"));
    }

    #[test]
    fn memory_query_rejects_ambiguous_project_identity() {
        let error = canonical_memory_query(
            Some("project_id=project-a&project_id=project-b"),
            "signed-in-user",
        )
        .expect_err("two project identities must fail closed");
        assert_eq!(error, StatusCode::BAD_REQUEST);
    }
}
