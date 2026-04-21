//! Group `debug.retry` events by task and flag runs where retries
//! dominate real progress. Three thresholds:
//!   * ≥3 retries on a task                    → Warn
//!   * sum(`wait_ms`) > 30_000 on a task        → Warn
//!   * any `reason` repeats ≥5 times on a task  → Error (sustained 429)

use std::collections::BTreeMap;

use crate::bundle::BundleView;
use crate::finding::{Finding, Severity};
use crate::rules::helpers::{event_str, event_task_id_str, event_u64};

const RETRY_COUNT_WARN: u64 = 3;
const RETRY_WAIT_MS_WARN: u64 = 30_000;
const SAME_REASON_ERROR: u64 = 5;

pub fn high_retry_density(bundle: &BundleView) -> Vec<Finding> {
    let mut buckets: BTreeMap<Option<String>, RetryBucket> = BTreeMap::new();
    for event in &bundle.retries {
        let key = event_task_id_str(event).map(|s| s.to_owned());
        let bucket = buckets.entry(key).or_default();
        bucket.count += 1;
        bucket.total_wait_ms = bucket
            .total_wait_ms
            .saturating_add(event_u64(event, "wait_ms").unwrap_or(0));
        let reason = event_str(event, "reason").unwrap_or("unknown").to_owned();
        *bucket.reasons.entry(reason).or_insert(0) += 1;
    }

    let mut out = Vec::new();
    for (task_key, bucket) in buckets {
        let reason_dist = format_reasons(&bucket.reasons);
        let worst = bucket.worst_reason();
        let task_id = task_key.as_deref().and_then(|s| s.parse().ok());

        if let Some((reason, count)) = worst {
            if *count >= SAME_REASON_ERROR {
                out.push(Finding {
                    id: "high_retry_density",
                    severity: Severity::Error,
                    title: format!(
                        "sustained retries for reason '{reason}' ({count} repeats)"
                    ),
                    detail: format!(
                        "task saw {count} retries for the same reason; distribution: {reason_dist}"
                    ),
                    task_id,
                });
                continue;
            }
        }

        if bucket.count >= RETRY_COUNT_WARN || bucket.total_wait_ms > RETRY_WAIT_MS_WARN {
            out.push(Finding {
                id: "high_retry_density",
                severity: Severity::Warn,
                title: format!(
                    "{} retries ({} ms total wait) for task",
                    bucket.count, bucket.total_wait_ms
                ),
                detail: format!("reasons: {reason_dist}"),
                task_id,
            });
        }
    }
    out
}

#[derive(Default)]
struct RetryBucket {
    count: u64,
    total_wait_ms: u64,
    reasons: BTreeMap<String, u64>,
}

impl RetryBucket {
    fn worst_reason(&self) -> Option<(&String, &u64)> {
        self.reasons.iter().max_by_key(|(_, c)| *c)
    }
}

fn format_reasons(reasons: &BTreeMap<String, u64>) -> String {
    if reasons.is_empty() {
        return "<none>".to_owned();
    }
    let mut parts: Vec<(String, u64)> =
        reasons.iter().map(|(k, v)| (k.clone(), *v)).collect();
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

    fn retry(task_id: &str, reason: &str, wait_ms: u64) -> serde_json::Value {
        json!({
            "type": "debug.retry",
            "task_id": task_id,
            "reason": reason,
            "wait_ms": wait_ms,
        })
    }

    #[test]
    fn empty_bundle_yields_no_findings() {
        let bundle = bundle_with(|_| {});
        assert!(high_retry_density(&bundle).is_empty());
    }

    #[test]
    fn three_retries_on_same_task_warn() {
        let bundle = bundle_with(|b| {
            b.retries.push(retry(TID_A, "429", 100));
            b.retries.push(retry(TID_A, "529", 200));
            b.retries.push(retry(TID_A, "timeout", 300));
        });
        let findings = high_retry_density(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].detail.contains("429=1"));
    }

    #[test]
    fn five_repeats_of_same_reason_error() {
        let bundle = bundle_with(|b| {
            for _ in 0..5 {
                b.retries.push(retry(TID_A, "429", 100));
            }
        });
        let findings = high_retry_density(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Error);
        assert!(findings[0].title.contains("429"));
    }

    #[test]
    fn huge_wait_warns_even_with_two_retries() {
        let bundle = bundle_with(|b| {
            b.retries.push(retry(TID_A, "529", 20_000));
            b.retries.push(retry(TID_A, "529", 20_000));
        });
        let findings = high_retry_density(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].title.contains("40000 ms"));
    }

    #[test]
    fn single_retry_is_silent() {
        let bundle = bundle_with(|b| {
            b.retries.push(retry(TID_A, "429", 100));
        });
        assert!(high_retry_density(&bundle).is_empty());
    }
}
