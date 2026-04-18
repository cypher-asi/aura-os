//! Portable super-agent profile.
//!
//! Phase 2 of the super-agent / harness unification plan extracts the
//! hard-coded CEO super-agent configuration from `aura-os-super-agent`
//! into a crate with a minimal dependency graph (only `aura-os-core`
//! for [`aura_os_core::ToolDomain`] and `serde`). This lets the same
//! profile be:
//!
//! 1. consumed in-process by today's `SuperAgentStream` path
//!    (via re-exports in `aura-os-super-agent`, preserving existing
//!    call sites);
//! 2. serialized as JSON and shipped to a harness-hosted agent so the
//!    harness can render the same system prompt, classify intents with
//!    the same rules, and filter tools by the same domain manifest.
//!
//! The public API is `pub` at the crate root via re-exports so
//! consumers can write `aura_os_super_agent_profile::classify_intent`
//! without going through nested modules.
//!
//! See `crates/aura-os-super-agent-profile/src/profile.rs` for the
//! `SuperAgentProfile` struct and its CEO default.

pub mod prompt;
pub mod profile;
pub mod tier;

pub use profile::{
    ceo_tool_manifest, SuperAgentProfile, ToolManifestEntry, CEO_PRESET_NAME,
};
pub use prompt::{build_dynamic_context, super_agent_system_prompt};
pub use tier::{
    classify_intent, classify_intent_with, default_classifier_rules, is_tier1, ClassifierRule,
    LOADABLE_DOMAINS, STREAMING_TOOL_NAMES, TIER1_DOMAINS,
};
