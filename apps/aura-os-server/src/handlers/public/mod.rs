//! Public (anonymous) endpoint family.
//!
//! Phase 1 (Foundations) introduces the auth + rate-limit plumbing the
//! later-phase handlers (chat, image, video, model3d) all sit on top
//! of. Nothing in this module is mounted on the router yet — the
//! `router/public.rs` wiring lands in Phase 2, which is also when the
//! `dead_code` and `unused_imports` allows below stop being
//! load-bearing (every re-export has a phase-2 / phase-3 consumer
//! queued up).
//!
//! Module layout:
//!
//! - [`types`] — shared newtypes ([`GuestId`], [`PublicTurnCount`],
//!   [`IpHash`], [`PublicModality`]) plus the [`GuestClaims`] payload
//!   the [`crate::state::AuthGuestJwt`] extractor decodes from the
//!   bearer token.
//! - [`rate_limiter`] — process-wide [`RateLimiter`] keyed on
//!   `(GuestId, IpHash)` with lazy 24h eviction and a [`Clock`]
//!   abstraction so tests can pin "now".
//! - [`gate`] — the public-facing surface used by phase-2 handlers
//!   ([`enforce_public_turn`], [`record_completion`], [`emit_limit_frame`])
//!   plus the [`PublicGateCtx`] container that keeps the call shape
//!   under the 5-parameter ceiling.
//! - [`demo_agent`] — lazy provisioning of the system-owned
//!   [`AgentId`](aura_os_core::AgentId) every public chat turn targets.

// Phase 2 mounts the chat / setup handlers below. A handful of
// `TurnGuard` / `RateLimitError` accessors and newtype fields still
// have no in-crate consumer yet — phase-3 generation handlers
// (image, video, model3d) and phase-4 tests will exercise them.
// Narrow `dead_code` allow keeps the warning floor clean without
// papering over phase-2 imports.
#![allow(dead_code)]

pub(crate) mod blog;
pub(crate) mod chat;
pub(crate) mod demo_agent;
pub(crate) mod gate;
pub(crate) mod generation_common;
pub(crate) mod image;
pub(crate) mod jwt;
pub(crate) mod model3d;
pub(crate) mod rate_limiter;
pub(crate) mod setup;
pub(crate) mod share;
pub(crate) mod types;
pub(crate) mod video;
pub(crate) mod x402;

// Public-mode surface re-exports. Only the items consumed from
// outside this module live here; internal helpers stay reachable
// through their submodule path. Keeping the re-export list tight
// avoids the warning churn that an over-broad `pub(crate) use`
// produced in phase 1.
pub(crate) use blog::{get_published_blog_by_slug, list_published_blog};
pub(crate) use chat::public_chat_stream;
pub(crate) use image::public_image_stream;
pub(crate) use jwt::{decode_guest_token, extract_bearer_from_headers, is_guest_token};
pub(crate) use model3d::public_model3d_stream;
pub use rate_limiter::RateLimiter;
pub(crate) use setup::public_setup;
pub(crate) use share::get_public_share;
pub(crate) use types::GuestClaims;
pub(crate) use video::public_video_stream;
pub(crate) use x402::{public_x402_chat_completions, public_x402_models};
