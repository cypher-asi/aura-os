//! Routes for app-wide / per-user preferences (`/api/preferences/*`).
//!
//! The skeleton mounts an empty router; each preference feature adds
//! its own `.route(...)` line here, pointing at the `get_*` / `put_*`
//! (and optional `delete_*`) handlers in `handlers::preferences`.
//!
//! Convention: path `/api/preferences/<feature-kebab>`, GET to read
//! (returns the feature's default when unset), PUT to write, optional
//! DELETE to reset-to-default.
//!
//! Example (added by a feature PR):
//! ```ignore
//! .route(
//!     "/api/preferences/agent-order",
//!     get(preferences::get_agent_order)
//!         .put(preferences::put_agent_order)
//!         .delete(preferences::delete_agent_order),
//! )
//! ```

use axum::Router;

#[allow(unused_imports)]
use crate::handlers::preferences;
use crate::state::AppState;

pub(super) fn preferences_routes() -> Router<AppState> {
    // Feature routes are registered here by the ported preference PRs.
    Router::new()
}
