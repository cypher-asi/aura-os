//! Cross-module smoke tests for the resilience surface.
//!
//! Each submodule (`tool_retry`, `task_retry`, `orphan`) carries
//! its own colocated `#[cfg(test)]` block covering the behavioural
//! detail. The tests here pin the **re-export surface** so a
//! downstream import like
//! `aura_os_automation::resilience::{ToolRetryTracker, RetryDecision}`
//! cannot silently break when a submodule renames a symbol.

use super::{
    recover_orphans, OrphanRecoveryPlan, RetryDecision, TaskRetryTracker, ToolRetryTracker,
    ORPHAN_RECOVERY_REASON,
};

#[test]
fn re_export_surface_compiles_via_module_root() {
    let _ = ToolRetryTracker::new();
    let _ = TaskRetryTracker::new();
    let _ = RetryDecision::GiveUp;
    let _: Vec<OrphanRecoveryPlan> = recover_orphans(&[]);
    assert!(!ORPHAN_RECOVERY_REASON.is_empty());
}
