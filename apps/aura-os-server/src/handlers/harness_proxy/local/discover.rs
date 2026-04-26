//! Read-only skill discovery and content fetch routes.

use axum::extract::Path;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;

use super::skills_base_dir;

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

fn obsidian_appdata_dir() -> Option<std::path::PathBuf> {
    if let Ok(v) = std::env::var("APPDATA") {
        return Some(std::path::PathBuf::from(v));
    }
    dirs::home_dir().map(|home| home.join("Library/Application Support"))
}

fn discover_obsidian_vaults() -> Vec<String> {
    let Some(appdata) = obsidian_appdata_dir() else {
        return vec![];
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
