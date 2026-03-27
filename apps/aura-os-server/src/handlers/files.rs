use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use tracing::{debug, warn};

#[derive(serde::Deserialize)]
pub(crate) struct ListDirectoryRequest {
    path: String,
}

#[derive(serde::Serialize)]
pub(crate) struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<DirEntry>>,
}

#[derive(serde::Deserialize)]
pub(crate) struct ReadFileRequest {
    path: String,
}

#[derive(serde::Deserialize)]
pub(crate) struct FilePreviewQuery {
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

fn dir_first_then_name(a: &std::fs::DirEntry, b: &std::fs::DirEntry) -> std::cmp::Ordering {
    let a_dir = a
        .file_type()
        .map(|file_type| file_type.is_dir())
        .unwrap_or(false);
    let b_dir = b
        .file_type()
        .map(|file_type| file_type.is_dir())
        .unwrap_or(false);
    b_dir
        .cmp(&a_dir)
        .then_with(|| a.file_name().cmp(&b.file_name()))
}

fn build_dir_entry(item: std::fs::DirEntry, depth: usize, max_depth: usize) -> Option<DirEntry> {
    let name = item.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') {
        return None;
    }
    let item_path = item.path();
    let is_dir = item
        .file_type()
        .map(|file_type| file_type.is_dir())
        .unwrap_or(false);
    if is_dir && IGNORED_DIRS.contains(&name.as_str()) {
        return None;
    }
    let children = if is_dir {
        Some(walk_directory(&item_path, depth + 1, max_depth))
    } else {
        None
    };
    Some(DirEntry {
        name,
        path: item_path.to_string_lossy().into_owned(),
        is_dir,
        children,
    })
}

fn walk_directory(path: &std::path::Path, depth: usize, max_depth: usize) -> Vec<DirEntry> {
    if depth >= max_depth {
        return Vec::new();
    }
    let Ok(read_dir) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    let mut items: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
    items.sort_by(dir_first_then_name);
    items
        .into_iter()
        .filter_map(|item| build_dir_entry(item, depth, max_depth))
        .collect()
}

pub(crate) async fn list_directory(
    Json(req): Json<ListDirectoryRequest>,
) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    let meta = match tokio::fs::metadata(target).await {
        Ok(m) => m,
        Err(_) => {
            warn!(path = %req.path, "list_directory: path does not exist");
            return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
        }
    };

    if !meta.is_dir() {
        warn!(path = %req.path, "list_directory: path is not a directory");
        return Json(serde_json::json!({ "ok": false, "error": "path is not a directory" }));
    }

    let target_owned = target.to_path_buf();
    let entries = tokio::task::spawn_blocking(move || walk_directory(&target_owned, 0, 20))
        .await
        .unwrap_or_default();
    debug!(path = %req.path, count = entries.len(), "listed directory");
    Json(serde_json::json!({ "ok": true, "entries": entries }))
}

pub(crate) async fn read_file(Json(req): Json<ReadFileRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    let meta = match tokio::fs::metadata(target).await {
        Ok(m) => m,
        Err(_) => {
            warn!(path = %req.path, "read_file: path does not exist");
            return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
        }
    };

    if !meta.is_file() {
        warn!(path = %req.path, "read_file: path is not a file");
        return Json(serde_json::json!({ "ok": false, "error": "path is not a file" }));
    }

    match tokio::fs::read_to_string(&req.path).await {
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

pub(crate) async fn preview_file(Query(query): Query<FilePreviewQuery>) -> Response {
    let target = std::path::Path::new(&query.path);
    let meta = match tokio::fs::metadata(target).await {
        Ok(m) => m,
        Err(_) => {
            warn!(path = %query.path, "preview_file: path does not exist");
            return (StatusCode::NOT_FOUND, "path not found").into_response();
        }
    };

    if !meta.is_file() {
        warn!(path = %query.path, "preview_file: path is not a file");
        return (StatusCode::BAD_REQUEST, "path is not a file").into_response();
    }

    match tokio::fs::read(target).await {
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
        | Some("jsx") | Some("json") | Some("yaml") | Some("yml") | Some("toml") | Some("css")
        | Some("html") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
