#![cfg(test)]
//! Tiny helpers used by the per-rule unit tests. Constructs an
//! otherwise-empty `BundleView` with the caller populating whichever
//! event channel each test needs.

use aura_loop_log_schema::{RunCounters, RunMetadata, RunStatus};
use aura_os_core::{AgentInstanceId, ProjectId};
use chrono::{TimeZone, Utc};

use crate::bundle::BundleView;

pub(crate) fn empty_bundle() -> BundleView {
    let metadata = RunMetadata {
        run_id: "test_run".to_owned(),
        project_id: ProjectId::nil(),
        agent_instance_id: AgentInstanceId::nil(),
        started_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
        ended_at: None,
        status: RunStatus::Running,
        tasks: Vec::new(),
        spec_ids: Vec::new(),
        counters: RunCounters::default(),
    };
    BundleView {
        metadata,
        events: Vec::new(),
        llm_calls: Vec::new(),
        iterations: Vec::new(),
        blockers: Vec::new(),
        retries: Vec::new(),
    }
}

pub(crate) fn bundle_with<F: FnOnce(&mut BundleView)>(f: F) -> BundleView {
    let mut b = empty_bundle();
    f(&mut b);
    b
}
