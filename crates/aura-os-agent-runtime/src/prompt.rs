//! Re-exports of the portable super-agent prompt helpers.
//!
//! The prompt template itself moved to `aura-os-super-agent-profile`
//! in phase 2 so that the harness-hosted path can render the same
//! prompt without depending on the full `aura-os-super-agent` crate.
//! The previous in-process API is preserved via re-exports so existing
//! call sites continue to compile unchanged.

pub use aura_os_super_agent_profile::{build_dynamic_context, super_agent_system_prompt};
