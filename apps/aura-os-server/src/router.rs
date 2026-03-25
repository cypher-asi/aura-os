use std::path::PathBuf;

use axum::http::HeaderValue;
use axum::middleware;
use axum::routing::{delete, get, post, put};
use axum::Router;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::{
    agents, auth, billing, dev_loop, feed, files, follows, leaderboard, log, orgs, project_stats,
    projects, specs, tasks, terminal, tool_callbacks, users, ws,
};
use crate::state::AppState;

pub fn create_router_with_frontend(state: AppState, frontend_dir: Option<PathBuf>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let protected_api_router = Router::new()
        .merge(user_routes())
        .merge(org_routes())
        .merge(billing_routes())
        .merge(project_routes())
        .merge(spec_routes())
        .merge(task_routes())
        .merge(agent_routes())
        .merge(tool_callback_routes())
        .merge(social_routes())
        .merge(system_routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth_guard::require_verified_session,
        ));

    let api_router = Router::new()
        .merge(auth_routes())
        .merge(protected_api_router)
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

fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/session", get(auth::get_session))
        .route("/api/auth/validate", post(auth::validate))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/access-token", get(auth::get_access_token))
        .route("/api/auth/jwt-issuer", get(auth::get_jwt_issuer))
}

fn user_routes() -> Router<AppState> {
    Router::new()
        .route("/api/users/me", get(users::get_me).put(users::update_me))
        .route("/api/users/:user_id", get(users::get_user))
        .route("/api/users/:user_id/profile", get(users::get_user_profile))
        .route("/api/profiles/:profile_id", get(users::get_profile))
}

fn org_routes() -> Router<AppState> {
    Router::new()
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
}

fn billing_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/orgs/:org_id/credits/balance",
            get(billing::get_credit_balance),
        )
        .route(
            "/api/orgs/:org_id/credits/checkout",
            post(billing::create_credit_checkout),
        )
        .route(
            "/api/orgs/:org_id/credits/transactions",
            get(billing::get_transactions),
        )
        .route("/api/orgs/:org_id/account", get(billing::get_account))
}

fn project_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects",
            post(projects::create_project).get(projects::list_projects),
        )
        .route(
            "/api/projects/import",
            post(projects::create_imported_project),
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
        .route(
            "/api/projects/:project_id/stats",
            get(project_stats::get_project_stats),
        )
        .route("/api/list-directory", post(files::list_directory))
}

fn spec_routes() -> Router<AppState> {
    Router::new()
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
}

fn task_routes() -> Router<AppState> {
    Router::new()
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
}

fn agent_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agents",
            post(agents::create_agent).get(agents::list_agents),
        )
        .route(
            "/api/agents/:agent_id",
            get(agents::get_agent)
                .put(agents::update_agent)
                .delete(agents::delete_agent),
        )
        .route(
            "/api/agents/:agent_id/events",
            get(agents::list_agent_events),
        )
        .route(
            "/api/agents/:agent_id/events/stream",
            post(agents::send_agent_event_stream),
        )
        .route(
            "/api/projects/:project_id/agents",
            post(agents::create_agent_instance).get(agents::list_agent_instances),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id",
            get(agents::get_agent_instance)
                .put(agents::update_agent_instance)
                .delete(agents::delete_agent_instance),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/events",
            get(agents::list_events),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/events/stream",
            post(agents::send_event_stream),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/sessions",
            get(agents::list_sessions),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id",
            get(agents::get_session),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/tasks",
            get(agents::list_session_tasks),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/events",
            get(agents::list_session_events),
        )
        .route(
            "/api/projects/:project_id/sessions",
            get(agents::list_project_sessions),
        )
}

fn tool_callback_routes() -> Router<AppState> {
    Router::new().route(
        "/api/tool-callbacks/:project_id/:tool_name",
        post(tool_callbacks::handle_tool_callback),
    )
}

fn social_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/follows",
            post(follows::follow).get(follows::list_follows),
        )
        .route("/api/follows/:target_profile_id", delete(follows::unfollow))
        .route(
            "/api/follows/check/:target_profile_id",
            get(follows::check_follow),
        )
        .route("/api/leaderboard", get(leaderboard::get_leaderboard))
        .route("/api/stats", get(leaderboard::get_platform_stats))
        .route("/api/users/me/usage", get(leaderboard::get_personal_usage))
        .route("/api/orgs/:org_id/usage", get(leaderboard::get_org_usage))
        .route(
            "/api/orgs/:org_id/usage/members",
            get(leaderboard::get_org_usage_members),
        )
        .route("/api/feed", get(feed::list_feed))
        .route("/api/posts", post(feed::create_post))
        .route("/api/posts/:post_id", get(feed::get_post))
        .route(
            "/api/profiles/:profile_id/posts",
            get(feed::get_profile_posts),
        )
        .route(
            "/api/posts/:post_id/comments",
            get(feed::list_comments).post(feed::add_comment),
        )
        .route("/api/comments/:comment_id", delete(feed::delete_comment))
}

fn system_routes() -> Router<AppState> {
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
            "/api/projects/:project_id/loop/status",
            get(dev_loop::get_loop_status),
        )
        .route(
            "/api/terminal",
            post(terminal::spawn_terminal).get(terminal::list_terminals),
        )
        .route("/api/terminal/:id", delete(terminal::kill_terminal))
        .route("/ws/terminal/:id", get(terminal::ws_terminal))
        .route("/ws/events", get(ws::ws_events))
}
