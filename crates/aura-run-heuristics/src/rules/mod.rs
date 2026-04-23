//! Heuristic rule implementations. Each rule is a small pure function
//! that takes a `BundleView` and returns zero or more `Finding`s.
//!
//! The rule functions are re-exported from the crate root so callers
//! that only care about, say, retry density can call a single rule
//! without running the full pipeline.

use crate::bundle::BundleView;
use crate::finding::Finding;

mod helpers;
mod high_retry_density;
mod repeated_blocker_path;
mod slow_iteration;
mod task_never_completed;
mod token_hog_llm_call;
mod unbalanced_io;
mod unclassified_retry_miss;
mod zero_tool_calls_in_turn;

pub use high_retry_density::high_retry_density;
pub use repeated_blocker_path::repeated_blocker_path;
pub use slow_iteration::slow_iteration;
pub use task_never_completed::task_never_completed;
pub use token_hog_llm_call::token_hog_llm_call;
pub use unbalanced_io::unbalanced_io;
pub use unclassified_retry_miss::unclassified_retry_miss;
pub use zero_tool_calls_in_turn::zero_tool_calls_in_turn;

/// Run every rule and concatenate the findings in a stable,
/// rule-by-rule order. Rules run independently so their output can
/// be reordered later without affecting behaviour.
pub fn analyze(bundle: &BundleView) -> Vec<Finding> {
    let mut out = Vec::new();
    out.extend(repeated_blocker_path(bundle));
    out.extend(high_retry_density(bundle));
    out.extend(unclassified_retry_miss(bundle));
    out.extend(slow_iteration(bundle));
    out.extend(token_hog_llm_call(bundle));
    out.extend(unbalanced_io(bundle));
    out.extend(task_never_completed(bundle));
    out.extend(zero_tool_calls_in_turn(bundle));
    out
}
