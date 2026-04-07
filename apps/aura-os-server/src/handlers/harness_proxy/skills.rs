use axum::extract::{Path, RawQuery, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use aura_os_core::AgentId;

use crate::state::AppState;

pub(crate) async fn list_skills(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    state
        .harness_http
        .proxy_json(Method::GET, "api/skills", query, None)
        .await
}

pub(crate) async fn get_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Response, StatusCode> {
    state
        .harness_http
        .proxy_json(Method::GET, &format!("api/skills/{name}"), None, None)
        .await
}

pub(crate) async fn activate_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
    body: String,
) -> Result<Response, StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::POST,
            &format!("api/skills/{name}/activate"),
            None,
            Some(body),
        )
        .await
}

pub(crate) async fn list_agent_skills(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let resp = state
        .harness_http
        .proxy_json(
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
    State(state): State<AppState>,
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
    state
        .harness_http
        .proxy_json(Method::POST, &path, None, Some(send_body))
        .await
}

pub(crate) async fn uninstall_agent_skill(
    State(state): State<AppState>,
    Path((agent_id, name)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    state
        .harness_http
        .proxy_json(
            Method::DELETE,
            &format!("api/agents/{agent_id}/skills/{name}"),
            None,
            None,
        )
        .await
}
