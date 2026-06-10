use std::sync::Arc;

use axum::extract::{Path as AxumPath, State as AxumState};
use axum::Json;
use tao::event_loop::EventLoopProxy;
use tracing::{debug, info, warn};

use crate::demo::{self, DemoRegistry};
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
// Demo recorder
// ---------------------------------------------------------------------------

/// Shared state for the demo-recording routes: the event-loop proxy (to
/// open + drive the demo window) and the status registry (read by the
/// status route, written as the recording progresses).
#[derive(Clone)]
pub(crate) struct DemoRouteState {
    pub(crate) proxy: Arc<EventLoopProxy<UserEvent>>,
    pub(crate) registry: DemoRegistry,
}

#[derive(serde::Deserialize)]
pub(crate) struct StartDemoRequest {
    instruction: String,
    /// Optional max-duration guard in seconds (clamped server-side).
    max_seconds: Option<u64>,
    /// Optional demo-window logical size (clamped + forced even server-side).
    window_width: Option<u32>,
    window_height: Option<u32>,
    /// Output target: `"x"` (default, framed X-ready) or `"raw"`.
    target: Option<String>,
    /// Custom background image path; absent/empty/missing => bundled default.
    background: Option<String>,
    /// Frame the window on a background (`true`, default) vs. full-screen
    /// capture without compositing (`false`).
    window_on_background: Option<bool>,
    /// Opt-in to real OS-wide computer-use control for this recording.
    /// When `true`, capture is forced full-monitor (see [`demo::DemoOptions`]).
    computer_use: Option<bool>,
}

/// Kick off a demo recording: register a pending recording and ask the
/// event loop to open the demo window. Returns the `recording_id` the
/// caller polls via `GET /api/demo-recordings/:recording_id`.
pub(crate) async fn start_demo_recording(
    AxumState(state): AxumState<DemoRouteState>,
    Json(req): Json<StartDemoRequest>,
) -> Json<serde_json::Value> {
    let instruction = req.instruction.trim().to_string();
    if instruction.is_empty() {
        return Json(serde_json::json!({ "ok": false, "error": "instruction is required" }));
    }

    // Preflight before opening any window so missing prerequisites
    // (ffmpeg, or — on macOS — Screen Recording permission) surface as an
    // actionable in-app setup prompt instead of a window that flashes open
    // and produces an empty file. Any blocking probe runs inside
    // `spawn_blocking`. The `kind` lets the chat UI pick the right
    // self-service remediation flow (locate ffmpeg / open System Settings).
    if let Err(failure) = demo::preflight::run_demo_preflight().await {
        return Json(serde_json::json!({
            "ok": false,
            "error": failure.message,
            "kind": failure.kind.as_str(),
        }));
    }

    // Validate + clamp all caller-supplied options at the boundary so the
    // event loop only ever sees safe values.
    let options = demo::DemoOptions::from_input(demo::DemoOptionsInput {
        window_width: req.window_width,
        window_height: req.window_height,
        target: req.target,
        background: req.background,
        window_on_background: req.window_on_background,
        computer_use: req.computer_use,
        max_seconds: req.max_seconds,
    });

    let recording_id = demo::new_recording_id();
    demo::insert_starting(&state.registry, &recording_id, instruction.clone());

    // Phase 5 capture-mode activation (env-gate approach): when this demo
    // opts into computer-use, flip the process-wide flag the embedded
    // aura-os-server reads (together with AURA_COMPUTER_EXECUTOR_URL) when
    // building the chat SessionConfig. The demo bridge drives ordinary chat
    // turns from a separate window context, so an env flag is far less
    // invasive than threading a per-turn request flag through that bridge.
    // The flag stays set for the rest of this desktop process session
    // (single-user MVP); finer per-recording scoping is a follow-up.
    if options.computer_use {
        std::env::set_var("AURA_COMPUTER_USE_ENABLED", "1");
        warn!(recording_id = %recording_id, "computer-use enabled for this demo session");
    }

    info!(
        recording_id = %recording_id,
        max_seconds = options.max_seconds,
        window_width = options.window_width,
        window_height = options.window_height,
        window_on_background = options.window_on_background,
        computer_use = options.computer_use,
        "starting demo recording"
    );
    match state.proxy.send_event(UserEvent::StartDemoRecording {
        recording_id: recording_id.clone(),
        instruction,
        options,
    }) {
        Ok(()) => Json(serde_json::json!({ "ok": true, "recording_id": recording_id })),
        Err(error) => {
            warn!(error = %error, "failed to dispatch demo recording request");
            demo::set_failed(&state.registry, &recording_id, error.to_string());
            Json(serde_json::json!({ "ok": false, "error": error.to_string() }))
        }
    }
}

/// Status (and final file path) for a recording.
pub(crate) async fn get_demo_recording(
    AxumState(registry): AxumState<DemoRegistry>,
    AxumPath(recording_id): AxumPath<String>,
) -> Json<serde_json::Value> {
    match demo::snapshot(&registry, &recording_id) {
        Some(state) => Json(serde_json::json!({ "ok": true, "recording": state })),
        None => Json(serde_json::json!({ "ok": false, "error": "recording not found" })),
    }
}

