//! Reusable in-memory mock aura-storage HTTP server for integration tests.
//!
//! Supports sessions, tasks, specs, messages, and project agents. Use
//! [`start_mock_storage`] to spin up a server and get a base URL suitable
//! for `StorageClient::with_base_url`.

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

mod db;
mod event;
mod health;
mod project_agent;
mod session;
mod spec;
mod task;

pub use db::{MockStorageDb, SharedDb};

/// Build the axum router for the mock storage server.
pub fn mock_storage_router(db: SharedDb) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route(
            "/api/project-agents/:project_agent_id/sessions",
            post(session::create_session).get(session::list_sessions),
        )
        .route(
            "/api/sessions/:session_id",
            get(session::get_session)
                .put(session::update_session)
                .delete(session::delete_session),
        )
        .route(
            "/api/projects/:project_id/tasks",
            post(task::create_task).get(task::list_tasks),
        )
        .route(
            "/api/tasks/:task_id",
            get(task::get_task)
                .put(task::update_task)
                .delete(task::delete_task),
        )
        .route(
            "/api/tasks/:task_id/transition",
            post(task::transition_task),
        )
        .route(
            "/api/projects/:project_id/specs",
            post(spec::create_spec).get(spec::list_specs),
        )
        .route(
            "/api/specs/:spec_id",
            get(spec::get_spec)
                .put(spec::update_spec)
                .delete(spec::delete_spec),
        )
        .route(
            "/api/sessions/:session_id/events",
            post(event::create_event).get(event::list_events),
        )
        .route(
            "/api/projects/:project_id/agents",
            post(project_agent::create_project_agent).get(project_agent::list_project_agents),
        )
        .route(
            "/api/project-agents/:id",
            get(project_agent::get_project_agent)
                .put(project_agent::update_project_agent)
                .delete(project_agent::delete_project_agent),
        )
        .with_state(db)
}

/// Spin up a mock aura-storage HTTP server and return (base_url, shared_db).
///
/// The server runs in a background tokio task and listens on a random port.
/// Use the returned URL with `StorageClient::with_base_url`.
pub async fn start_mock_storage() -> (String, SharedDb) {
    let db: SharedDb = Arc::new(Mutex::new(MockStorageDb::default()));
    let app = mock_storage_router(db.clone());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock storage listener");
    let url = format!("http://{}", listener.local_addr().expect("get local addr"));
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    (url, db)
}
