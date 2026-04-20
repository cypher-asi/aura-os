use axum::extract::{Path, State};
use axum::http::{header, Method, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

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
    /// Optional agent to auto-install this newly created skill on.
    /// When set, the server mirrors the Skill Shop flow: register the
    /// skill with the harness catalog AND install it for the agent so it
    /// shows up under "Installed" immediately.
    pub agent_id: Option<String>,
}

#[derive(serde::Serialize)]
struct CreateSkillResponse {
    name: String,
    path: String,
    created: bool,
    registered: bool,
    installed_on_agent: bool,
}

fn create_skill_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Marker written into the YAML frontmatter of every skill created via the
/// `POST /api/harness/skills` endpoint. Used by `list_my_skills` to separate
/// user-authored skills from shop-installed skills (both live under
/// ~/.aura/skills/ on disk).
pub(crate) const USER_CREATED_SOURCE_MARKER: &str = "user-created";

/// Returns `true` iff `~/.aura/skills/<name>/SKILL.md` exists. Used by the
/// catalog proxy in `list_skills` to hide skills the user has deleted even
/// when the harness hasn't rescanned its catalog yet.
pub(crate) fn skill_exists_on_disk(name: &str) -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    home.join(".aura")
        .join("skills")
        .join(name)
        .join("SKILL.md")
        .exists()
}

fn build_skill_frontmatter(payload: &CreateSkillBody) -> String {
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
    frontmatter.push_str(&format!("source: \"{USER_CREATED_SOURCE_MARKER}\"\n"));
    frontmatter.push_str("---\n");
    frontmatter
}

