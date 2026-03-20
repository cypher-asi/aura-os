use axum::Json;
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
