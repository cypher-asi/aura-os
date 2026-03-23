use std::sync::Arc;

use axum::extract::State as AxumState;
use axum::Json;
use tao::event_loop::EventLoopProxy;
use tracing::{debug, info, warn};

use crate::updater::{UpdateChannel, UpdateState};
use crate::UserEvent;

// ---------------------------------------------------------------------------
// File pickers
// ---------------------------------------------------------------------------

pub(crate) async fn pick_folder() -> Json<serde_json::Value> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select folder")
        .pick_folder()
        .await;
    let path = handle.map(|h| h.path().to_string_lossy().into_owned());
    Json(serde_json::json!(path))
}

pub(crate) async fn pick_file() -> Json<serde_json::Value> {
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
pub(crate) struct ReadFileRequest {
    path: String,
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

#[derive(serde::Deserialize)]
pub(crate) struct WriteFileRequest {
    path: String,
    content: String,
}

pub(crate) async fn write_file(Json(req): Json<WriteFileRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if let Some(parent) = target.parent() {
        if !tokio::fs::try_exists(parent).await.unwrap_or(false) {
            warn!(path = %req.path, "write_file: parent directory does not exist");
            return Json(serde_json::json!({ "ok": false, "error": "parent directory not found" }));
        }
    }
    match tokio::fs::write(&req.path, &req.content).await {
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
pub(crate) struct OpenPathRequest {
    path: String,
}

pub(crate) async fn open_path(Json(req): Json<OpenPathRequest>) -> Json<serde_json::Value> {
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
pub(crate) struct OpenIdeRequest {
    path: String,
    root: Option<String>,
}

pub(crate) async fn open_ide(
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

pub(crate) async fn get_update_status(
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

pub(crate) async fn post_update_install() -> Json<serde_json::Value> {
    match crate::updater::install_and_restart() {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => {
            warn!(error = %e, "install_and_restart failed");
            Json(serde_json::json!({ "ok": false, "error": e }))
        }
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct SetChannelRequest {
    channel: UpdateChannel,
}

pub(crate) async fn post_update_channel(
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
