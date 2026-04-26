//! Phase 7a — replay-based integration tests for the autonomous recovery pipeline.
//!
//! Reproduces the scenario the plan's `autonomous-dev-loop-resilience`
//! was designed for: a task-spec that asks the agent to generate the
//! full implementation of a specific file, the agent spends many
//! turns on `search_code` and `text_delta` narration, and then
//! `task_failed` with a reason string of the Phase 2b
//! `NeedsDecomposition` shape.
//!
//! The submodules each focus on one slice of the pipeline:
//!
//! * `bundle` — synthesises a run bundle on disk and asserts the
//!   `aura-run-heuristics` analyzer surfaces the expected
//!   `SplitWriteIntoSkeletonPlusAppends` finding.
//! * `classifiers` — tests for the failure-class detectors used by
//!   `try_remediate_task_failure` and the retry ladder.
//! * `gates` — completion / recovery / restart gate decision tests.
//! * `agent_stuck` — terminal "agent stuck" anti-waste signal.
//! * `preflight` — preflight detector for the canonical
//!   "generate the full implementation of …" description.
//!
//! NOTE (punted):
//!
//! * Invoking `try_remediate_task_failure` end-to-end requires a live
//!   `TaskService`, a `LoopLogWriter`, a `broadcast::Sender`, and a
//!   storage backend wired together. The `handlers::dev_loop::tests`
//!   module already exercises every branch of the decision logic
//!   against real helpers behind mocks; running it again here would
//!   duplicate that coverage without catching anything new.
//!
//! * The child-task prompt formatting produced by
//!   `spawn_skeleton_and_fill_children` is async and needs a
//!   `TaskService`; its pure contribution is the header line, and the
//!   Phase 5 unit test `header_differs_between_contexts` already pins
//!   down both `PostFailure` and `Preflight` wordings.

pub(crate) const PROJECT_ID: &str = "11111111-1111-4111-8111-111111111111";
pub(crate) const AGENT_INSTANCE_ID: &str = "22222222-2222-4222-8222-222222222222";
pub(crate) const TASK_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
pub(crate) const RUN_ID: &str = "20240101_000000_replay";

/// Path the simulated run kept trying to write. The concrete value
/// matters — the heuristic pipeline surfaces it verbatim as the
/// remediation target and Phase 3 feeds it into
/// `spawn_skeleton_and_fill_children`.
pub(crate) const BLOCKED_PATH: &str = "crates/foo/src/bar.rs";

/// Reason string of the Phase 2b `NeedsDecomposition` shape. The exact
/// wording is what the harness produces today; `classify_failure` only
/// cares that `"needs decomposition"` appears somewhere case-
/// insensitively.
pub(crate) const FAILURE_REASON: &str =
    "task reached implementation phase but no file operations completed — \
     needs decomposition (failed_paths=1, last_pending=Some(\"crates/foo/src/bar.rs\"))";

mod agent_stuck;
mod bundle;
mod classifiers;
mod gates;
mod preflight;