/// State for the ffmpeg-path setup route: where to persist the user's
/// chosen ffmpeg path so it survives restarts.
#[derive(Clone)]
pub(crate) struct DemoFfmpegPathState {
    pub(crate) store_path: std::path::PathBuf,
}

#[derive(serde::Deserialize)]
pub(crate) struct SetDemoFfmpegPathRequest {
    path: String,
}

/// Point AURA at a user-selected ffmpeg binary (the self-service remedy for
/// a failed `ffmpeg_missing` preflight). Validates the path is launchable,
/// then applies it both in-process (so the very next recording works
/// without a relaunch) and to the settings store (so it survives restarts).
pub(crate) async fn set_demo_ffmpeg_path(
    AxumState(state): AxumState<DemoFfmpegPathState>,
    Json(req): Json<SetDemoFfmpegPathRequest>,
) -> Json<serde_json::Value> {
    let path = req.path.trim().to_string();
    if path.is_empty() {
        return Json(serde_json::json!({ "ok": false, "error": "ffmpeg path is required" }));
    }

    let probe_path = path.clone();
    let probe = tokio::task::spawn_blocking(move || {
        demo::tools::probe_ffmpeg(std::path::Path::new(&probe_path))
    })
    .await
    .unwrap_or_else(|join_error| Err(join_error.to_string()));

    if let Err(reason) = probe {
        warn!(path = %path, "rejected ffmpeg path: not launchable");
        return Json(serde_json::json!({
            "ok": false,
            "error": format!("That file doesn't look like a working ffmpeg ({reason})."),
        }));
    }

    std::env::set_var(demo::tools::FFMPEG_BIN_ENV, &path);
    demo::tools::persist_ffmpeg_path(&state.store_path, &path);
    info!(path = %path, "ffmpeg path configured via setup flow");
    Json(serde_json::json!({ "ok": true }))
}

/// Open the OS screen-recording privacy settings (the self-service remedy
/// for a failed `screen_recording_permission` preflight). Uses a URL scheme
/// rather than a filesystem path, so it can't go through `open_path` (which
/// requires the target to exist on disk). No-op off macOS.
pub(crate) async fn open_screen_recording_settings() -> Json<serde_json::Value> {
    #[cfg(target_os = "macos")]
    {
        const SETTINGS_URL: &str =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
        match open::that(SETTINGS_URL) {
            Ok(_) => Json(serde_json::json!({ "ok": true })),
            Err(e) => {
                warn!(error = %e, "failed to open screen recording settings");
                Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Json(serde_json::json!({ "ok": true }))
    }
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
        "current_version": crate::release_version::current_version(),
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
        let result = tokio::task::spawn_blocking(move || updater::stage_only(&state)).await;
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

pub(crate) async fn get_update_bundle_info() -> Json<serde_json::Value> {
    // The classification only carries meaningful signal on macOS. On
    // Windows/Linux every install is in-place against a writable
    // location so the recovery flow is not applicable; we still return
    // the resolved path so the client can render it for diagnostics if
    // it wants to.
    let supported = cfg!(target_os = "macos");
    match crate::updater::inspect_bundle() {
        Ok(bundle) => Json(serde_json::json!({
            "ok": true,
            "supported": supported,
            "path": bundle.path.to_string_lossy(),
            "translocated": bundle.translocated,
            "read_only": bundle.read_only,
            "on_dmg": bundle.on_dmg,
        })),
        Err(error) => {
            warn!(%error, "failed to inspect running bundle");
            Json(serde_json::json!({
                "ok": false,
                "supported": supported,
                "error": error,
            }))
        }
    }
}

pub(crate) async fn post_update_relocate_and_relaunch(
    AxumState(state): AxumState<UpdateState>,
) -> Json<serde_json::Value> {
    #[cfg(target_os = "macos")]
    {
        // `relocate_and_relaunch_macos` ends in `process::exit(0)` on the
        // happy path, so this future will never resolve when the move
        // succeeds — the HTTP request is torn down by the OS as Aura
        // exits, and the relaunched bundle will appear as a fresh
        // process. We still wrap in `spawn_blocking` because the
        // function does synchronous file I/O and synchronous
        // `osascript` invocations that would otherwise block the
        // tokio runtime.
        let outcome = tokio::task::spawn_blocking(move || {
            crate::updater::relocate_and_relaunch_macos(&state)
        })
        .await;
        match outcome {
            Ok(Ok(())) => {
                // Unreachable in practice — see comment above. Keep a
                // sane response shape for the type system.
                Json(serde_json::json!({ "ok": true }))
            }
            Ok(Err(error)) => {
                warn!(%error, "macOS relocate-and-relaunch failed");
                Json(serde_json::json!({ "ok": false, "error": error }))
            }
            Err(error) => {
                warn!(%error, "relocate join failed");
                Json(serde_json::json!({ "ok": false, "error": error.to_string() }))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Json(serde_json::json!({
            "ok": false,
            "error": "relocate-and-relaunch is only supported on macOS",
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
