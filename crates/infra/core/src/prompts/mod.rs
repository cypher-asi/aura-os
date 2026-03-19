//! Central registry for all LLM system prompts used across the codebase.
//!
//! Each prompt type lives in its own module so prompts can be audited, versioned,
//! and iterated on. Engine prompt *builder functions* remain in `aura-engine`
//! because they depend on engine-specific types; their static preamble text
//! references constants from this crate.

mod chat;
mod engine_retry;
mod session_summary;
mod spec_generation;
mod task_extraction;

pub use chat::{
    CHAT_SYSTEM_PROMPT_BASE,
    CONTEXT_SUMMARY_SYSTEM_PROMPT,
    TITLE_GEN_SYSTEM_PROMPT,
};
pub use engine_retry::RETRY_CORRECTION_PROMPT;
pub use session_summary::SESSION_SUMMARY_SYSTEM_PROMPT;
pub use spec_generation::{
    SPEC_GENERATION_SYSTEM_PROMPT,
    SPEC_OVERVIEW_SYSTEM_PROMPT,
    SPEC_SUMMARY_SYSTEM_PROMPT,
};
pub use task_extraction::TASK_EXTRACTION_SYSTEM_PROMPT;
