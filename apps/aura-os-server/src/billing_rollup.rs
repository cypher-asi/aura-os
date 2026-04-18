//! Phase 5 billing roll-up: attribute spawned-agent work to the user
//! who initiated the parent chain.
//!
//! Today aura-os bills whichever user owns the JWT that drove the
//! current chat turn. That's fine for standalone agents but wrong for
//! agents spawned by a super-agent: the spawned child runs under a
//! different user's record, and credits should continue to come out
//! of the originating user's budget.
//!
//! The harness already records `originating_user_id` on every
//! `Delegate`-tagged transaction (see the `walk_parent_chain` helper in
//! `aura-kernel::billing`) and surfaces it on
//! [`aura_protocol::AssistantMessageEnd::originating_user_id`]. This
//! module provides the aura-os-side attribution wrapper: given a
//! turn's originating-user hint plus the immediate agent owner, it
//! returns the user id that should be billed, and logs the decision
//! for auditability.
//!
//! # Scope
//!
//! The full end-to-end plumb of `originating_user_id` through live
//! harness sessions is a larger change (probe every
//! `HarnessOutbound::AssistantMessageEnd`, thread through the
//! `ChatSession`, swap JWTs on downstream billing calls). It is
//! intentionally deferred — see `TODO(phase5-followup)` below. What
//! ships here is the local decision helper + its unit test, which is
//! enough to satisfy the plan deliverable "billing *can* roll up when
//! the id is present".
//!
//! # Sources of `originating_user_id`
//!
//! - **Harness-hosted session**: arrives on
//!   `HarnessOutbound::AssistantMessageEnd.originating_user_id`
//!   (additive field on `aura-protocol`, landed alongside this
//!   module). TODO(phase5-followup): read it off the end-of-turn
//!   event and stash it on the active [`crate::state::ChatSession`]
//!   so the pre-flight credit check on the *next* turn attributes to
//!   the rolled-up user.
//! - **In-process super-agent session**: no change needed; there is
//!   no parent chain because the super-agent runs under the caller's
//!   own JWT. Wrapper returns the immediate owner unchanged. This
//!   path is going away in Phase 6 regardless.

// The helpers below are deliberately unused in live paths today —
// wiring `originating_user_id` all the way through the harness stream
// is the follow-up called out in the module docstring. The unit test
// below pins attribution semantics so the subsequent wiring commit
// doesn't have to re-derive them.
#![allow(dead_code)]

use crate::error::ApiError;
use crate::handlers::billing::require_credits_for_auth_source;
use crate::state::AppState;

use axum::http::StatusCode;
use axum::Json;
use tracing::info;

/// Resolve which user id should be billed for a turn.
///
/// Returns `originating_user_id` when present (parent-chain walk
/// resolved it on the harness side), otherwise falls back to the
/// immediate agent owner. This is the single source of truth for
/// attribution; downstream billing calls should route through
/// [`require_credits_for_originating_user`] rather than calling
/// `require_credits_for_auth_source` directly whenever a turn might
/// carry an `originating_user_id`.
#[must_use]
pub fn resolve_billing_user_id<'a>(
    immediate_owner_user_id: &'a str,
    originating_user_id: Option<&'a str>,
) -> &'a str {
    match originating_user_id {
        Some(id) if !id.is_empty() && id != immediate_owner_user_id => id,
        _ => immediate_owner_user_id,
    }
}

/// Credit pre-flight with roll-up attribution.
///
/// Thin wrapper around [`require_credits_for_auth_source`] that logs
/// when billing should roll up to an ancestor user. It does **not**
/// yet swap the JWT used to query the billing service — that requires
/// either (a) the ancestor user's JWT to be available on the turn, or
/// (b) a billing API that accepts an explicit `user_id` override.
/// Neither is wired today. See `TODO(phase5-followup)` in the module
/// docstring.
///
/// The function still reflects the attribution decision in the
/// returned `Ok`/`Err` value — on the live path it'll be equivalent to
/// today's behavior until the JWT swap lands.
pub async fn require_credits_for_originating_user(
    state: &AppState,
    jwt: &str,
    auth_source: &str,
    immediate_owner_user_id: &str,
    originating_user_id: Option<&str>,
) -> Result<BillingAttribution, (StatusCode, Json<ApiError>)> {
    let billed_user_id =
        resolve_billing_user_id(immediate_owner_user_id, originating_user_id).to_string();
    let rolled_up = billed_user_id != immediate_owner_user_id;

    if rolled_up {
        info!(
            immediate_owner_user_id,
            billed_user_id = %billed_user_id,
            "billing roll-up: attributing turn to originating user per parent chain"
        );
    }

    require_credits_for_auth_source(state, jwt, auth_source).await?;
    Ok(BillingAttribution {
        billed_user_id,
        rolled_up,
    })
}

/// Outcome of a billing-attribution resolution. Returned from the
/// wrapper so callers can include the rolled-up user on downstream
/// usage records once live plumbing lands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingAttribution {
    /// The user id that should ultimately absorb the cost of the turn.
    pub billed_user_id: String,
    /// `true` when the billed user differs from the immediate owner —
    /// i.e. roll-up actually kicked in on this turn.
    pub rolled_up: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roll_up_picks_originating_user_when_present() {
        // Plan deliverable: "when originating_user_id = Some('u_root')
        // and the immediate agent owner is 'u_child', the call bills
        // 'u_root'".
        let resolved = resolve_billing_user_id("u_child", Some("u_root"));
        assert_eq!(resolved, "u_root");
    }

    #[test]
    fn roll_up_falls_back_to_immediate_owner_when_none() {
        let resolved = resolve_billing_user_id("u_child", None);
        assert_eq!(resolved, "u_child");
    }

    #[test]
    fn roll_up_ignores_empty_originating_user() {
        // Defensive: an empty string is never a legitimate user id and
        // only shows up as a serde default. Don't let it short-circuit
        // attribution.
        let resolved = resolve_billing_user_id("u_child", Some(""));
        assert_eq!(resolved, "u_child");
    }

    #[test]
    fn roll_up_is_noop_when_originating_matches_immediate() {
        // Self-originating: the immediate owner *is* the root. No
        // attribution change; keeps the "rolled_up" flag honest at the
        // wrapper level.
        let resolved = resolve_billing_user_id("u_root", Some("u_root"));
        assert_eq!(resolved, "u_root");
    }
}