pub(crate) async fn create_skill(
    State(state): State<AppState>,
    Json(payload): Json<CreateSkillBody>,
) -> Result<axum::response::Response, StatusCode> {
    if !create_skill_name_valid(&payload.name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&payload.name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let frontmatter = build_skill_frontmatter(&payload);
    let body_text = payload.body.clone().unwrap_or_default();
    let content = format!("{frontmatter}\n{body_text}");
    let skill_path = skill_dir.join("SKILL.md");

    // Register the skill with the harness catalog so it shows up in listings.
    // Without this the UI's catalog (backed by the harness' `GET api/skills`)
    // stays empty and the newly created skill is invisible.
    //
    // NB: the harness writes its OWN `~/.aura/skills/<name>/SKILL.md` on
    // this POST (with a different frontmatter shape — `name:` included,
    // `user-invocable:` spelled with a hyphen, and crucially NO `source:`
    // marker). We therefore have to do the harness call *before* our own
    // write so our marker-bearing file wins the race; otherwise the
    // harness overwrites it and `list_my_skills` can't find the skill,
    // landing it under "Available" instead of "My Skills".
    state
        .harness_http
        .post_json_ignore_result(
            "api/skills",
            serde_json::json!({
                "name": payload.name,
                "description": payload.description,
                "body": body_text,
                "user_invocable": payload.user_invocable.unwrap_or(true),
                "model_invocable": payload.model_invocable.unwrap_or(false),
            })
            .to_string(),
        )
        .await;

    // Last writer wins: stamp the source marker after the harness has had
    // its turn. (The directory was created above; the harness call may or
    // may not have written SKILL.md, either way we overwrite.)
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // If the client supplied an agent context, auto-install the skill for that
    // agent so it appears under "Installed" in the UI (mirrors the Skill Shop flow).
    let installed_on_agent = match payload.agent_id.as_deref() {
        Some(agent_id) if !agent_id.is_empty() => {
            let empty: Vec<String> = Vec::new();
            let install_body = serde_json::json!({
                "name": payload.name,
                "approved_paths": empty,
                "approved_commands": empty,
            })
            .to_string();
            state
                .harness_http
                .post_json_ignore_result(
                    &format!("api/agents/{agent_id}/skills"),
                    install_body,
                )
                .await;
            true
        }
        _ => false,
    };

    let resp = CreateSkillResponse {
        name: payload.name,
        path: skill_path.to_string_lossy().into_owned(),
        created: true,
        registered: true,
        installed_on_agent,
    };
    let body = serde_json::to_string(&resp).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
}

#[derive(Deserialize)]
pub(crate) struct InstallFromShopBody {
    pub name: String,
    pub category: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

fn skills_base_dir() -> std::path::PathBuf {
    std::env::var("SKILLS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("skills"))
}

async fn load_shop_skill_markdown(
    normalized_name: &str,
    body: &InstallFromShopBody,
) -> Result<String, StatusCode> {
    if let Some(ref category) = body.category {
        let local_path = skills_base_dir()
            .join(category)
            .join(normalized_name)
            .join("SKILL.md");
        return std::fs::read_to_string(&local_path).map_err(|_| StatusCode::NOT_FOUND);
    }
    if let Some(ref source_url) = body.source_url {
        return reqwest::Client::new()
            .get(source_url)
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .text()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY);
    }
    Err(StatusCode::BAD_REQUEST)
}

pub(crate) async fn install_from_shop(
    State(state): State<AppState>,
    Json(body): Json<InstallFromShopBody>,
) -> Result<axum::response::Response, StatusCode> {
    let name = body.name.trim().to_lowercase().replace(' ', "-");
    if name.is_empty()
        || name.len() > 64
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let content = load_shop_skill_markdown(&name, &body).await?;

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, &content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let description = extract_frontmatter_field(&content, "description")
        .unwrap_or_else(|| format!("{name} skill"));
    let body_text = strip_frontmatter(&content);

    state
        .harness_http
        .post_json_ignore_result(
            "api/skills",
            serde_json::json!({
                "name": name,
                "description": description,
                "body": body_text,
                "user_invocable": true,
            })
            .to_string(),
        )
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

pub(crate) async fn discover_skill_paths(
    Path(name): Path<String>,
) -> Result<axum::response::Response, StatusCode> {
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
) -> Result<axum::response::Response, StatusCode> {
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

#[derive(serde::Serialize)]
struct MySkillEntry {
    name: String,
    description: String,
    path: String,
    user_invocable: bool,
    model_invocable: bool,
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
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
        else {
            continue;
        };
        // Skip metadata / hidden entries.
        if name.starts_with('.') {
            continue;
        }

        let skill_path = path.join("SKILL.md");
        let Ok(content) = std::fs::read_to_string(&skill_path) else {
            continue;
        };

        let source = extract_frontmatter_field(&content, "source").unwrap_or_default();
        if source != USER_CREATED_SOURCE_MARKER {
            continue;
        }

        let description = extract_frontmatter_field(&content, "description").unwrap_or_default();
        let user_invocable = extract_frontmatter_field(&content, "user_invocable")
            .map(|v| v == "true")
            .unwrap_or(true);
        let model_invocable = extract_frontmatter_field(&content, "model_invocable")
            .map(|v| v == "true")
            .unwrap_or(false);

        results.push(MySkillEntry {
            name,
            description,
            path: skill_path.to_string_lossy().into_owned(),
            user_invocable,
            model_invocable,
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));

    let body =
        serde_json::to_string(&results).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response())
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
    let content =
        std::fs::read_to_string(&skill_path).map_err(|_| StatusCode::NOT_FOUND)?;
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
    let agents = state
        .agent_service
        .list_agents()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let checks = agents.iter().map(|agent| {
        let harness_http = state.harness_http.clone();
        let agent_id = agent.agent_id.to_string();
        async move {
            let value = harness_http
                .fetch_json(
                    Method::GET,
                    &format!("api/agents/{agent_id}/skills"),
                )
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
            .or_else(|| {
                value
                    .get("skills")
                    .and_then(|v| v.as_array())
                    .cloned()
            })
            .or_else(|| {
                value
                    .get("installations")
                    .and_then(|v| v.as_array())
                    .cloned()
            })
            .unwrap_or_default();
        let has_skill = list
            .iter()
            .any(|entry| entry.get("skill_name").and_then(|v| v.as_str()) == Some(&name));
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
        std::fs::remove_dir_all(&skill_dir)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
