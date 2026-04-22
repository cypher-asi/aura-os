//! Detect tasks thrashing on context — summing `input_tokens` against
//! `output_tokens` across all `debug.llm_call` events, if the ratio
//! exceeds 100× the agent is almost certainly re-reading a huge
//! context without writing new output.

use std::collections::BTreeMap;

use crate::bundle::BundleView;
use crate::finding::{Finding, RemediationHint, Severity};
use crate::rules::helpers::{event_task_id_str, event_u64};

const RATIO_WARN: f64 = 100.0;
const MIN_INPUT_TOKENS: u64 = 1_000;

pub fn unbalanced_io(bundle: &BundleView) -> Vec<Finding> {
    let mut totals: BTreeMap<Option<String>, (u64, u64)> = BTreeMap::new();
    for event in &bundle.llm_calls {
        let input = token_count(event, "input_tokens");
        let output = token_count(event, "output_tokens");
        let key = event_task_id_str(event).map(|s| s.to_owned());
        let entry = totals.entry(key).or_default();
        entry.0 = entry.0.saturating_add(input);
        entry.1 = entry.1.saturating_add(output);
    }

    let mut findings = Vec::new();
    for (task_key, (input, output)) in totals {
        if input < MIN_INPUT_TOKENS {
            continue;
        }
        let ratio = input as f64 / output.max(1) as f64;
        if ratio > RATIO_WARN {
            findings.push(Finding {
                id: "unbalanced_io",
                severity: Severity::Warn,
                title: format!(
                    "input/output token ratio {ratio:.1}× (input={input}, output={output})"
                ),
                detail: "likely thrashing on context without making progress".to_owned(),
                task_id: task_key.as_deref().and_then(|s| s.parse().ok()),
                remediation: Some(RemediationHint::RetryWithSmallerScope {
                    reason: format!(
                        "input/output token ratio {ratio:.1}x indicates context thrash"
                    ),
                }),
            });
        }
    }
    findings
}

fn token_count(event: &serde_json::Value, key: &str) -> u64 {
    if let Some(v) = event_u64(event, key) {
        return v;
    }
    event
        .get("usage")
        .and_then(|u| u.get(key))
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::bundle_with;
    use serde_json::json;

    const TID_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    #[test]
    fn balanced_io_silent() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "task_id": TID_A,
                "input_tokens": 2_000,
                "output_tokens": 500
            }));
        });
        assert!(unbalanced_io(&bundle).is_empty());
    }

    #[test]
    fn extreme_ratio_warns() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "task_id": TID_A,
                "input_tokens": 50_000,
                "output_tokens": 100
            }));
        });
        let findings = unbalanced_io(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].title.contains("500"));
        assert!(matches!(
            &findings[0].remediation,
            Some(RemediationHint::RetryWithSmallerScope { reason })
                if reason.contains("context thrash")
        ));
    }

    #[test]
    fn zero_output_rounds_to_input_ratio() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "task_id": TID_A,
                "input_tokens": 10_000,
                "output_tokens": 0
            }));
        });
        let findings = unbalanced_io(&bundle);
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn below_min_input_is_silent() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "task_id": TID_A,
                "input_tokens": 200,
                "output_tokens": 0
            }));
        });
        assert!(unbalanced_io(&bundle).is_empty());
    }
}
