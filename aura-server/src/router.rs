use std::path::PathBuf;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::handlers::{agents, dev_loop, projects, settings, specs, tasks, ws};
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    create_router_with_frontend(state, None)
}

pub fn create_router_with_frontend(state: AppState, frontend_dir: Option<PathBuf>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_router = Router::new()
        // Settings
        .route(
            "/api/settings/api-key",
            post(settings::set_api_key)
                .get(settings::get_api_key_info)
                .delete(settings::delete_api_key),
        )
        .route(
            "/api/settings/:key",
            get(settings::get_setting).put(settings::set_setting),
        )
        // Projects
        .route(
            "/api/projects",
            post(projects::create_project).get(projects::list_projects),
        )
        .route(
            "/api/projects/:project_id",
            get(projects::get_project).put(projects::update_project),
        )
        .route(
            "/api/projects/:project_id/archive",
            post(projects::archive_project),
        )
        // Specs
        .route("/api/projects/:project_id/specs", get(specs::list_specs))
        .route(
            "/api/projects/:project_id/specs/generate",
            post(specs::generate_specs),
        )
        .route(
            "/api/projects/:project_id/specs/:spec_id",
            get(specs::get_spec),
        )
        // Tasks
        .route("/api/projects/:project_id/tasks", get(tasks::list_tasks))
        .route(
            "/api/projects/:project_id/specs/:spec_id/tasks",
            get(tasks::list_tasks_by_spec),
        )
        .route(
            "/api/projects/:project_id/tasks/extract",
            post(tasks::extract_tasks),
        )
        .route(
            "/api/projects/:project_id/tasks/:task_id/transition",
            post(tasks::transition_task),
        )
        .route(
            "/api/projects/:project_id/tasks/:task_id/retry",
            post(tasks::retry_task),
        )
        .route(
            "/api/projects/:project_id/progress",
            get(tasks::get_progress),
        )
        // Agents
        .route("/api/projects/:project_id/agents", get(agents::list_agents))
        .route(
            "/api/projects/:project_id/agents/:agent_id",
            get(agents::get_agent),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_id/sessions",
            get(agents::list_sessions),
        )
        // Dev Loop
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
        // WebSocket
        .route("/ws/events", get(ws::ws_events))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    match frontend_dir {
        Some(dir) => {
            let index = dir.join("index.html");
            api_router
                .fallback_service(ServeDir::new(&dir).not_found_service(ServeFile::new(index)))
        }
        None => api_router,
    }
}
