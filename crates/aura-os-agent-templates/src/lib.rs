//! Portable agent templates.
//!
//! This crate contains the portable data (system prompt, classifier
//! rules, tool manifest) used to seed new `Agent` records and to
//! render/classify turns for agents built from a known preset. It has
//! a minimal dependency graph (only `aura-os-core` for
//! [`aura_os_core::ToolDomain`] plus `serde`) so the same template can
//! be:
//!
//! 1. consumed by the unified agent-runtime / harness dispatcher in
//!    `aura-os-server`;
//! 2. serialized as JSON and shipped to a harness-hosted agent so the
//!    harness can render the same system prompt, classify intents with
//!    the same rules, and filter tools by the same domain manifest.
//!
//! The CEO preset remains the canonical starter template; the former
//! "super-agent tier" is now just a *permission-rich* agent and carries
//! no type-level meaning (see `AgentPermissions` in `aura-os-core`).
//!
//! See `crates/aura-os-agent-templates/src/template.rs` for the
//! `AgentTemplate` struct and its CEO default.

pub mod prompt;
pub mod template;
pub mod tier;

pub use prompt::{build_dynamic_context, ceo_system_prompt, dev_loop_executor_dod_prompt};
pub use template::{AgentTemplate, ToolManifestEntry, CEO_PRESET_NAME};
pub use tier::{
    classify_intent, classify_intent_with, default_classifier_rules, is_tier1, ClassifierRule,
    HARNESS_SIDE_STREAMING_TOOL_NAMES, LOADABLE_DOMAINS, TIER1_DOMAINS,
};
