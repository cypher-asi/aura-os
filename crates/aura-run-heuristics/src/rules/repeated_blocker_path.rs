//! Surface the user's original pain point: the loop keeps re-attempting
//! the same blocked write because the harness doesn't yet dedupe
//! blocker reasons across iterations. Two or more `debug.blocker`
//! events with the same `path` (or same `message` when `path` is
//! null) count as a repetition worth flagging.

use std::collections::BTreeMap;

use crate::bundle::BundleView;
use crate::finding::{Finding, Severity};
use crate::rules::helpers::{event_str, event_task_id_str};

pub fn repeated_blocker_path(bundle: &BundleView) -> Vec<Finding> {
    let mut buckets: BTreeMap<(BlockerKeyKind, String), BlockerBucket> = BTreeMap::new();
    for event in &bundle.blockers {
        let (kind, key) = match (event_str(event, "path"), event_str(event, "message")) {
            (Some(path), _) if !path.is_empty() => (BlockerKeyKind::Path, path.to_owned()),
            (_, Some(msg)) if !msg.is_empty() => (BlockerKeyKind::Message, msg.to_owned()),
            _ => continue,
        };
        let bucket = buckets.entry((kind, key)).or_default();
        bucket.count += 1;
        if let Some(tid) = event_task_id_str(event) {
            if !bucket.task_ids.contains(&tid.to_owned()) {
                bucket.task_ids.push(tid.to_owned());
            }
        }
    }

    buckets
        .into_iter()
        .filter(|(_, b)| b.count >= 2)
        .map(|((kind, key), bucket)| Finding {
            id: "repeated_blocker_path",
            severity: Severity::Warn,
            title: format!(
                "repeated blocker on {} '{}' ({} times)",
                kind.label(),
                truncate(&key, 80),
                bucket.count
            ),
            detail: format!(
                "{} blocker events shared the same {}; task_ids: {}",
                bucket.count,
                kind.label(),
                if bucket.task_ids.is_empty() {
                    "<unknown>".to_owned()
                } else {
                    bucket.task_ids.join(", ")
                }
            ),
            task_id: None,
        })
        .collect()
}

#[derive(Default)]
struct BlockerBucket {
    count: u64,
    task_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum BlockerKeyKind {
    Path,
    Message,
}

impl BlockerKeyKind {
    fn label(self) -> &'static str {
        match self {
            BlockerKeyKind::Path => "path",
            BlockerKeyKind::Message => "message",
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_owned()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::bundle_with;
    use serde_json::json;

    #[test]
    fn flags_duplicate_paths() {
        let bundle = bundle_with(|b| {
            b.blockers.push(json!({
                "type": "debug.blocker",
                "path": "src/foo.rs",
                "task_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            }));
            b.blockers.push(json!({
                "type": "debug.blocker",
                "path": "src/foo.rs",
                "task_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            }));
        });
        let findings = repeated_blocker_path(&bundle);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].id, "repeated_blocker_path");
        assert_eq!(findings[0].severity, Severity::Warn);
        assert!(findings[0].title.contains("src/foo.rs"));
        assert!(findings[0].detail.contains("aaaaaaaa"));
        assert!(findings[0].detail.contains("bbbbbbbb"));
    }

    #[test]
    fn falls_back_to_message_when_path_missing() {
        let bundle = bundle_with(|b| {
            b.blockers.push(json!({
                "type": "debug.blocker",
                "message": "duplicate write attempt"
            }));
            b.blockers.push(json!({
                "type": "debug.blocker",
                "message": "duplicate write attempt"
            }));
        });
        let findings = repeated_blocker_path(&bundle);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].title.contains("duplicate write attempt"));
    }

    #[test]
    fn single_blocker_is_not_a_finding() {
        let bundle = bundle_with(|b| {
            b.blockers.push(json!({
                "type": "debug.blocker",
                "path": "src/foo.rs"
            }));
        });
        assert!(repeated_blocker_path(&bundle).is_empty());
    }

    #[test]
    fn different_paths_do_not_merge() {
        let bundle = bundle_with(|b| {
            b.blockers.push(json!({"type": "debug.blocker", "path": "src/a.rs"}));
            b.blockers.push(json!({"type": "debug.blocker", "path": "src/b.rs"}));
        });
        assert!(repeated_blocker_path(&bundle).is_empty());
    }
}
