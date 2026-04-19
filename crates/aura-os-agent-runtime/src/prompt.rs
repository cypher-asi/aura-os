//! Re-exports of the portable CEO-preset prompt helpers.
//!
//! The prompt template itself lives in `aura-os-agent-templates` so the
//! harness-hosted path can render the same prompt without depending on
//! the full `aura-os-agent-runtime` crate. The in-process API is
//! preserved via these re-exports so existing call sites compile
//! unchanged.

pub use aura_os_agent_templates::{build_dynamic_context, ceo_system_prompt};
