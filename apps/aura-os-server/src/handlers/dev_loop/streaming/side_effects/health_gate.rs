//! Workspace-health diff gate (opt-in via `AURA_HEALTH_GATE`). Reads
//! the baseline stashed at `task_started`, snapshots the workspace at
//! `task_completed`, and demotes the completion to `task_failed` when
//! the workspace regressed (more errors, or tests went from passing to
//! failing). The synthesised failure payload embeds the blocking reason
//! verbatim so the cross-crate harness classifier routes it through the
//! existing CompletionContract -> fresh-context retry path.

use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};

use super::super::super::health::{classify_delta, format_health_summary};
use super::super::super::signals::{health_gate_enabled, snapshot_workspace_health};
use super::super::super::types::LoopRetryState;
use super::SideEffectCtx;
use crate::handlers::projects_helpers::{
    resolve_agent_instance_workspace_path, server_can_inspect_agent_workspace,
};
use crate::state::AppState;

/// Verdict from the workspace-health gate when it decides to demote
/// a `task_completed` to `task_failed`. Carries everything
/// [`synthesize_health_gate_failure`] needs to stamp a fully-formed
/// failure payload (baseline/current summaries, elapsed wall-clock)
/// without re-reading any tracker state.
#[derive(Debug, Clone)]
struct HealthGateVerdict {
    /// Stable blocking reason string spliced verbatim into the demoted
    /// `task_failed` reason text so the harness classifier routes the
    /// failure through the existing CompletionContract -> fresh-context
    /// retry path.
    reason: &'static str,
    /// Human-readable summary of the workspace baseline captured at
    /// `task_started`. Used as the "before" half of the failure
    /// message.
    baseline_summary: String,
    /// Human-readable summary of the post-`task_completed` workspace
    /// snapshot. The "after" half of the failure message.
    current_summary: String,
    /// Wall-clock spent running the gate end-to-end (snapshot +
    /// classify). Exposed both for the warn-level log line and as a
    /// telemetry field on the synthesized payload.
    elapsed_ms: u64,
}

/// Apply the workspace-health gate to a freshly-enriched payload.
/// Returns `Some(demoted)` when the gate produced a blocking verdict
/// (the caller should swap the broadcast payload + event-type to
/// `task_failed`); returns `None` for every other path (event type
/// not `task_completed`, gate disabled, no baseline, no workspace
/// path, non-blocking verdict) so the caller forwards the original
/// `task_completed`.
pub(super) async fn maybe_demote_completed_to_failed(
    ctx: &SideEffectCtx<'_>,
    event_type: &str,
    task_id: Option<&str>,
    enriched: &serde_json::Value,
) -> Option<serde_json::Value> {
    if event_type != "task_completed" || !health_gate_enabled() {
        return None;
    }
    let task_uuid = TaskId::from_str(task_id?).ok()?;
    let verdict = maybe_run_health_gate(
        ctx.state,
        ctx.project_id,
        ctx.agent_instance_id,
        ctx.retry_state,
        task_uuid,
    )
    .await?;
    let synthetic = synthesize_health_gate_failure(enriched, &verdict);
    tracing::warn!(
        project_id = %ctx.project_id,
        agent_instance_id = %ctx.agent_instance_id,
        task_id = task_uuid.to_string(),
        reason = verdict.reason,
        elapsed_ms = verdict.elapsed_ms,
        "workspace-health gate demoted task_completed to task_failed"
    );
    Some(synthetic)
}

