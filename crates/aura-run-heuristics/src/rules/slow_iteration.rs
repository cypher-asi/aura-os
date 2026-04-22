//! Walk `debug.iteration` events and flag runs where the mean / p95
//! iteration latency is unhealthy. We emit at most one Warn per bundle
//! for the p95 breach, plus a separate Warn per any iteration that
//! individually exceeds 30_000 ms.

use crate::bundle::BundleView;
use crate::finding::{Finding, RemediationHint, Severity};
use crate::rules::helpers::{event_task_id, event_u64};

const SINGLE_ITER_WARN_MS: u64 = 30_000;
const P95_WARN_MS: u64 = 10_000;

pub fn slow_iteration(bundle: &BundleView) -> Vec<Finding> {
    let durations: Vec<u64> = bundle
        .iterations
        .iter()
        .filter_map(|e| event_u64(e, "duration_ms"))
        .collect();
    if durations.is_empty() {
        return Vec::new();
    }

    let mut findings = Vec::new();
    let mean = durations.iter().sum::<u64>() as f64 / durations.len() as f64;
    let p95 = percentile(&durations, 95.0);

    if p95 > P95_WARN_MS {
        findings.push(Finding {
            id: "slow_iteration",
            severity: Severity::Warn,
            title: format!(
                "iteration p95 {p95} ms (mean {mean:.0} ms) over {limit} ms limit",
                limit = P95_WARN_MS
            ),
            detail: format!(
                "{} iterations observed; mean={:.0} ms, p95={} ms",
                durations.len(),
                mean,
                p95
            ),
            task_id: None,
            remediation: Some(RemediationHint::NoAutoFix),
        });
    }

    for (idx, event) in bundle.iterations.iter().enumerate() {
        if let Some(dur) = event_u64(event, "duration_ms") {
            if dur > SINGLE_ITER_WARN_MS {
                findings.push(Finding {
                    id: "slow_iteration",
                    severity: Severity::Warn,
                    title: format!("iteration #{idx} took {dur} ms"),
                    detail: format!(
                        "single iteration over {SINGLE_ITER_WARN_MS} ms limit"
                    ),
                    task_id: event_task_id(event),
                    remediation: Some(RemediationHint::NoAutoFix),
                });
            }
        }
    }
    findings
}

/// Nearest-rank percentile on a small slice. Allocates a sorted copy —
/// the iteration counts we deal with are well under a few thousand
/// per run so avoiding a sort isn't worth the complexity.
fn percentile(values: &[u64], pct: f64) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted: Vec<u64> = values.to_vec();
    sorted.sort_unstable();
    let rank = ((pct / 100.0) * sorted.len() as f64).ceil() as usize;
    let idx = rank.saturating_sub(1).min(sorted.len() - 1);
    sorted[idx]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::bundle_with;
    use serde_json::json;

    fn iter(duration_ms: u64) -> serde_json::Value {
        json!({"type": "debug.iteration", "duration_ms": duration_ms})
    }

    #[test]
    fn empty_iterations_is_silent() {
        let bundle = bundle_with(|_| {});
        assert!(slow_iteration(&bundle).is_empty());
    }

    #[test]
    fn fast_iterations_silent() {
        let bundle = bundle_with(|b| {
            for _ in 0..20 {
                b.iterations.push(iter(100));
            }
        });
        assert!(slow_iteration(&bundle).is_empty());
    }

    #[test]
    fn p95_breach_warns_once() {
        // 10 values with the top value above 10_000 ms; nearest-rank
        // p95 lands on the max entry for small sample sizes.
        let bundle = bundle_with(|b| {
            for _ in 0..9 {
                b.iterations.push(iter(1_000));
            }
            b.iterations.push(iter(15_000));
        });
        let findings = slow_iteration(&bundle);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].title.contains("p95"));
        assert!(matches!(
            findings[0].remediation,
            Some(RemediationHint::NoAutoFix)
        ));
    }

    #[test]
    fn single_iteration_over_30s_warns() {
        let bundle = bundle_with(|b| {
            b.iterations.push(iter(40_000));
        });
        let findings = slow_iteration(&bundle);
        assert_eq!(findings.len(), 2);
        let offending = findings
            .iter()
            .find(|f| f.title.contains("iteration #0"))
            .unwrap();
        assert_eq!(offending.severity, Severity::Warn);
    }

    #[test]
    fn percentile_nearest_rank_correct() {
        let v = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        assert_eq!(percentile(&v, 95.0), 10);
        assert_eq!(percentile(&v, 50.0), 5);
    }
}
