use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{dev_loop, tasks};
use crate::state::AppState;

pub(super) fn task_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects/:project_id/tasks",
            get(tasks::list_tasks).post(tasks::create_task),
        )
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
            "/api/projects/:project_id/tasks/:task_id",
            get(tasks::get_task)
                .put(tasks::update_task)
                .delete(tasks::delete_task),
        )
        .route(
            "/api/projects/:project_id/tasks/:task_id/retry",
            post(tasks::retry_task),
        )
        .route(
            "/api/projects/:project_id/tasks/:task_id/run",
            post(dev_loop::run_single_task),
        )
        .route(
            "/api/projects/:project_id/tasks/:task_id/output",
            get(tasks::get_task_output),
        )
        // Flat aliases that mirror aura-storage's task routes. The
        // harness's `HttpDomainApi` calls `/api/tasks/:id`,
        // `/api/tasks/:id/transition`, etc. directly when
        // `AURA_OS_SERVER_URL` is set; without these aliases every
        // dev-loop `get_task` / `transition_task` 404s and the loop
        // wedges itself into a "failed → failed" cycle.
        .route(
            "/api/tasks/:task_id/transition",
            post(tasks::transition_task_flat),
        )
        .route(
            "/api/tasks/:task_id",
            get(tasks::get_task_flat)
                .put(tasks::update_task_flat)
                .delete(tasks::delete_task_flat),
        )
}