/// Run the workspace-health diff gate for `task_uuid`, returning
/// `Some(HealthGateVerdict)` only when the current workspace is in a
/// worse state than the baseline (more errors, or tests regressed
/// from passing to failing). Every other path (no baseline, no
/// workspace path, non-blocking verdict) returns `None` so the
/// caller emits the harness's original `task_completed`.
async fn maybe_run_health_gate(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    retry_state: &Arc<LoopRetryState>,
    task_uuid: TaskId,
) -> Option<HealthGateVerdict> {
    if !server_can_inspect_agent_workspace(state, &project_id, agent_instance_id).await {
        return None;
    }
    let baseline_entry = retry_state.health_baseline.get(task_uuid)?;
    let workspace_path =
        resolve_agent_instance_workspace_path(state, &project_id, Some(agent_instance_id)).await?;
    let start = Instant::now();
    let current_health = snapshot_workspace_health(workspace_path.clone()).await;
    let delta = classify_delta(&baseline_entry.health, &current_health);
    if !delta.verdict.blocks_task_done() {
        return None;
    }
    let baseline_summary = format_health_summary(&baseline_entry.health);
    let current_summary = format_health_summary(&current_health);
    Some(HealthGateVerdict {
        reason: delta.reason,
        baseline_summary,
        current_summary,
        elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Build a synthetic `task_failed` payload from the harness's
/// `task_completed` enriched event when the workspace-health gate
/// produced a blocking verdict.
///
/// The rendered `reason` / `message` text EMBEDS `verdict.reason` as
/// a literal substring so the cross-crate harness classifier picks
/// the failure up and routes it through the existing fresh-context
/// retry path. Original payload fields (task_id, session_id,
/// timestamps, ...) are preserved verbatim; the health-gate-specific
/// telemetry lands on top-level `health_gate_*` fields so the
/// dashboard can surface them.
fn synthesize_health_gate_failure(
    original: &serde_json::Value,
    verdict: &HealthGateVerdict,
) -> serde_json::Value {
    let mut payload = original.clone();
    let reason = format!(
        "{verdict_reason}: {baseline_fragment}; current snapshot: {current_fragment}. \
         Fix the red as part of this task or hand back with a status update.",
        verdict_reason = verdict.reason,
        baseline_fragment = verdict.baseline_summary,
        current_fragment = verdict.current_summary,
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("type".into(), serde_json::Value::from("task_failed"));
        object.insert("event_type".into(), serde_json::Value::from("task_failed"));
        object.insert("reason".into(), serde_json::Value::from(reason.clone()));
        object.insert("message".into(), serde_json::Value::from(reason));
        object.insert(
            "health_gate_reason".into(),
            serde_json::Value::from(verdict.reason),
        );
        object.insert(
            "health_gate_elapsed_ms".into(),
            serde_json::Value::from(verdict.elapsed_ms),
        );
        object.insert(
            "health_gate_baseline_summary".into(),
            serde_json::Value::from(verdict.baseline_summary.clone()),
        );
        object.insert(
            "health_gate_current_summary".into(),
            serde_json::Value::from(verdict.current_summary.clone()),
        );
    }
    payload
}

#[cfg(test)]
mod health_gate_synthesizer_tests {
    use super::*;
    use crate::handlers::dev_loop::health;

    /// The synthesised payload must preserve every non-overlay field
    /// from the original and stamp `type` / `event_type` /
    /// `health_gate_*` on top.
    #[test]
    fn synthesize_health_gate_failure_overlays_failure_fields_on_original() {
        let original = serde_json::json!({
            "type": "task_completed",
            "event_type": "task_completed",
            "task_id": "task-789",
            "session_id": "ses-456",
            "timestamp": "2026-05-19T22:00:00Z",
            "extra": "preserve me"
        });
        let verdict = HealthGateVerdict {
            reason: health::REASON_REGRESSED,
            baseline_summary: "workspace red at task start: 1 errors across 1 files \
                 (e.g. crates/zero-storage [E0277])"
                .to_string(),
            current_summary: "workspace red at task start: 4 errors across 1 files \
                 (e.g. crates/zero-storage [E0277 \u{00d7}2, E0432, E0425])"
                .to_string(),
            elapsed_ms: 2_345,
        };
        let synthetic = synthesize_health_gate_failure(&original, &verdict);
        assert_eq!(synthetic["type"], "task_failed");
        assert_eq!(synthetic["event_type"], "task_failed");
        assert_eq!(synthetic["task_id"], "task-789");
        assert_eq!(synthetic["session_id"], "ses-456");
        assert_eq!(synthetic["extra"], "preserve me");
        assert_eq!(synthetic["timestamp"], "2026-05-19T22:00:00Z");
        assert_eq!(
            synthetic["health_gate_reason"],
            "workspace_health_regressed"
        );
        assert_eq!(synthetic["health_gate_elapsed_ms"], 2_345);
        assert!(synthetic["health_gate_baseline_summary"]
            .as_str()
            .unwrap()
            .contains("crates/zero-storage"));
        assert!(synthetic["health_gate_current_summary"]
            .as_str()
            .unwrap()
            .contains("crates/zero-storage"));
        let reason = synthetic["reason"].as_str().expect("reason set");
        assert!(reason.contains("workspace_health_regressed"));
        assert!(reason.contains("crates/zero-storage"));
        assert_eq!(synthetic["message"], synthetic["reason"]);
    }

    /// The synthetic reason string must embed each blocking constant
    /// -- that is the contract the harness classifier relies on
    /// (`contains_workspace_health_blocking_reason` is a substring
    /// match against the rendered message).
    #[test]
    fn synthesize_health_gate_failure_embeds_blocking_reason_so_classifier_matches() {
        for blocking_reason in health::WORKSPACE_HEALTH_BLOCKING_REASONS {
            let verdict = HealthGateVerdict {
                reason: blocking_reason,
                baseline_summary: "baseline".to_string(),
                current_summary: "current".to_string(),
                elapsed_ms: 100,
            };
            let synthetic =
                synthesize_health_gate_failure(&serde_json::json!({"task_id": "t"}), &verdict);
            let reason = synthetic["reason"].as_str().expect("reason set");
            assert!(
                health::contains_workspace_health_blocking_reason(reason),
                "rendered reason {reason:?} must match the cross-crate \
                 substring predicate for blocking_reason={blocking_reason}",
            );
        }
    }

    /// Pin the `AURA_HEALTH_GATE` env-var parser at the integration
    /// boundary where the side-effects pipeline consumes it. The
    /// in-module parsing test inside `signals::health_snapshot`
    /// covers the truthy / falsy table exhaustively; this test only
    /// has to assert that the re-export the side-effects pipeline
    /// imports reflects changes to the underlying env var so a
    /// future signal-module refactor that breaks the re-export
    /// blows up here.
    #[test]
    fn health_gate_enabled_respects_env_var_parsing() {
        let key = "AURA_HEALTH_GATE";
        let original = std::env::var(key).ok();
        // SAFETY: env mutation is constrained to this test scope and
        // restored at the end.
        std::env::set_var(key, "1");
        assert!(health_gate_enabled());
        std::env::set_var(key, "yes");
        assert!(health_gate_enabled());
        std::env::set_var(key, "ON");
        assert!(health_gate_enabled());
        std::env::set_var(key, "false");
        assert!(!health_gate_enabled());
        std::env::set_var(key, "");
        assert!(!health_gate_enabled());
        std::env::remove_var(key);
        assert!(!health_gate_enabled());
        if let Some(value) = original {
            std::env::set_var(key, value);
        }
    }
}
