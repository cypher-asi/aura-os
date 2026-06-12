//! Routes for the `/api/public/*` anonymous endpoint family.
//!
//! Phase 2 wired setup + chat; phase 3 extends the router with three
//! generation endpoints (image / video / model3d) that share the
//! Phase 1 rate limiter and count toward the same 3-turn bucket.
//!
//! The three generation routes are mounted only when
//! [`public_generation_enabled`] returns `true`, allowing ops to
//! disable the expensive endpoints (the three generation modalities
//! are materially more expensive per-call than chat) without
//! disabling public chat. Default is `true`; set
//! `AURA_PUBLIC_GENERATION_ENABLED=false` to turn them off.

use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{feedback, public, public_models};
use crate::state::AppState;

/// Env var that toggles the three public generation endpoints. When
/// blank, malformed, or unset, the endpoints are enabled (consistent
/// with the rest of the codebase's "default-on" feature flags).
const PUBLIC_GENERATION_ENABLED_ENV: &str = "AURA_PUBLIC_GENERATION_ENABLED";

/// Parse [`PUBLIC_GENERATION_ENABLED_ENV`] as a boolean. Treats any
/// case-insensitive `false` / `0` / `no` / `off` as disabled;
/// everything else (including unset) enables the endpoints.
fn public_generation_enabled() -> bool {
    match std::env::var(PUBLIC_GENERATION_ENABLED_ENV) {
        Ok(raw) => !matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "false" | "0" | "no" | "off",
        ),
        Err(_) => true,
    }
}

/// Build the public-endpoint router. Mounted from
/// [`super::create_router_with_interface`] next to `auth_routes()`
/// — never inside `protected_api_router` — so the global auth
/// middleware never inspects the request.
pub(super) fn public_routes() -> Router<AppState> {
    let mut router = Router::new()
        .route("/api/public/setup", post(public::public_setup))
        .route("/api/public/chat/stream", post(public::public_chat_stream))
        // Marketing `/feedback` page reads from this same-origin pass-through
        // so the browser no longer needs `VITE_AURA_NETWORK_URL`; the upstream
        // `AURA_NETWORK_URL` stays a server-side env (mirrors the aura-web
        // `force-dynamic` RSC pattern at `src/app/roadmap/page.tsx`).
        .route("/api/public/feedback", get(feedback::pub_list_feedback))
        // Marketing `/models` page reads from this same-origin pass-through
        // to aura-network's `/api/public/models`. Same graceful-degrade
        // contract as `/api/public/feedback`: returns `[]` when no
        // aura-network client is configured or the upstream call fails.
        .route("/api/public/models", get(public_models::pub_list_models))
        // Read-only public transcript for a shared session. Resolved
        // with the server's `AURA_STORAGE_INTERNAL_TOKEN` and gated on
        // the session's `is_public` flag (see `public::get_public_share`).
        .route("/api/public/share/:token", get(public::get_public_share))
        // Anonymous blog reads. Blog posts are notes under the reserved
        // `AURA_BLOG_PROJECT_ID`; only published rows are returned, resolved
        // with the server's `X-Internal-Token` (no caller JWT).
        .route("/api/public/blog", get(public::list_published_blog))
        .route(
            "/api/public/blog/:slug",
            get(public::get_published_blog_by_slug),
        )
        // Anonymous AURA OS whitepaper reads. Sections are notes under the
        // reserved `AURA_WHITEPAPER_PROJECT_ID`; only published rows are
        // returned, in authored (`sortOrder`) order, resolved with the
        // server's `X-Internal-Token` (no caller JWT).
        .route("/api/public/os", get(public::list_published_os))
        .route(
            "/api/public/os/:slug",
            get(public::get_published_os_by_slug),
        )
        // Anonymous documentation reads. Doc pages are notes under the
        // reserved `AURA_DOCS_PROJECT_ID`; only published rows are returned,
        // in authored (`sortOrder`) order, resolved with the server's
        // `X-Internal-Token` (no caller JWT).
        .route("/api/public/docs", get(public::list_published_docs))
        .route(
            "/api/public/docs/:slug",
            get(public::get_published_docs_by_slug),
        )
        .route(
            "/api/public/x402/v1/models",
            get(public::public_x402_models),
        )
        .route(
            "/api/public/x402/v1/chat/completions",
            post(public::public_x402_chat_completions),
        );
    if public_generation_enabled() {
        router = router
            .route(
                "/api/public/generation/image",
                post(public::public_image_stream),
            )
            .route(
                "/api/public/generation/video",
                post(public::public_video_stream),
            )
            .route(
                "/api/public/generation/model3d",
                post(public::public_model3d_stream),
            );
    }
    router
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_generation_enabled_defaults_to_true() {
        // Snapshot whatever the test env currently has, then ensure
        // the default-on contract holds when the var is absent.
        let prior = std::env::var(PUBLIC_GENERATION_ENABLED_ENV).ok();
        std::env::remove_var(PUBLIC_GENERATION_ENABLED_ENV);
        assert!(public_generation_enabled());
        if let Some(value) = prior {
            std::env::set_var(PUBLIC_GENERATION_ENABLED_ENV, value);
        }
    }

    #[test]
    fn public_generation_enabled_parses_false_strings() {
        let prior = std::env::var(PUBLIC_GENERATION_ENABLED_ENV).ok();
        for token in ["false", "FALSE", "0", "no", "off"] {
            std::env::set_var(PUBLIC_GENERATION_ENABLED_ENV, token);
            assert!(!public_generation_enabled(), "token = {token}");
        }
        match prior {
            Some(value) => std::env::set_var(PUBLIC_GENERATION_ENABLED_ENV, value),
            None => std::env::remove_var(PUBLIC_GENERATION_ENABLED_ENV),
        }
    }
}
