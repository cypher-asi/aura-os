//! Walk `debug.iteration` events in order; when three or more
//! consecutive iterations on the same task report `tool_calls == 0`
//! the LLM is almost certainly stuck reasoning without acting and
//! the loop should be cut short. We emit at most one Warn per
//! qualifying run of consecutive iterations.

use aura_os_core::TaskId;

use crate::bundle::BundleView;
use crate::finding::{Finding, Severity};
use crate::rules::helpers::{event_task_id, event_u64};

const MIN_CONSECUTIVE: u64 = 3;

pub fn zero_tool_calls_in_turn(bundle: &BundleView) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut run_task: Option<TaskId> = None;
    let mut run_start: usize = 0;
    let mut run_count: u64 = 0;

    for (idx, event) in bundle.iterations.iter().enumerate() {
        let tool_calls = event_u64(event, "tool_calls").unwrap_or(0);
        let task = event_task_id(event);
        if tool_calls == 0 && task == run_task && run_count > 0 {
            run_count += 1;
            continue;
        }
        if run_count >= MIN_CONSECUTIVE {
            findings.push(build_finding(run_task, run_start, run_count));
        }
        if tool_calls == 0 {
            run_task = task;
            run_start = idx;
            run_count = 1;
        } else {
            run_task = None;
            run_count = 0;
        }
    }
    if run_count >= MIN_CONSECUTIVE {
        findings.push(build_finding(run_task, run_start, run_count));
    }
    findings
}

fn build_finding(task_id: Option<TaskId>, start_idx: usize, count: u64) -> Finding {
    Finding {
        id: "zero_tool_calls_in_turn",
        severity: Severity::Warn,
        title: format!(
            "{count} consecutive iterations with zero tool calls (starting at iteration #{start_idx})"
        ),
        detail: "likely LLM stuck reasoning without acting — consider interrupting or \
                 reshaping the prompt"
            .to_owned(),
        task_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::bundle_with;
    use serde_json::json;

    const TID_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const TID_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    fn iter(task: &str, tool_calls: u64) -> serde_json::Value {
        json!({"type": "debug.iteration", "task_id": task, "tool_calls": tool_calls})
    }

    #[test]
    fn three_consecutive_zero_warns() {
        let bundle = bundle_with(|b| {
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
        });
        let findings = zero_tool_calls_in_turn(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].task_id.is_some());
    }

    #[test]
    fn two_consecutive_zero_silent() {
        let bundle = bundle_with(|b| {
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 1));
        });
        assert!(zero_tool_calls_in_turn(&bundle).is_empty());
    }

    #[test]
    fn non_zero_between_resets_run() {
        let bundle = bundle_with(|b| {
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 1));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
        });
        assert!(zero_tool_calls_in_turn(&bundle).is_empty());
    }

    #[test]
    fn task_switch_resets_run() {
        let bundle = bundle_with(|b| {
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_B, 0));
        });
        assert!(zero_tool_calls_in_turn(&bundle).is_empty());
    }

    #[test]
    fn run_at_end_of_list_emits_finding() {
        let bundle = bundle_with(|b| {
            b.iterations.push(iter(TID_A, 2));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
            b.iterations.push(iter(TID_A, 0));
        });
        let findings = zero_tool_calls_in_turn(&bundle);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].title.contains("4 consecutive"));
    }
}
