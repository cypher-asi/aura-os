use axum::extract::{Path, RawQuery, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use aura_os_core::AgentId;
use tracing::warn;

use super::require_agent_proxy_access;
use super::{
    adopt_installed_legacy_skill, cloud_skill_metadata_for_name, find_cloud_skill_by_name,
    materialize_cloud_skill, skill_exists_on_disk, sync_all_cloud_skills,
};
use crate::capture_auth::is_capture_access_token;
use crate::state::{AppState, AuthJwt, AuthSession};

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    if is_capture_access_token(&jwt) {
        return Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            "[]",
        )
            .into_response());
    }
    require_agent_proxy_access(&state, &jwt, &session, &agent_id).await?;
    reconcile_cloud_agent_skills(&state, &jwt, &agent_id).await;

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(agent_id): Path<AgentId>,
    body: String,
) -> Result<Response, StatusCode> {
    require_agent_proxy_access(&state, &jwt, &session, &agent_id).await?;
    let path = format!("api/agents/{agent_id}/skills");
    let skill_name = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .get("name")
                .and_then(|name| name.as_str())
                .map(str::to_owned)
        });

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
    let response = state
        .harness_http
        .proxy_json(Method::POST, &path, None, Some(send_body))
        .await?;
    if response.status().is_success() {
        if let Some(skill_name) = skill_name {
            sync_agent_skill_assignment(&state, &jwt, &agent_id, &skill_name).await;
        }
    }
    Ok(response)
}

pub(crate) async fn uninstall_agent_skill(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((agent_id, name)): Path<(AgentId, String)>,
) -> Result<Response, StatusCode> {
    require_agent_proxy_access(&state, &jwt, &session, &agent_id).await?;
    let cloud_metadata = cloud_skill_metadata_for_name(&name);
    let mut removed_canonical_assignment = None;
    if let (Some(storage), Some(metadata)) = (state.storage_client.as_ref(), cloud_metadata) {
        match storage
            .unassign_agent_skill(&agent_id.to_string(), &metadata.id, &jwt)
            .await
        {
            Ok(()) => removed_canonical_assignment = Some(metadata.id),
            Err(aura_os_storage::StorageError::Server { status: 404, .. }) => {}
            Err(error) => {
                warn!(
                    %error,
                    skill = %name,
                    agent = %agent_id,
                    "cloud skill unassignment was not confirmed; retaining local installation"
                );
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        }
    }

    let response = match state
        .harness_http
        .proxy_json(
            Method::DELETE,
            &format!("api/agents/{agent_id}/skills/{name}"),
            None,
            None,
        )
        .await
    {
        Ok(response) => response,
        Err(status) => {
            if let (Some(storage), Some(skill_id)) =
                (state.storage_client.as_ref(), removed_canonical_assignment)
            {
                let _ = storage
                    .assign_agent_skill(&agent_id.to_string(), &skill_id, &jwt)
                    .await;
            }
            return Err(status);
        }
    };
    if !response.status().is_success() {
        if let (Some(storage), Some(skill_id)) =
            (state.storage_client.as_ref(), removed_canonical_assignment)
        {
            if let Err(error) = storage
                .assign_agent_skill(&agent_id.to_string(), &skill_id, &jwt)
                .await
            {
                warn!(
                    %error,
                    skill = %name,
                    agent = %agent_id,
                    "local skill uninstall failed and cloud assignment compensation is pending"
                );
            }
        }
    }
    Ok(response)
}

fn installed_skill_names(value: Option<serde_json::Value>) -> std::collections::HashSet<String> {
    let Some(value) = value else {
        return std::collections::HashSet::new();
    };
    value
        .as_array()
        .or_else(|| value.get("skills").and_then(|value| value.as_array()))
        .or_else(|| {
            value
                .get("installations")
                .and_then(|value| value.as_array())
        })
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            entry
                .get("skill_name")
                .or_else(|| entry.get("name"))
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .collect()
}

async fn reconcile_cloud_agent_skills(state: &AppState, jwt: &str, agent_id: &AgentId) {
    sync_all_cloud_skills(state, jwt).await;
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let installed = installed_skill_names(
        state
            .harness_http
            .fetch_json(Method::GET, &format!("api/agents/{agent_id}/skills"))
            .await,
    );
    for skill_name in &installed {
        adopt_installed_legacy_skill(state, jwt, &agent_id.to_string(), skill_name).await;
    }
    let cloud_skills = match storage
        .list_agent_skills(&agent_id.to_string(), jwt, None)
        .await
    {
        Ok(skills) => skills,
        Err(error) => {
            warn!(%error, agent = %agent_id, "cloud agent-skill reconciliation unavailable");
            return;
        }
    };
    for skill in cloud_skills {
        if !materialize_cloud_skill(state, &skill).await {
            warn!(
                skill = %skill.name,
                agent = %agent_id,
                "canonical skill definition is not available in the harness; assignment sync will retry"
            );
            continue;
        }
        if installed.contains(&skill.name) {
            // Existing installations retain their device-local grants.
            continue;
        }
        let installed_ok = state
            .harness_http
            .post_json_ok(
                &format!("api/agents/{agent_id}/skills"),
                serde_json::json!({
                    "name": &skill.name,
                    "approved_paths": [],
                    "approved_commands": [],
                })
                .to_string(),
            )
            .await;
        if !installed_ok {
            warn!(
                skill = %skill.name,
                agent = %agent_id,
                "harness rejected canonical agent-skill assignment; sync will retry"
            );
        }
    }
}

async fn sync_agent_skill_assignment(
    state: &AppState,
    jwt: &str,
    agent_id: &AgentId,
    skill_name: &str,
) {
    let (Some(storage), Some(skill)) = (
        state.storage_client.as_ref(),
        find_cloud_skill_by_name(state, jwt, skill_name).await,
    ) else {
        return;
    };
    if let Err(error) = storage
        .assign_agent_skill(&agent_id.to_string(), &skill.id, jwt)
        .await
    {
        warn!(%error, skill = %skill_name, agent = %agent_id, "local skill install succeeded; cloud assignment is pending");
    }
}

#[cfg(test)]
mod tests {
    use super::installed_skill_names;

    #[test]
    fn reconciliation_recognizes_existing_installations_without_reading_device_grants() {
        let names = installed_skill_names(Some(serde_json::json!([
            {
                "skill_name": "release-check",
                "approved_paths": ["/private/work"],
                "approved_commands": ["deploy"]
            }
        ])));
        assert!(names.contains("release-check"));
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn reconciliation_accepts_harness_envelope_shapes() {
        let names = installed_skill_names(Some(serde_json::json!({
            "installations": [{ "skill_name": "browser" }]
        })));
        assert!(names.contains("browser"));
    }
}
