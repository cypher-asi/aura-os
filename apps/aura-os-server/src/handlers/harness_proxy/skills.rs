use axum::extract::{Path, RawQuery, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use aura_os_core::AgentId;

use super::skill_exists_on_disk;
use crate::state::AppState;

/// Proxies `GET api/skills` to the harness catalog, but filters out any
/// entries whose `~/.aura/skills/<name>/SKILL.md` is gone. The external
/// harness maintains its catalog in-memory and only reconciles on rescan,
/// so a skill the user just deleted can linger there for a while and
/// resurface under "Available" in the UI. The filesystem is the source of
/// truth — if the SKILL.md is gone, the skill is gone.
pub(crate) async fn list_skills(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let upstream = state
        .harness_http
        .proxy_json(Method::GET, "api/skills", query, None)
        .await?;

    // Only rewrite successful JSON array responses. Leave error responses
    // and non-array shapes (e.g. error envelopes like `{ "skills": [...] }`
    // or anything the harness returns on failure) intact.
    if !upstream.status().is_success() {
        return Ok(upstream);
    }

    let (parts, body) = upstream.into_parts();
    let bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(b) => b,
        Err(_) => return Err(StatusCode::BAD_GATEWAY),
    };

    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Ok(Response::from_parts(parts, axum::body::Body::from(bytes)));
    };

    // The harness typically returns a bare JSON array, but handle the
    // envelope form `{ "skills": [...] }` too.
    let filtered = match value {
        serde_json::Value::Array(entries) => {
            let kept: Vec<_> = entries
                .into_iter()
                .filter(|e| {
                    e.get("name")
                        .and_then(|n| n.as_str())
                        .map(skill_exists_on_disk)
                        .unwrap_or(true)
                })
                .collect();
            serde_json::Value::Array(kept)
        }
        serde_json::Value::Object(mut map) => {
            if let Some(serde_json::Value::Array(entries)) = map.remove("skills") {
                let kept: Vec<_> = entries
                    .into_iter()
                    .filter(|e| {
                        e.get("name")
                            .and_then(|n| n.as_str())
                            .map(skill_exists_on_disk)
                            .unwrap_or(true)
                    })
                    .collect();
                map.insert("skills".into(), serde_json::Value::Array(kept));
            }
            serde_json::Value::Object(map)
        }
        other => other,
    };

    let body = serde_json::to_vec(&filtered).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        parts.status,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
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
