use std::sync::Arc;

use axum::extract::State as AxumState;
use axum::Json;
use tao::event_loop::EventLoopProxy;
use tracing::{debug, info, warn};

use crate::route_state::RouteState;
use crate::updater::{self, UpdateChannel, UpdateState};
use crate::UserEvent;

#[derive(Clone)]
pub(crate) struct UpdateInstallRouteState {
    pub(crate) proxy: Arc<EventLoopProxy<UserEvent>>,
    pub(crate) update_state: UpdateState,
}

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
    let status = state.status.read().expect("updater status lock poisoned");
    let channel = state.channel.read().expect("updater channel lock poisoned");
    let endpoint_template = crate::updater::endpoint_for_channel(*channel);
    let last_persisted = updater::load_state_snapshot(state.data_dir.as_ref())
        .ok()
        .flatten();
    let updater_log_path = updater::updater_log_path(state.data_dir.as_ref());
    let updater_state_path = updater::updater_state_path(state.data_dir.as_ref());
    Json(serde_json::json!({
        "update": *status,
        "channel": *channel,
        "current_version": env!("CARGO_PKG_VERSION"),
        "supported": crate::updater::updater_supported(),
        "update_base_url": crate::updater::update_base_url(),
        "endpoint_template": endpoint_template,
        "last_persisted_state": last_persisted,
        "diagnostics": {
            "updater_log_path": updater_log_path.to_string_lossy(),
            "updater_state_path": updater_state_path.to_string_lossy(),
        },
    }))
}

pub(crate) async fn get_runtime_config() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "aura_network_url": std::env::var("AURA_NETWORK_URL").ok(),
        "aura_storage_url": std::env::var("AURA_STORAGE_URL").ok(),
        "aura_integrations_url": std::env::var("AURA_INTEGRATIONS_URL").ok(),
        "aura_router_url": std::env::var("AURA_ROUTER_URL").ok(),
        "z_billing_url": std::env::var("Z_BILLING_URL").ok(),
        "orbit_base_url": std::env::var("ORBIT_BASE_URL").ok(),
        "swarm_base_url": std::env::var("SWARM_BASE_URL").ok(),
        "local_harness_url": std::env::var("LOCAL_HARNESS_URL").ok(),
        "harness_binary": std::env::var("AURA_HARNESS_BIN").ok(),
        "external_harness": std::env::var("AURA_DESKTOP_EXTERNAL_HARNESS").ok(),
        "require_zero_pro": std::env::var("REQUIRE_ZERO_PRO").ok(),
        "disable_local_harness_autospawn": std::env::var("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN").ok(),
    }))
}

#[derive(serde::Deserialize)]
pub(crate) struct PersistRouteRequest {
    route: String,
}

pub(crate) async fn post_last_route(
    AxumState(state): AxumState<RouteState>,
    Json(req): Json<PersistRouteRequest>,
) -> Json<serde_json::Value> {
    match state.persist_route(&req.route) {
        Ok(route) => Json(serde_json::json!({ "ok": true, "route": route })),
        Err(error) => {
            warn!(%error, route = %req.route, "failed to persist desktop route");
            Json(serde_json::json!({ "ok": false, "error": error }))
        }
    }
}

pub(crate) async fn post_update_install(
    AxumState(state): AxumState<UpdateInstallRouteState>,
) -> Json<serde_json::Value> {
    match state.proxy.send_event(UserEvent::InstallUpdate {
        state: state.update_state.clone(),
    }) {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(error) => {
            warn!(error = %error, "failed to dispatch install update request");
            Json(serde_json::json!({ "ok": false, "error": error.to_string() }))
        }
    }
}

pub(crate) async fn post_update_check(
    AxumState(state): AxumState<UpdateState>,
) -> Json<serde_json::Value> {
    crate::updater::trigger_recheck(state);
    Json(serde_json::json!({ "ok": true }))
}

#[derive(serde::Deserialize)]
pub(crate) struct SetChannelRequest {
    channel: UpdateChannel,
}

pub(crate) async fn post_update_reveal_logs(
    AxumState(state): AxumState<UpdateState>,
) -> Json<serde_json::Value> {
    let log_path = updater::updater_log_path(state.data_dir.as_ref());
    let log_dir = log_path.parent().map(std::path::Path::to_path_buf);

    // Prefer revealing the directory so the user sees the rolling
    // `desktop.log` files alongside the per-event `updater.log`. Fall back
    // to the file directly if the parent is missing for some reason.
    let target = log_dir.clone().unwrap_or_else(|| log_path.clone());
    let target_display = target.to_string_lossy().into_owned();

    if !target.exists() {
        // Create the directory so `open::that` has something to reveal even
        // on a fresh install where no updater run has happened yet.
        if let Err(error) = std::fs::create_dir_all(&target) {
            warn!(error = %error, path = %target_display, "failed to ensure log directory exists for reveal");
        }
    }

    match open::that(&target) {
        Ok(_) => {
            info!(path = %target_display, "revealed updater log directory");
            Json(serde_json::json!({
                "ok": true,
                "path": target_display,
                "updater_log": log_path.to_string_lossy(),
            }))
        }
        Err(error) => {
            warn!(error = %error, path = %target_display, "failed to reveal updater logs");
            Json(serde_json::json!({
                "ok": false,
                "path": target_display,
                "error": error.to_string(),
            }))
        }
    }
}

pub(crate) async fn post_update_stage_only(
    AxumState(state): AxumState<UpdateState>,
) -> Json<serde_json::Value> {
    if std::env::var("AURA_DESKTOP_DEBUG_UPDATER")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
    {
        // Run the staging on the current async worker — staging hits the
        // network and writes to disk but does not exit Aura.
        let result =
            tokio::task::spawn_blocking(move || updater::stage_only(&state)).await;
        match result {
            Ok(Ok(path)) => Json(serde_json::json!({
                "ok": true,
                "staged_path": path.to_string_lossy(),
            })),
            Ok(Err(error)) => {
                warn!(%error, "stage_only failed");
                Json(serde_json::json!({ "ok": false, "error": error }))
            }
            Err(error) => {
                warn!(%error, "stage_only join failed");
                Json(serde_json::json!({ "ok": false, "error": error.to_string() }))
            }
        }
    } else {
        Json(serde_json::json!({
            "ok": false,
            "error": "AURA_DESKTOP_DEBUG_UPDATER is not enabled",
        }))
    }
}

pub(crate) async fn post_update_channel(
    AxumState(state): AxumState<UpdateState>,
    Json(req): Json<SetChannelRequest>,
) -> Json<serde_json::Value> {
    let old = {
        let mut ch = state
            .channel
            .write()
            .expect("updater channel lock poisoned");
        let old = *ch;
        *ch = req.channel;
        old
    };
    if let Err(error) = state.persist_channel(req.channel) {
        let mut ch = state
            .channel
            .write()
            .expect("updater channel lock poisoned");
        *ch = old;
        warn!(error = %error, channel = %req.channel, "failed to persist update channel");
        return Json(serde_json::json!({
            "ok": false,
            "error": error,
            "channel": old,
        }));
    }
    info!(from = %old, to = %req.channel, "update channel changed");
    crate::updater::trigger_recheck(state.clone());
    Json(serde_json::json!({ "ok": true, "channel": req.channel }))
}
