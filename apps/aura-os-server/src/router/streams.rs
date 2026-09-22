use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{agents, streams};
use crate::state::AppState;

/// Resumable-stream endpoints. Mounted inside the protected API router
/// so `require_verified_session` populates the `AuthSession` extractor
/// the handlers use for ownership checks.
pub(super) fn stream_routes() -> Router<AppState> {
    Router::new()
        .route("/api/streams/active", get(streams::list_active_streams))
        .route(
            "/api/streams/tool-approvals",
            get(streams::list_pending_tool_approvals),
        )
        .route(
            "/api/streams/tool-approvals/:request_id",
            post(streams::respond_to_tool_approval),
        )
        .route(
            "/api/streams/user-input",
            get(streams::list_pending_user_inputs).post(streams::request_user_input),
        )
        .route(
            "/api/streams/user-input/:request_id/respond",
            post(streams::respond_to_user_input),
        )
        // Subagent attach is registered BEFORE the `:attach_id` wildcard
        // so `/api/streams/subagents/...` is not shadowed by it.
        .route(
            "/api/streams/subagents/:child_run_id/attach",
            post(agents::attach_subagent_stream),
        )
        .route(
            "/api/streams/subagents/:child_run_id/send",
            post(agents::send_subagent_message),
        )
        // Persisted child transcript fetch — registered before the
        // `:attach_id` wildcard so it is not shadowed by it.
        .route(
            "/api/streams/subagents/sessions/:subagent_session_id/events",
            get(agents::list_subagent_session_events),
        )
        .route("/api/streams/:attach_id", get(streams::attach_stream))
        .route(
            "/api/streams/:attach_id/cancel",
            post(streams::cancel_stream),
        )
}
