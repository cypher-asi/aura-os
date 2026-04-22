//! Flag individual LLM calls that dominate the run's token budget.
//! A call above 60_000 combined tokens is Warn; above 150_000 it's
//! Error. Model name is included so users can correlate with pricing.

use crate::bundle::BundleView;
use crate::finding::{Finding, RemediationHint, Severity};
use crate::rules::helpers::{event_str, event_task_id, event_u64};

const WARN_TOTAL_TOKENS: u64 = 60_000;
const ERROR_TOTAL_TOKENS: u64 = 150_000;

pub fn token_hog_llm_call(bundle: &BundleView) -> Vec<Finding> {
    let mut findings = Vec::new();
    for (idx, event) in bundle.llm_calls.iter().enumerate() {
        let input = token_count(event, "input_tokens");
        let output = token_count(event, "output_tokens");
        let total = input.saturating_add(output);
        if total <= WARN_TOTAL_TOKENS {
            continue;
        }
        let severity = if total > ERROR_TOTAL_TOKENS {
            Severity::Error
        } else {
            Severity::Warn
        };
        let model = event_str(event, "model").unwrap_or("<unknown>");
        findings.push(Finding {
            id: "token_hog_llm_call",
            severity,
            title: format!("llm_call #{idx} on '{model}' used {total} tokens"),
            detail: format!("input={input} tokens, output={output} tokens, total={total} tokens"),
            task_id: event_task_id(event),
            remediation: Some(RemediationHint::RetryWithSmallerScope {
                reason: format!("single LLM call used {total} tokens"),
            }),
        });
    }
    findings
}

/// Tokens live either at the top level of the event (`input_tokens`)
/// or under a nested `usage` object (matching how the harness mirrors
/// provider responses). Check both.
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

    #[test]
    fn call_under_threshold_silent() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "model": "gpt-5.4",
                "input_tokens": 1000,
                "output_tokens": 500
            }));
        });
        assert!(token_hog_llm_call(&bundle).is_empty());
    }

    #[test]
    fn warn_above_60k() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "model": "claude-4.6-sonnet",
                "input_tokens": 50_000,
                "output_tokens": 15_000
            }));
        });
        let findings = token_hog_llm_call(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].title.contains("claude-4.6-sonnet"));
        assert!(findings[0].title.contains("65000"));
        assert!(matches!(
            &findings[0].remediation,
            Some(RemediationHint::RetryWithSmallerScope { reason })
                if reason.contains("65000")
        ));
    }

    #[test]
    fn error_above_150k() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "model": "claude-opus-4-7",
                "input_tokens": 180_000,
                "output_tokens": 5_000
            }));
        });
        let findings = token_hog_llm_call(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Error);
    }

    #[test]
    fn reads_from_usage_nested_object() {
        let bundle = bundle_with(|b| {
            b.llm_calls.push(json!({
                "type": "debug.llm_call",
                "model": "gpt-5.4",
                "usage": { "input_tokens": 70_000, "output_tokens": 0 }
            }));
        });
        let findings = token_hog_llm_call(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
    }
}
