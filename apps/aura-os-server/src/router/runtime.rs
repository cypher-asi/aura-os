use axum::routing::{delete, get, post};
use axum::Router;

use crate::handlers::{browser, dev_loop, log, remote_terminal, system, terminal, ws};
use crate::state::AppState;

pub(super) fn system_routes() -> Router<AppState> {
    Router::new()
        .route("/api/log-entries", get(log::list_log_entries))
        .route(
            "/api/projects/:project_id/loop/start",
            post(dev_loop::start_loop),
        )
        .route(
            "/api/projects/:project_id/loop/pause",
            post(dev_loop::pause_loop),
        )
        .route(
            "/api/projects/:project_id/loop/stop",
            post(dev_loop::stop_loop),
        )
        .route(
            "/api/projects/:project_id/loop/resume",
            post(dev_loop::resume_loop),
        )
        .route(
            "/api/projects/:project_id/loop/status",
            get(dev_loop::get_loop_status),
        )
        .route(
            "/api/terminal",
            post(terminal::spawn_terminal).get(terminal::list_terminals),
        )
        .route("/api/terminal/:id", delete(terminal::kill_terminal))
        .route("/ws/terminal/:id", get(terminal::ws_terminal))
        .route(
            "/api/browser",
            post(browser::spawn_browser).get(browser::list_browsers),
        )
        .route("/api/browser/:id", delete(browser::kill_browser))
        .route(
            "/api/browser/projects/:project_id/settings",
            get(browser::get_project_settings).put(browser::update_project_settings),
        )
        .route(
            "/api/browser/projects/:project_id/detect",
            post(browser::run_detect),
        )
        .route("/ws/browser/:id", get(browser::ws_browser))
        .route(
            "/ws/agents/:agent_id/remote_agent/terminal",
            get(remote_terminal::ws_remote_terminal),
        )
        .route("/ws/events", get(ws::ws_events))
        .route("/api/system/info", get(system::get_environment_info))
        .route(
            "/api/system/workspace_defaults",
            get(system::get_workspace_defaults),
        )
}
