use std::path::PathBuf;

use axum::http::HeaderValue;
use axum::routing::{delete, get, post, put};
use axum::Router;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::{agents, auth, billing, dev_loop, feed, follows, leaderboard, log, orbit, orgs, pricing, projects, settings, specs, tasks, terminal, users, ws};
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
        .route("/api/auth/access-token", get(auth::get_access_token))
        // Users (proxied to aura-network)
        .route("/api/users/me", get(users::get_me).put(users::update_me))
        .route("/api/users/:user_id", get(users::get_user))
        .route("/api/users/:user_id/profile", get(users::get_user_profile))
        // Profiles (proxied to aura-network)
        .route("/api/profiles/:profile_id", get(users::get_profile))
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
        // Settings
        .route(
            "/api/settings/api-key",
            get(settings::get_api_key_info),
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
        // Orbit (repos list/search; JWT auth)
        .route("/api/orbit/repos", get(orbit::list_orbit_repos))
        .route(
            "/api/projects/:project_id/orbit-collaborators",
            get(orbit::get_project_orbit_collaborators),
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
        // User-level Agents
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
        // Agent-level messages (multi-project chat)
        .route(
            "/api/agents/:agent_id/messages",
            get(agents::list_agent_messages),
        )
        .route(
            "/api/agents/:agent_id/messages/stream",
            post(agents::send_agent_message_stream),
        )
        // Project-level Agent Instances
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
        // Messages (under agent instance)
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/messages",
            get(agents::list_messages),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/messages/stream",
            post(agents::send_message_stream),
        )
        // Sessions (under agent instance)
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
        // Project-wide sessions
        .route(
            "/api/projects/:project_id/sessions",
            get(agents::list_project_sessions),
        )
        // Follows (profile-based, proxied to aura-network)
        .route(
            "/api/follows",
            post(follows::follow).get(follows::list_follows),
        )
        .route(
            "/api/follows/:target_profile_id",
            delete(follows::unfollow),
        )
        .route(
            "/api/follows/check/:target_profile_id",
            get(follows::check_follow),
        )
        // Leaderboard + Usage (proxied to aura-network)
        .route("/api/leaderboard", get(leaderboard::get_leaderboard))
        .route(
            "/api/users/me/usage",
            get(leaderboard::get_personal_usage),
        )
        .route(
            "/api/orgs/:org_id/usage",
            get(leaderboard::get_org_usage),
        )
        .route(
            "/api/orgs/:org_id/usage/members",
            get(leaderboard::get_org_usage_members),
        )
        // Feed (proxied to aura-network)
        .route("/api/feed", get(feed::list_feed))
        .route(
            "/api/activity/:event_id/comments",
            get(feed::list_comments).post(feed::add_comment),
        )
        .route(
            "/api/comments/:comment_id",
            delete(feed::delete_comment),
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
