//! Lazy provisioning of the system-owned demo agent every public
//! chat turn targets.
//!
//! Phase 1 stores the resulting [`AgentId`] on
//! [`AppState::public_demo_agent_id`] inside a
//! [`tokio::sync::OnceCell`] so:
//!
//! - the first public-chat call provisions the agent and caches the
//!   id for the rest of the process lifetime,
//! - subsequent calls hit a single atomic load,
//! - the synchronous `app_builder::build_app_state` doesn't have to
//!   block on async storage I/O at boot.
//!
//! The agent record itself (full [`Agent`] shape with system prompt,
//! permissions, etc.) is materialised through
//! [`AgentService::save_agent_shadow`] so the chat-session opener in
//! Phase 2 can resolve `state.agent_service.get_agent_local(...)` and
//! get back a real agent rather than a 404. Owner is the well-known
//! [`SYSTEM_DEMO_USER_ID`] sentinel — no real user account is involved.

use anyhow::Result;
use tracing::info;
use uuid::Uuid;

use aura_os_core::{Agent, AgentId, AgentPermissions};

use crate::state::AppState;

/// Stable owner-id stamped on every system-managed record (currently
/// just the public demo agent). The all-zero UUID was picked because
/// it is the documented [`Uuid::nil()`] sentinel — no real user
/// account will ever match it, so log greps and storage queries can
/// trivially filter out / in system rows.
pub(crate) const SYSTEM_DEMO_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

/// Stable agent-id for the system-owned demo agent. Constant so every
/// process / restart resolves to the same id and any persisted shadow
/// row keeps working across boots without a discovery step. The UUID
/// (`00000000-0000-0000-0000-000000000001`) is the next value after
/// [`SYSTEM_DEMO_USER_ID`] so logs that show both side-by-side stay
/// readable.
pub(crate) fn public_demo_agent_id() -> AgentId {
    AgentId::from_uuid(Uuid::from_u128(1))
}

/// System-prompt baked into the public chat agent shadow. Kept short
/// because the public chat surface should feel like a usable assistant;
/// the full CEO bootstrap prompt only makes sense once the user has
/// signed in and accepted an org.
pub(crate) const PUBLIC_DEMO_SYSTEM_PROMPT: &str =
    "You are Aura, a concise AI assistant on Aura's public chat. \
Answer the visitor's latest message directly before describing Aura. Do not open with \
a generic welcome, demo disclaimer, or marketing pitch. Mention sign-in only when the \
visitor asks to save work, use private data, run long jobs, deploy, or connect accounts.";

/// Model the public demo runs on. The router requires an explicit,
/// non-empty model id (it no longer falls back to an env default), and
/// the public chat surface has no client-side model picker — so the id
/// must be pinned server-side or every public turn fails with
/// `model name must not be empty`. Haiku keeps the anonymous,
/// IP-rate-limited, operator-funded surface inexpensive while staying
/// capable enough for a teaser.
pub(crate) const PUBLIC_DEMO_MODEL: &str = "aura-claude-haiku-4-5";

/// Idempotently provision the system-owned demo agent and return its
/// stable [`AgentId`].
///
/// Cached on [`AppState::public_demo_agent_id`] (a
/// [`tokio::sync::OnceCell<AgentId>`]) so the slow path runs once per
/// process and every later call is an atomic load. The slow path
/// builds the canonical [`Agent`] record and persists a shadow via
/// [`aura_os_agents::AgentService::save_agent_shadow`] — failures
/// are wrapped in [`anyhow::Error`] so the caller can decide whether
/// to surface a 5xx or fall back to "demo unavailable".
pub(crate) async fn ensure_public_demo_agent(state: &AppState) -> Result<AgentId> {
    let cached = state
        .public_demo_agent_id
        .get_or_try_init(|| async { provision_demo_agent(state) })
        .await?;
    Ok(*cached)
}

fn provision_demo_agent(state: &AppState) -> Result<AgentId> {
    let agent_id = public_demo_agent_id();
    let agent = build_demo_agent(agent_id);
    state
        .agent_service
        .save_agent_shadow(&agent)
        .map_err(|e| anyhow::anyhow!("failed to persist public demo agent shadow: {e}"))?;
    info!(
        agent_id = %agent_id,
        owner = SYSTEM_DEMO_USER_ID,
        "public_demo_agent_ready"
    );
    Ok(agent_id)
}

fn build_demo_agent(agent_id: AgentId) -> Agent {
    let now = chrono::Utc::now();
    Agent {
        agent_id,
        user_id: SYSTEM_DEMO_USER_ID.to_string(),
        org_id: None,
        name: "AURA Public Demo".to_string(),
        role: "Assistant".to_string(),
        personality: "Friendly, concise, and helpful for first-time visitors.".to_string(),
        system_prompt: PUBLIC_DEMO_SYSTEM_PROMPT.to_string(),
        skills: Vec::new(),
        icon: None,
        machine_type: "local".to_string(),
        adapter_type: "aura_harness".to_string(),
        environment: "local_host".to_string(),
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        vm_id: None,
        wallet_address: None,
        network_agent_id: None,
        profile_id: None,
        tags: Vec::new(),
        is_pinned: false,
        listing_status: aura_os_core::listing_status::AgentListingStatus::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::full_access(),
        intent_classifier: None,
        created_at: now,
        updated_at: now,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_demo_agent_id_is_stable_across_calls() {
        assert_eq!(public_demo_agent_id(), public_demo_agent_id());
    }

    #[test]
    fn system_demo_user_id_is_nil_uuid() {
        assert_eq!(SYSTEM_DEMO_USER_ID, Uuid::nil().to_string());
    }

    #[test]
    fn build_demo_agent_carries_system_prompt_and_owner() {
        let agent = build_demo_agent(public_demo_agent_id());
        assert_eq!(agent.user_id, SYSTEM_DEMO_USER_ID);
        assert!(agent.system_prompt.starts_with("You are Aura"));
        assert_eq!(agent.machine_type, "local");
    }
}
