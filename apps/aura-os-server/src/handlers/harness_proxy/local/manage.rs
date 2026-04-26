//! `GET /api/harness/skills/mine` (list) and `DELETE` (delete) routes
//! for user-authored skills.

use axum::extract::{Path, State};
use axum::http::{header, Method, StatusCode};
use axum::response::IntoResponse;

use crate::state::AppState;

use super::frontmatter::extract_frontmatter_field;
use super::{create_skill_name_valid, USER_CREATED_SOURCE_MARKER};

#[derive(serde::Serialize)]
struct MySkillEntry {
    name: String,
    description: String,
    path: String,
    user_invocable: bool,
    model_invocable: bool,
}

fn skill_entry_from_dir(path: &std::path::Path) -> Option<MySkillEntry> {
    if !path.is_dir() {
        return None;
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())?;
    if name.starts_with('.') {
        return None;
    }

    let skill_path = path.join("SKILL.md");
    let content = std::fs::read_to_string(&skill_path).ok()?;

    let source = extract_frontmatter_field(&content, "source").unwrap_or_default();
    if source != USER_CREATED_SOURCE_MARKER {
        return None;
    }

    let description = extract_frontmatter_field(&content, "description").unwrap_or_default();
    let user_invocable = extract_frontmatter_field(&content, "user_invocable")
        .map(|v| v == "true")
        .unwrap_or(true);
    let model_invocable = extract_frontmatter_field(&content, "model_invocable")
        .map(|v| v == "true")
        .unwrap_or(false);

    Some(MySkillEntry {
        name,
        description,
        path: skill_path.to_string_lossy().into_owned(),
        user_invocable,
        model_invocable,
    })
}

/// List skills the current user authored via `POST /api/harness/skills`.
/// Scans `~/.aura/skills/*/SKILL.md` and returns only entries whose
/// frontmatter carries `source: "user-created"` — this reliably excludes
/// shop-installed skills, which share the same on-disk layout but do not
/// carry that marker.
pub(crate) async fn list_my_skills() -> Result<axum::response::Response, StatusCode> {
    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skills_root = home.join(".aura").join("skills");

    let entries = match std::fs::read_dir(&skills_root) {
        Ok(entries) => entries,
        // Directory may not exist yet (user hasn't created any skills).
        // Treat as an empty list rather than an error so the UI renders cleanly.
        Err(_) => {
            return Ok((
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json")],
                "[]",
            )
                .into_response());
        }
    };

    let mut results: Vec<MySkillEntry> = Vec::new();
    for entry in entries.flatten() {
        if let Some(skill) = skill_entry_from_dir(&entry.path()) {
            results.push(skill);
        }
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));

    let body = serde_json::to_string(&results).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

async fn agents_blocking_skill_delete(
    state: &AppState,
    skill_name: &str,
) -> Result<Vec<serde_json::Value>, StatusCode> {
    let agents = state
        .agent_service
        .list_agents()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let checks = agents.iter().map(|agent| {
        let harness_http = state.harness_http.clone();
        let agent_id = agent.agent_id.to_string();
        async move {
            let value = harness_http
                .fetch_json(Method::GET, &format!("api/agents/{agent_id}/skills"))
                .await;
            (agent_id, value)
        }
    });
    let per_agent = futures_util::future::join_all(checks).await;
    let mut blocking = Vec::new();
    for (agent_id, value) in per_agent {
        let Some(value) = value else { continue };
        let list = value
            .as_array()
            .cloned()
            .or_else(|| value.get("skills").and_then(|v| v.as_array()).cloned())
            .or_else(|| {
                value
                    .get("installations")
                    .and_then(|v| v.as_array())
                    .cloned()
            })
            .unwrap_or_default();
        let has_skill = list
            .iter()
            .any(|entry| entry.get("skill_name").and_then(|v| v.as_str()) == Some(skill_name));
        if has_skill {
            let agent_name = agents
                .iter()
                .find(|a| a.agent_id.to_string() == agent_id)
                .map(|a| a.name.clone())
                .unwrap_or_default();
            blocking.push(serde_json::json!({
                "agent_id": agent_id,
                "name": agent_name,
            }));
        }
    }
    Ok(blocking)
}

/// Permanently delete a user-authored skill. Removes
/// `~/.aura/skills/<name>/` from disk and fires a best-effort
/// `DELETE api/skills/<name>` at the harness catalog.
///
/// Preconditions:
/// - The on-disk SKILL.md must carry the `source: "user-created"`
///   marker. This prevents this endpoint from being used to delete
///   shop-installed skills that happen to share the same on-disk layout.
/// - The skill must NOT be installed on any local agent. Deleting a
///   skill that is still installed elsewhere would orphan installation
///   records on other agents (the previous best-effort harness rescan
///   was unreliable), so this endpoint refuses with 409 and returns
///   the offending agents so the UI can ask the user to uninstall
///   them first.
pub(crate) async fn delete_my_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<axum::response::Response, StatusCode> {
    if !create_skill_name_valid(&name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&name);
    let skill_path = skill_dir.join("SKILL.md");

    // Existence + ownership check before touching anything else.
    let content = std::fs::read_to_string(&skill_path).map_err(|_| StatusCode::NOT_FOUND)?;
    let source = extract_frontmatter_field(&content, "source").unwrap_or_default();
    if source != USER_CREATED_SOURCE_MARKER {
        // Refuse to nuke a non-user-created skill file through this
        // endpoint even if the filename matches.
        return Err(StatusCode::FORBIDDEN);
    }

    // Precondition: make sure no local agent still has this skill
    // installed. We query the harness per-agent because it owns the
    // per-agent installation records — our local `Agent.skills` field
    // is a hint, not the source of truth.
    let blocking = agents_blocking_skill_delete(&state, &name).await?;

    if !blocking.is_empty() {
        let body = serde_json::json!({
            "error": "installed_on_agents",
            "message": "Uninstall this skill from all agents before deleting it.",
            "agents": blocking,
        });
        return Ok((
            StatusCode::CONFLICT,
            [(header::CONTENT_TYPE, "application/json")],
            body.to_string(),
        )
            .into_response());
    }

    // Remove the whole skill directory so supporting files (if any)
    // also go away. Only the SKILL.md has been verified, so this is a
    // targeted directory name under ~/.aura/skills/.
    if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Best-effort harness catalog deregister. The local harness may or
    // may not support DELETE on api/skills/{name}; the catalog proxy in
    // `list_skills` now also filters out entries whose on-disk file is
    // gone, so stale harness state no longer leaks into the UI's
    // "Available" section.
    let _ = state
        .harness_http
        .proxy_json(Method::DELETE, &format!("api/skills/{name}"), None, None)
        .await;

    let resp_json = serde_json::json!({
        "name": name,
        "deleted": true,
    });
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        resp_json.to_string(),
    )
        .into_response())
}
