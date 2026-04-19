use std::path::PathBuf;

use axum::http::HeaderValue;
use axum::middleware;
use axum::routing::{delete, get, post, put};
use axum::Router;
use tower::ServiceBuilder;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::{
    agents, auth, billing, browser, dev_loop, feed, feedback, files, follows, generation,
    harness_proxy, leaderboard, log, marketplace, notes, org_tools, orgs, process, project_stats,
    agent_bootstrap, agent_tools, projects, remote_files, remote_terminal, specs, swarm, system,
    tasks, terminal, users, ws,
};
use crate::state::AppState;

const LOCAL_CORS_HOSTS: &[&str] = &["localhost", "127.0.0.1"];

fn is_local_cors_origin(origin: &str) -> bool {
    let Some((scheme, remainder)) = origin.split_once("://") else {
        return false;
    };
    let host = remainder.split('/').next().unwrap_or(remainder);

    match scheme {
        "http" | "https" => LOCAL_CORS_HOSTS
            .iter()
            .any(|expected| host == *expected || host.starts_with(&format!("{expected}:"))),
        "capacitor" => host == "localhost",
        _ => false,
    }
}

fn is_allowed_cors_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    // Native mobile shells authenticate cross-origin from localhost-like webview
    // origins, so cookie-based API access must allow those explicit origins.
    if is_local_cors_origin(origin) {
        return true;
    }

    std::env::var("AURA_ALLOWED_ORIGINS")
        .ok()
        .into_iter()
        .flat_map(|value| {
            value
                .split(',')
                .map(str::trim)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .any(|allowed| !allowed.is_empty() && allowed == origin)
}

pub fn build_local_api_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            is_allowed_cors_origin(origin)
        }))
        .allow_credentials(true)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
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
        .merge(task_routes())
        .merge(agent_routes())
        .merge(social_routes())
        .merge(feedback_routes())
        .merge(system_routes())
        .merge(agent_bootstrap_routes())
        .merge(process_routes())
        .merge(generation_routes())
        .merge(harness_proxy_routes())
        .merge(notes_routes())
        .merge(marketplace_routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth_guard::require_verified_session,
        ));

    let api_router = Router::new()
        .route("/health", get(system::health))
        .merge(auth_routes())
        .merge(protected_api_router)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    match interface_dir {
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
    let routes = Router::new()
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/logout", post(auth::logout))
        .route(
            "/api/auth/request-password-reset",
            post(auth::request_password_reset),
        );

    if auth::auth_token_import_enabled() {
        routes.route(
            "/api/auth/import-access-token",
            post(auth::import_access_token),
        )
    } else {
        routes
    }
}

fn protected_auth_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/session", get(auth::get_session))
        .route("/api/auth/validate", post(auth::validate))
        .route("/api/auth/jwt-issuer", get(auth::get_jwt_issuer))
    // Access code endpoints disabled for launch — Zero Pro is the only entry path.
    // .route("/api/auth/redeem-access-code", post(auth::redeem_access_code))
    // .route("/api/auth/access-codes", get(auth::get_access_code))
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
        .route(
            "/api/orgs/:org_id/integrations",
            get(orgs::list_integrations).post(orgs::create_integration),
        )
        .route(
            "/api/orgs/:org_id/integrations/:integration_id",
            put(orgs::update_integration).delete(orgs::delete_integration),
        )
        .route(
            "/api/orgs/:org_id/tool-actions/:tool_name",
            post(org_tools::call_tool),
        )
        .route(
            "/api/orgs/:org_id/tool-actions",
            get(org_tools::list_tool_catalog),
        )
        .route(
            "/api/orgs/:org_id/tool-actions/mcp/:integration_id",
            post(org_tools::call_mcp_tool),
        )
        .route("/api/invites/:token/accept", post(orgs::accept_invite))
        .route(
            "/api/orgs/:org_id/billing",
            put(orgs::set_billing).get(orgs::get_billing),
        )
        .route(
            "/api/orgs/:org_id/integration-config",
            get(orgs::get_integrations).put(orgs::set_integrations),
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
        .route("/api/read-file", post(files::read_file))
        .route("/api/file-preview", get(files::preview_file))
}

fn spec_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects/:project_id/specs",
            get(specs::list_specs).post(specs::create_spec),
        )
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
            get(specs::get_spec)
                .put(specs::update_spec)
                .delete(specs::delete_spec),
        )
}

