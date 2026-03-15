use std::path::PathBuf;

use axum::http::HeaderValue;
use axum::routing::{delete, get, post, put};
use axum::Router;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::{agents, auth, billing, chat, dev_loop, github, log, orgs, pricing, projects, settings, specs, sprints, tasks, terminal, ws};
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
        // Auth
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/session", get(auth::get_session))
        .route("/api/auth/validate", post(auth::validate))
        .route("/api/auth/logout", post(auth::logout))
        // Orgs
        .route("/api/orgs", get(orgs::list_orgs).post(orgs::create_org))
        .route(
            "/api/orgs/:org_id",
            get(orgs::get_org).put(orgs::update_org),
        )
        .route("/api/orgs/:org_id/members", get(orgs::list_members))
        .route(
            "/api/orgs/:org_id/members/:user_id",
            put(orgs::update_member_role).delete(orgs::remove_member),
        )
        .route(
            "/api/orgs/:org_id/invites",
            post(orgs::create_invite).get(orgs::list_invites),
        )
        .route(
            "/api/orgs/:org_id/invites/:invite_id",
            delete(orgs::revoke_invite),
        )
        .route("/api/invites/:token/accept", post(orgs::accept_invite))
        .route(
            "/api/orgs/:org_id/billing",
            put(orgs::set_billing).get(orgs::get_billing),
        )
        .route(
            "/api/orgs/:org_id/integrations/github",
            put(orgs::set_github)
                .delete(orgs::remove_github)
                .get(orgs::get_github),
        )
        // Credits / Billing
        .route(
            "/api/orgs/:org_id/credits/tiers",
            get(billing::get_credit_tiers),
        )
        .route(
            "/api/orgs/:org_id/credits/balance",
            get(billing::get_credit_balance),
        )
        .route(
            "/api/orgs/:org_id/credits/checkout",
            post(billing::create_credit_checkout),
        )
        .route(
            "/webhooks/billing/fulfill",
            post(billing::handle_fulfillment),
        )
        // GitHub App integrations
        .route(
            "/api/orgs/:org_id/integrations/github/app",
            get(github::list_integrations),
        )
        .route(
            "/api/orgs/:org_id/integrations/github/install",
            post(github::start_install),
        )
        .route(
            "/api/github/callback",
            get(github::github_callback),
        )
        .route(
            "/api/orgs/:org_id/integrations/github/:integration_id",
            delete(github::remove_integration),
        )
        .route(
            "/api/orgs/:org_id/integrations/github/repos",
            get(github::list_repos),
        )
        .route(
            "/api/orgs/:org_id/integrations/github/:integration_id/refresh",
            post(github::refresh_integration),
        )
        // Settings
        .route(
            "/api/settings/api-key",
            post(settings::set_api_key)
                .get(settings::get_api_key_info)
                .delete(settings::delete_api_key),
        )
        .route(
            "/api/settings/fee-schedule",
            get(pricing::get_fee_schedule).put(pricing::set_fee_schedule),
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
            get(projects::get_project)
                .put(projects::update_project)
                .delete(projects::delete_project),
        )
        .route(
            "/api/projects/:project_id/archive",
            post(projects::archive_project),
        )
        // Sprints
        .route(
            "/api/projects/:project_id/sprints",
            get(sprints::list_sprints).post(sprints::create_sprint),
        )
        .route(
            "/api/projects/:project_id/sprints/reorder",
            put(sprints::reorder_sprints),
        )
        .route(
            "/api/projects/:project_id/sprints/:sprint_id",
            get(sprints::get_sprint)
                .put(sprints::update_sprint)
                .delete(sprints::delete_sprint),
        )
        .route(
            "/api/projects/:project_id/sprints/:sprint_id/generate",
            post(sprints::generate_sprint),
        )
        .route(
            "/api/projects/:project_id/sprints/:sprint_id/generate/stream",
            post(sprints::generate_sprint_stream),
        )
        // Specs
        .route("/api/projects/:project_id/specs", get(specs::list_specs))
        .route(
            "/api/projects/:project_id/specs/generate",
            post(specs::generate_specs),
        )
        .route(
            "/api/projects/:project_id/specs/generate/stream",
            post(specs::generate_specs_stream),
        )
        .route(
            "/api/projects/:project_id/specs/summary",
            post(specs::generate_specs_summary),
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
            "/api/projects/:project_id/tasks/:task_id/run",
            post(dev_loop::run_single_task),
        )
        .route(
            "/api/projects/:project_id/tasks/:task_id/output",
            get(tasks::get_task_output),
        )
        .route(
            "/api/projects/:project_id/progress",
            get(tasks::get_progress),
        )
        // Sessions (project-level)
        .route(
            "/api/projects/:project_id/sessions",
            get(agents::list_project_sessions),
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
        .route(
            "/api/projects/:project_id/agents/:agent_id/sessions/:session_id",
            get(agents::get_session),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_id/sessions/:session_id/tasks",
            get(agents::list_session_tasks),
        )
        // Chat Sessions
        .route(
            "/api/projects/:project_id/chat-sessions",
            post(chat::create_chat_session).get(chat::list_chat_sessions),
        )
        .route(
            "/api/projects/:project_id/chat-sessions/:chat_session_id",
            axum::routing::put(chat::update_chat_session)
                .delete(chat::delete_chat_session),
        )
        .route(
            "/api/projects/:project_id/chat-sessions/:chat_session_id/messages",
            get(chat::list_messages),
        )
        .route(
            "/api/projects/:project_id/chat-sessions/:chat_session_id/messages/stream",
            post(chat::send_message_stream),
        )
        // Log entries
        .route("/api/log-entries", get(log::list_log_entries))
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
        .route(
            "/api/projects/:project_id/loop/status",
            get(dev_loop::get_loop_status),
        )
        // Terminal
        .route("/api/terminal", post(terminal::spawn_terminal).get(terminal::list_terminals))
        .route("/api/terminal/:id", delete(terminal::kill_terminal))
        .route("/ws/terminal/:id", get(terminal::ws_terminal))
        // WebSocket
        .route("/ws/events", get(ws::ws_events))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    match frontend_dir {
        Some(dir) => {
            let index = dir.join("index.html");
            let serve = ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    axum::http::header::CACHE_CONTROL,
                    HeaderValue::from_static("no-cache"),
                ))
                .service(ServeDir::new(&dir).not_found_service(ServeFile::new(index)));
            api_router.fallback_service(serve)
        }
        None => api_router,
    }
}
