use std::sync::Arc;

use axum::extract::{Query, State as AxumState};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use tao::event_loop::EventLoopProxy;
use tracing::{debug, info, warn};

use crate::updater::{UpdateChannel, UpdateState};
use crate::UserEvent;

// ---------------------------------------------------------------------------
// File pickers
// ---------------------------------------------------------------------------

pub async fn pick_folder() -> Json<serde_json::Value> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select folder")
        .pick_folder()
        .await;
    let path = handle.map(|h| h.path().to_string_lossy().into_owned());
    Json(serde_json::json!(path))
}

pub async fn pick_file() -> Json<serde_json::Value> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select file")
        .pick_file()
        .await;
    let path = handle.map(|h| h.path().to_string_lossy().into_owned());
    Json(serde_json::json!(path))
}

// ---------------------------------------------------------------------------
// File read/write
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct ReadFileRequest {
    path: String,
}

#[derive(serde::Deserialize)]
pub struct FilePreviewQuery {
    path: String,
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

#[derive(serde::Deserialize)]
pub struct WriteFileRequest {
    path: String,
    content: String,
}

pub async fn write_file(Json(req): Json<WriteFileRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            warn!(path = %req.path, "write_file: parent directory does not exist");
            return Json(serde_json::json!({ "ok": false, "error": "parent directory not found" }));
        }
    }
    match std::fs::write(&req.path, &req.content) {
        Ok(_) => {
            debug!(path = %req.path, bytes = req.content.len(), "wrote file");
            Json(serde_json::json!({ "ok": true, "path": req.path }))
        }
        Err(e) => {
            warn!(path = %req.path, error = %e, "failed to write file");
            Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

// ---------------------------------------------------------------------------
// Path / IDE openers
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct OpenPathRequest {
    path: String,
}

pub async fn open_path(Json(req): Json<OpenPathRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if !target.exists() {
        warn!(path = %req.path, "open_path: path does not exist");
        return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
    }
    match open::that(&req.path) {
        Ok(_) => {
            debug!(path = %req.path, "opened path in OS");
            Json(serde_json::json!({ "ok": true }))
        }
        Err(e) => {
            warn!(path = %req.path, error = %e, "failed to open path");
            Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

#[derive(serde::Deserialize)]
pub struct OpenIdeRequest {
    path: String,
    root: Option<String>,
}

pub async fn open_ide(
    AxumState(proxy): AxumState<Arc<EventLoopProxy<UserEvent>>>,
    Json(req): Json<OpenIdeRequest>,
) -> Json<serde_json::Value> {
    info!(path = %req.path, "requesting IDE window");
    let _ = proxy.send_event(UserEvent::OpenIdeWindow {
        file_path: req.path,
        root_path: req.root,
    });
    Json(serde_json::json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// Update routes
// ---------------------------------------------------------------------------

pub async fn get_update_status(
    AxumState(state): AxumState<UpdateState>,
) -> Json<serde_json::Value> {
    let status = state.status.read().await;
    let channel = state.channel.read().await;
    Json(serde_json::json!({
        "update": *status,
        "channel": *channel,
        "current_version": env!("CARGO_PKG_VERSION"),
    }))
}

pub async fn post_update_install() -> Json<serde_json::Value> {
    match crate::updater::install_and_restart() {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => {
            warn!(error = %e, "install_and_restart failed");
            Json(serde_json::json!({ "ok": false, "error": e }))
        }
    }
}

#[derive(serde::Deserialize)]
pub struct SetChannelRequest {
    channel: UpdateChannel,
}

pub async fn post_update_channel(
    AxumState(state): AxumState<UpdateState>,
    Json(req): Json<SetChannelRequest>,
) -> Json<serde_json::Value> {
    let old = {
        let mut ch = state.channel.write().await;
        let old = *ch;
        *ch = req.channel;
        old
    };
    info!(from = %old, to = %req.channel, "update channel changed");
    crate::updater::trigger_recheck(state);
    Json(serde_json::json!({ "ok": true, "channel": req.channel }))
}
