//! Surface `debug.retry_miss` events emitted by `aura-os-server`'s
//! dev loop when a task failure text *looks* transient but
//! [`classify_infra_failure`] returned `None`, so the task died
//! terminally instead of retrying.
//!
//! This is a classifier-gap canary. One miss on its own often means
//! "new provider wording", several from the same task means the
//! classifier is definitely missing a pattern. Rule output points the
//! reader at the exact reason string so they can decide whether to
//! add a new `InfraFailureClass` branch, widen an existing keyword
//! list, or intentionally leave the failure as terminal.
//!
//! The rule deliberately does NOT retry anything or recommend a fix
//! automatically — classification is a policy decision that belongs
//! in `aura-os-server`, not in a read-only heuristics pass.

use std::collections::BTreeMap;

use crate::bundle::BundleView;
use crate::finding::{Finding, RemediationHint, Severity};
use crate::rules::helpers::{event_str, event_task_id_str};

/// `type` value written by `dev_loop::looks_like_unclassified_transient`
/// alongside each missed classification.
const RETRY_MISS_TYPE: &str = "debug.retry_miss";

/// Threshold for escalating from Warn to Error: more than this many
/// misses on a single task in one run means the classifier gap is
/// reproducibly hitting that task, not a one-off quirk.
const MULTI_MISS_ERROR: u64 = 2;

pub fn unclassified_retry_miss(bundle: &BundleView) -> Vec<Finding> {
    let mut buckets: BTreeMap<Option<String>, MissBucket> = BTreeMap::new();
    for event in &bundle.retries {
        if event_str(event, "type") != Some(RETRY_MISS_TYPE) {
            continue;
        }
        let key = event_task_id_str(event).map(|s| s.to_owned());
        let bucket = buckets.entry(key).or_default();
        bucket.count += 1;
        let reason = event_str(event, "reason").unwrap_or("<unknown>").to_owned();
        *bucket.reasons.entry(reason).or_insert(0) += 1;
    }

    let mut out = Vec::new();
    for (task_key, bucket) in buckets {
        let severity = if bucket.count > MULTI_MISS_ERROR {
            Severity::Error
        } else {
            Severity::Warn
        };
        let task_id = task_key.as_deref().and_then(|s| s.parse().ok());
        let reason_dist = format_reasons(&bucket.reasons);
        out.push(Finding {
            id: "unclassified_retry_miss",
            severity,
            title: format!(
                "{} task_failed reason{} looked transient but were not classified for retry",
                bucket.count,
                if bucket.count == 1 { "" } else { "s" },
            ),
            detail: format!(
                "classify_infra_failure returned None for these reasons, so the dev loop treated them as terminal. Consider extending the classifier. Observed: {reason_dist}"
            ),
            task_id,
            remediation: Some(RemediationHint::NoAutoFix),
        });
    }
    out
}

#[derive(Default)]
struct MissBucket {
    count: u64,
    reasons: BTreeMap<String, u64>,
}

fn format_reasons(reasons: &BTreeMap<String, u64>) -> String {
    if reasons.is_empty() {
        return "<none>".to_owned();
    }
    let mut parts: Vec<(String, u64)> = reasons.iter().map(|(k, v)| (k.clone(), *v)).collect();
    parts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    parts
        .into_iter()
        .map(|(r, c)| format!("{r}={c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::bundle_with;
    use serde_json::json;

    const TID_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const TID_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    fn retry_miss(task_id: &str, reason: &str) -> serde_json::Value {
        json!({
            "type": "debug.retry_miss",
            "task_id": task_id,
            "reason": reason,
            "hint": "looks_like_unclassified_transient",
        })
    }

    fn retry(task_id: &str, reason: &str) -> serde_json::Value {
        json!({
            "type": "debug.retry",
            "task_id": task_id,
            "reason": reason,
        })
    }

    #[test]
    fn empty_bundle_yields_no_findings() {
        let bundle = bundle_with(|_| {});
        assert!(unclassified_retry_miss(&bundle).is_empty());
    }

    #[test]
    fn plain_debug_retry_events_are_ignored() {
        // Only `debug.retry_miss` contributes — the rule must not
        // double-count against the regular retry telemetry.
        let bundle = bundle_with(|b| {
            for _ in 0..5 {
                b.retries.push(retry(TID_A, "429"));
            }
        });
        assert!(unclassified_retry_miss(&bundle).is_empty());
    }

    #[test]
    fn single_miss_warns() {
        let bundle = bundle_with(|b| {
            b.retries
                .push(retry_miss(TID_A, "socket hang up from anthropic proxy"));
        });
        let findings = unclassified_retry_miss(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].title.contains("1 task_failed reason"));
        assert!(findings[0].detail.contains("socket hang up"));
    }

    #[test]
    fn three_or_more_misses_on_one_task_error() {
        let bundle = bundle_with(|b| {
            for i in 0..3 {
                b.retries
                    .push(retry_miss(TID_A, &format!("stream reset #{i}")));
            }
        });
        let findings = unclassified_retry_miss(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Error);
        assert!(findings[0].title.contains("3 task_failed reason"));
    }

    #[test]
    fn separate_tasks_bucket_independently() {
        let bundle = bundle_with(|b| {
            b.retries.push(retry_miss(TID_A, "dns failure"));
            b.retries.push(retry_miss(TID_B, "upstream connect error"));
        });
        let findings = unclassified_retry_miss(&bundle);
        assert_eq!(findings.len(), 2);
        for f in findings {
            assert_eq!(f.severity, Severity::Warn);
        }
    }
}
