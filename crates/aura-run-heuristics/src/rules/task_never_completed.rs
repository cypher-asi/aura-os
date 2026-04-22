//! Cross-check `metadata.tasks` against `metadata.status`: if the
//! run has settled into any terminal status but a task still has
//! `ended_at == null`, that's a leak — the task either crashed with
//! no terminal event or the harness swallowed one.

use aura_loop_log_schema::RunStatus;

use crate::bundle::BundleView;
use crate::finding::{Finding, RemediationHint, Severity};

pub fn task_never_completed(bundle: &BundleView) -> Vec<Finding> {
    if matches!(bundle.metadata.status, RunStatus::Running) {
        return Vec::new();
    }
    let run_failed = matches!(bundle.metadata.status, RunStatus::Failed);
    let mut findings = Vec::new();
    for task in &bundle.metadata.tasks {
        if task.ended_at.is_some() {
            continue;
        }
        let task_id = task.task_id.parse::<aura_os_core::TaskId>().ok();
        // The rule only sees task metadata, not the originating write
        // event, so we can't know which path blew up. The orchestrator
        // is expected to enrich this from events before acting on it.
        let remediation = run_failed.then_some(RemediationHint::SplitWriteIntoSkeletonPlusAppends {
            path: "<unknown>".into(),
            suggested_chunk_bytes: 6000,
        });
        findings.push(Finding {
            id: "task_never_completed",
            severity: Severity::Error,
            title: format!("task {} did not finish cleanly", task.task_id),
            detail: format!(
                "run status is {:?} but the task has no ended_at timestamp; \
                 the harness likely crashed or dropped a task_completed event",
                bundle.metadata.status
            ),
            task_id,
            remediation,
        });
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::bundle_with;
    use aura_loop_log_schema::RunTaskSummary;
    use chrono::{TimeZone, Utc};

    #[test]
    fn running_status_does_not_report() {
        let bundle = bundle_with(|b| {
            b.metadata.status = RunStatus::Running;
            b.metadata.tasks.push(RunTaskSummary {
                task_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                spec_id: None,
                started_at: None,
                ended_at: None,
                status: None,
            });
        });
        assert!(task_never_completed(&bundle).is_empty());
    }

    #[test]
    fn completed_task_silent() {
        let bundle = bundle_with(|b| {
            b.metadata.status = RunStatus::Completed;
            b.metadata.tasks.push(RunTaskSummary {
                task_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                spec_id: None,
                started_at: None,
                ended_at: Some(Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()),
                status: Some("task_completed".to_owned()),
            });
        });
        assert!(task_never_completed(&bundle).is_empty());
    }

    #[test]
    fn failed_run_with_dangling_task_errors() {
        let bundle = bundle_with(|b| {
            b.metadata.status = RunStatus::Failed;
            b.metadata.tasks.push(RunTaskSummary {
                task_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                spec_id: None,
                started_at: None,
                ended_at: None,
                status: None,
            });
        });
        let findings = task_never_completed(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Error);
        assert!(findings[0].task_id.is_some());
        assert!(matches!(
            findings[0].remediation,
            Some(RemediationHint::SplitWriteIntoSkeletonPlusAppends { .. })
        ));
    }
}
