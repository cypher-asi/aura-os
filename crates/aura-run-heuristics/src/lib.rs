//! Heuristic analyzer for `aura-os-server` dev-loop run bundles.
//!
//! Loads a bundle directory produced by `apps/aura-os-server/src/loop_log.rs`
//! and runs a small set of rules that surface common dev-loop
//! pathologies (duplicate blocker paths, token-hog LLM calls, stuck
//! reasoning loops, …). The analyzer is deliberately a pure-function
//! library: the `aura-run-analyze` CLI and (future) server endpoints
//! decide how to render the findings.

mod bundle;
mod finding;
mod rules;

#[cfg(test)]
mod test_support;

pub use bundle::{load_bundle, BundleView};
pub use finding::{Finding, RemediationHint, Severity};
pub use rules::analyze;

// Re-export the rule functions individually so callers (tests,
// specialised tools) can run a subset of rules without the full
// pipeline.
pub use rules::{
    high_retry_density, repeated_blocker_path, slow_iteration, task_never_completed,
    token_hog_llm_call, unbalanced_io, zero_tool_calls_in_turn,
};
