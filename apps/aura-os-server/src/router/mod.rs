use std::path::PathBuf;

use axum::http::HeaderValue;
use axum::middleware;
use axum::routing::get;
use axum::Router;
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::system;
use crate::state::AppState;

mod agents;
mod auth;
mod bug_reports;
mod cors;
mod debug_loops;
mod feedback;
mod harness_proxy;
mod marketplace_bootstrap;
mod notes;
mod preferences;
mod process_generation;
mod projects_files;
mod public;
mod runtime;
mod social;
mod specs;
mod streams;
mod tasks;
mod users_orgs_billing;

/// Maximum request body size (in bytes) for routes that accept inlined
/// base64 image attachments. The chat input bar caps total uploads at
/// 10 MB raw (see `useFileAttachments.ts::MAX_TOTAL_SIZE_MB`); base64
/// inflates that to ~13.3 MiB, plus JSON envelope overhead. 16 MiB
/// gives comfortable headroom while still bounding the body so a
/// pathological client can't keep posting unbounded payloads.
///
/// Routes still inherit Axum's default 2 MiB cap unless they explicitly
/// opt into this larger limit, so the looser bound is scoped only to
/// attachment-bearing endpoints.
pub(super) const ATTACHMENT_REQUEST_MAX_BYTES: usize = 16 * 1024 * 1024;

use agents::agent_routes;
use auth::{auth_routes, protected_auth_routes};
use bug_reports::bug_reports_routes;
pub use cors::build_local_api_cors_layer;
use debug_loops::{debug_routes, loops_routes};
use feedback::feedback_routes;
use harness_proxy::harness_proxy_routes;
use marketplace_bootstrap::{agent_bootstrap_routes, marketplace_routes};
use notes::notes_routes;
use preferences::preferences_routes;
use process_generation::{generation_routes, process_routes};
use projects_files::project_routes;
use public::public_routes;
use runtime::system_routes;
use social::social_routes;
use specs::spec_routes;
use streams::stream_routes;
use tasks::task_routes;
use users_orgs_billing::{billing_routes, org_routes, user_routes};

fn upload_routes() -> Router<AppState> {
    Router::new().route(
        "/api/upload/presign",
        axum::routing::post(crate::handlers::upload::presign_upload),
    )
}

pub fn create_router_with_interface(state: AppState, interface_dir: Option<PathBuf>) -> Router {
    let cors = build_local_api_cors_layer();

    let protected_api_router = Router::new()
        .merge(protected_auth_routes())
        .merge(user_routes())
        .merge(org_routes())
        .merge(billing_routes())
        .merge(project_routes())
        .merge(spec_routes())
        .merge(stream_routes())
        .merge(task_routes())
        .merge(agent_routes())
        .merge(social_routes())
        .merge(feedback_routes())
        .merge(bug_reports_routes())
        .merge(system_routes())
        .merge(agent_bootstrap_routes())
        .merge(process_routes())
        .merge(generation_routes())
        .merge(harness_proxy_routes())
        .merge(notes_routes())
        .merge(preferences_routes())
        .merge(marketplace_routes())
        .merge(debug_routes())
        .merge(loops_routes())
        .merge(upload_routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth_guard::require_verified_session,
        ));

    let api_router = Router::new()
        .route("/health", get(system::health))
        .merge(auth_routes())
        // Public anonymous endpoints (`/api/public/*`). Merged at this
        // level, OUTSIDE `protected_api_router`, so the global
        // `require_verified_session` tower never inspects the request.
        // The per-handler `AuthGuestJwt` extractor validates the
        // short-lived guest JWT issued by `/api/public/setup`.
        .merge(public_routes())
        .merge(protected_api_router)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    match interface_dir {
        Some(dir) => {
            let index = dir.join("index.html");
            let assets = dir.join("assets");
            let asset_service = ServiceBuilder::new()
                .layer(CompressionLayer::new())
                .layer(SetResponseHeaderLayer::overriding(
                    axum::http::header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                ))
                .service(ServeDir::new(assets));
            let serve = ServiceBuilder::new()
                .layer(CompressionLayer::new())
                .layer(SetResponseHeaderLayer::overriding(
                    axum::http::header::CACHE_CONTROL,
                    HeaderValue::from_static("no-cache"),
                ))
                .service(ServeDir::new(&dir).fallback(ServeFile::new(index)));
            api_router
                .nest_service("/assets", asset_service)
                .fallback_service(serve)
        }
        None => api_router,
    }
}
