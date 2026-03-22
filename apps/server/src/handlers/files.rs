use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use tracing::{debug, warn};

#[derive(serde::Deserialize)]
pub struct ListDirectoryRequest {
    path: String,
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<DirEntry>>,
}

#[derive(serde::Deserialize)]
pub struct ReadFileRequest {
    path: String,
}

#[derive(serde::Deserialize)]
pub struct FilePreviewQuery {
    path: String,
}

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".next",
    "dist",
    "build",
    ".svn",
    ".hg",
    "vendor",
];

fn walk_directory(path: &std::path::Path, depth: usize, max_depth: usize) -> Vec<DirEntry> {
    if depth >= max_depth {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(path) else {
        return entries;
    };

    let mut items: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|file_type| file_type.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|file_type| file_type.is_dir()).unwrap_or(false);
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.file_name().cmp(&b.file_name()))
    });

    for item in items {
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let item_path = item.path();
        let is_dir = item.file_type().map(|file_type| file_type.is_dir()).unwrap_or(false);
        if is_dir && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }

        let children = if is_dir {
            Some(walk_directory(&item_path, depth + 1, max_depth))
        } else {
            None
        };

        entries.push(DirEntry {
            name,
            path: item_path.to_string_lossy().into_owned(),
            is_dir,
            children,
        });
    }

    entries
}

pub async fn list_directory(Json(req): Json<ListDirectoryRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if !target.exists() {
        warn!(path = %req.path, "list_directory: path does not exist");
        return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
    }

    if !target.is_dir() {
        warn!(path = %req.path, "list_directory: path is not a directory");
        return Json(serde_json::json!({ "ok": false, "error": "path is not a directory" }));
    }

    let entries = walk_directory(target, 0, 20);
    debug!(path = %req.path, count = entries.len(), "listed directory");
    Json(serde_json::json!({ "ok": true, "entries": entries }))
}

pub async fn read_file(Json(req): Json<ReadFileRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if !target.exists() {
        warn!(path = %req.path, "read_file: path does not exist");
        return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
    }
    if !target.is_file() {
        warn!(path = %req.path, "read_file: path is not a file");
        return Json(serde_json::json!({ "ok": false, "error": "path is not a file" }));
    }

    match std::fs::read_to_string(&req.path) {
        Ok(content) => {
            debug!(path = %req.path, bytes = content.len(), "read file");
            Json(serde_json::json!({ "ok": true, "content": content, "path": req.path }))
        }
        Err(e) => {
            warn!(path = %req.path, error = %e, "failed to read file");
            Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

pub async fn preview_file(Query(query): Query<FilePreviewQuery>) -> Response {
    let target = std::path::Path::new(&query.path);
    if !target.exists() {
        warn!(path = %query.path, "preview_file: path does not exist");
        return (StatusCode::NOT_FOUND, "path not found").into_response();
    }
    if !target.is_file() {
        warn!(path = %query.path, "preview_file: path is not a file");
        return (StatusCode::BAD_REQUEST, "path is not a file").into_response();
    }

    match std::fs::read(target) {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, preview_content_type(target)),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => {
            warn!(path = %query.path, error = %e, "failed to preview file");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

fn preview_content_type(path: &std::path::Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match ext.as_deref() {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("md") | Some("txt") | Some("rs") | Some("ts") | Some("tsx") | Some("js")
        | Some("jsx") | Some("json") | Some("yaml") | Some("yml") | Some("toml")
        | Some("css") | Some("html") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