fn task_routes() -> Router<AppState> {
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
            "/api/agents/:agent_id/projects",
            get(agents::list_agent_project_bindings),
        )
        .route(
            "/api/agents/:agent_id/projects/:project_agent_id",
            delete(agents::remove_agent_project_binding),
        )
        .route(
            "/api/agents/:agent_id/remote_agent/state",
            get(swarm::get_remote_agent_state),
        )
        .route(
            "/api/agents/:agent_id/remote_agent/files",
            post(remote_files::list_remote_directory),
        )
        .route(
            "/api/agents/:agent_id/remote_agent/read-file",
            post(remote_files::read_remote_file),
        )
        .route(
            "/api/agents/:agent_id/remote_agent/recover",
            post(swarm::recover_remote_agent),
        )
        .route(
            "/api/agents/:agent_id/remote_agent/:action",
            post(swarm::remote_agent_lifecycle),
        )
        .route(
            "/api/agents/:agent_id/events",
            get(agents::list_agent_events),
        )
        .route(
            "/api/agents/:agent_id/events/paginated",
            get(agents::list_agent_events_paginated),
        )
        .route(
            "/api/agents/:agent_id/runtime/test",
            post(agents::test_agent_runtime),
        )
        .route(
            "/api/agents/:agent_id/events/stream",
            post(agents::send_agent_event_stream),
        )
        .route(
            "/api/agents/:agent_id/reset-session",
            post(agents::reset_agent_session),
        )
        .route(
            "/api/agents/:agent_id/context-usage",
            get(agents::get_agent_context_usage),
        )
        .route(
            "/api/agents/:agent_id/installed-tools",
            get(agents::get_installed_tools_diagnostic),
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
            "/api/projects/:project_id/agents/:agent_instance_id/reset-session",
            post(agents::reset_instance_session),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/context-usage",
            get(agents::get_instance_context_usage),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/sessions",
            get(agents::list_sessions),
        )
        .route(
            "/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id",
            get(agents::get_session).delete(agents::delete_session),
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
            "/api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/summarize",
            post(agents::summarize_session),
        )
        .route(
            "/api/projects/:project_id/sessions",
            get(agents::list_project_sessions),
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

fn feedback_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/feedback",
            get(feedback::list_feedback).post(feedback::create_feedback),
        )
        .route("/api/feedback/:post_id", get(feedback::get_feedback))
        .route(
            "/api/feedback/:post_id/status",
            axum::routing::patch(feedback::update_feedback_status),
        )
        .route(
            "/api/feedback/:post_id/comments",
            get(feedback::list_feedback_comments).post(feedback::add_feedback_comment),
        )
        .route(
            "/api/feedback/:post_id/vote",
            post(feedback::cast_feedback_vote),
        )
}

fn marketplace_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/marketplace/agents",
            get(marketplace::list_marketplace_agents),
        )
        .route(
            "/api/marketplace/agents/:agent_id",
            get(marketplace::get_marketplace_agent),
        )
}

fn agent_bootstrap_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agents/harness/setup",
            post(agent_bootstrap::setup_ceo_agent),
        )
        // DEPRECATED: renamed to /api/agents/harness/setup; keep alias for rollout compat
        .route(
            "/api/super-agent/setup",
            post(agent_bootstrap::setup_ceo_agent),
        )
        .route(
            "/api/agents/harness/cleanup",
            post(agent_bootstrap::cleanup_ceo_agents),
        )
        // DEPRECATED: renamed to /api/agents/harness/cleanup; keep alias for rollout compat
        .route(
            "/api/super-agent/cleanup",
            post(agent_bootstrap::cleanup_ceo_agents),
        )
        .route(
            "/api/agent-orchestrations",
            get(agent_bootstrap::list_orchestrations),
        )
        .route(
            "/api/agent-orchestrations/:orchestration_id",
            get(agent_bootstrap::get_orchestration),
        )
        .route(
            "/api/agents/harness/events",
            get(agent_bootstrap::list_pending_events),
        )
        // DEPRECATED: renamed to /api/agents/harness/events; keep alias for rollout compat
        .route(
            "/api/super-agent/events",
            get(agent_bootstrap::list_pending_events),
        )
        // Dispatcher that lets a harness-hosted agent execute
        // cross-agent tools (spawn_agent, control_agent, etc.) in
        // process. Gated per-agent by `AgentPermissions::capabilities`
        // at `send_agent_event_stream` build time — this route merely
        // resolves the tool by name.
        .route(
            "/api/agent_tools/:name",
            post(agent_tools::dispatch_agent_tool),
        )
        // Non-blocking harness reachability probe for the agent
        // editor's Local/Cloud toggle.
        .route(
            "/api/agents/harness/health",
            get(agent_bootstrap::harness_health),
        )
        // DEPRECATED: renamed to /api/agents/harness/health; keep alias for rollout compat
        .route(
            "/api/super_agent/harness/health",
            get(agent_bootstrap::harness_health),
        )
}

