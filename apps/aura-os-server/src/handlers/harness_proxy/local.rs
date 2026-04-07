use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
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
}

#[derive(serde::Serialize)]
struct CreateSkillResponse {
    name: String,
    path: String,
    created: bool,
}

fn create_skill_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
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
    frontmatter.push_str("---\n");
    frontmatter
}

pub(crate) async fn create_skill(
    State(_state): State<AppState>,
    Json(payload): Json<CreateSkillBody>,
) -> Result<axum::response::Response, StatusCode> {
    if !create_skill_name_valid(&payload.name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let skill_dir = home.join(".aura").join("skills").join(&payload.name);
    std::fs::create_dir_all(&skill_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let frontmatter = build_skill_frontmatter(&payload);
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