fn process_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/processes",
            get(process::list_processes).post(process::create_process),
        )
        .route(
            "/api/processes/:id",
            get(process::get_process)
                .put(process::update_process)
                .delete(process::delete_process),
        )
        .route("/api/processes/:id/trigger", post(process::trigger_process))
        .route(
            "/api/processes/:id/nodes",
            get(process::list_nodes).post(process::create_node),
        )
        .route(
            "/api/processes/:id/nodes/:node_id",
            put(process::update_node).delete(process::delete_node),
        )
        .route(
            "/api/processes/:id/connections",
            get(process::list_connections).post(process::create_connection),
        )
        .route(
            "/api/processes/:id/connections/:connection_id",
            delete(process::delete_connection),
        )
        .route("/api/processes/:id/runs", get(process::list_runs))
        .route("/api/processes/:id/runs/:run_id", get(process::get_run))
        .route(
            "/api/processes/:id/runs/:run_id/cancel",
            post(process::cancel_run),
        )
        .route(
            "/api/processes/:id/runs/:run_id/events",
            get(process::list_run_events),
        )
        .route(
            "/api/processes/:id/runs/:run_id/artifacts",
            get(process::list_run_artifacts),
        )
        .route("/api/process-artifacts/:id", get(process::get_artifact))
        .route(
            "/api/process-folders",
            get(process::list_folders).post(process::create_folder),
        )
        .route(
            "/api/process-folders/:id",
            put(process::update_folder).delete(process::delete_folder),
        )
}

fn generation_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/generate/image/stream",
            post(generation::generate_image_stream),
        )
        .route(
            "/api/generate/3d/stream",
            post(generation::generate_3d_stream),
        )
}

fn harness_proxy_routes() -> Router<AppState> {
    Router::new()
        // Memory – Facts
        .route(
            "/api/harness/agents/:agent_id/memory/facts",
            get(harness_proxy::list_facts).post(harness_proxy::create_fact),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/facts/by-key/:key",
            get(harness_proxy::get_fact_by_key),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/facts/:fact_id",
            get(harness_proxy::get_fact)
                .put(harness_proxy::update_fact)
                .delete(harness_proxy::delete_fact),
        )
        // Memory – Events
        .route(
            "/api/harness/agents/:agent_id/memory/events",
            get(harness_proxy::list_events).post(harness_proxy::create_event),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/events/:event_id",
            delete(harness_proxy::delete_event),
        )
        // Memory – Procedures
        .route(
            "/api/harness/agents/:agent_id/memory/procedures",
            get(harness_proxy::list_procedures).post(harness_proxy::create_procedure),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/procedures/by-skill/:skill_name",
            get(harness_proxy::list_procedures_by_skill),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/procedures/:proc_id",
            get(harness_proxy::get_procedure)
                .put(harness_proxy::update_procedure)
                .delete(harness_proxy::delete_procedure),
        )
        // Memory – Aggregate
        .route(
            "/api/harness/agents/:agent_id/memory",
            get(harness_proxy::get_memory_snapshot).delete(harness_proxy::wipe_memory),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/stats",
            get(harness_proxy::get_memory_stats),
        )
        .route(
            "/api/harness/agents/:agent_id/memory/consolidate",
            post(harness_proxy::trigger_consolidation),
        )
        // Skills
        .route(
            "/api/harness/skills",
            get(harness_proxy::list_skills).post(harness_proxy::create_skill),
        )
        // `/skills/mine` is registered before `/skills/:name` so the static path
        // wins over the dynamic param route. (Axum prefers static segments, but
        // keeping them ordered makes the intent obvious.)
        .route("/api/harness/skills/mine", get(harness_proxy::list_my_skills))
        .route(
            "/api/harness/skills/mine/:name",
            delete(harness_proxy::delete_my_skill),
        )
        .route("/api/harness/skills/:name", get(harness_proxy::get_skill))
        .route(
            "/api/harness/skills/:name/activate",
            post(harness_proxy::activate_skill),
        )
        .route(
            "/api/harness/skills/install-from-shop",
            post(harness_proxy::install_from_shop),
        )
        // Per-agent skill installations
        .route(
            "/api/harness/agents/:agent_id/skills",
            get(harness_proxy::list_agent_skills).post(harness_proxy::install_agent_skill),
        )
        .route(
            "/api/harness/agents/:agent_id/skills/:name",
            delete(harness_proxy::uninstall_agent_skill),
        )
        // Skill path discovery
        .route(
            "/api/skills/:name/discover-paths",
            get(harness_proxy::discover_skill_paths),
        )
        // Local skill content
        .route(
            "/api/skills/:category/:name/content",
            get(harness_proxy::get_skill_content),
        )
}

fn notes_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/notes/projects/:project_id/tree",
            get(notes::list_tree),
        )
        .route(
            "/api/notes/projects/:project_id/read",
            get(notes::read_note),
        )
        .route(
            "/api/notes/projects/:project_id/write",
            post(notes::write_note),
        )
        .route(
            "/api/notes/projects/:project_id/create",
            post(notes::create_entry),
        )
        .route(
            "/api/notes/projects/:project_id/rename",
            post(notes::rename_entry),
        )
        .route(
            "/api/notes/projects/:project_id/delete",
            post(notes::delete_entry),
        )
        .route(
            "/api/notes/projects/:project_id/comments",
            get(notes::list_comments)
                .post(notes::add_comment)
                .delete(notes::delete_comment),
        )
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
