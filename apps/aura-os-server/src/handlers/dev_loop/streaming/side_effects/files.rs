//! Cross-turn `assistant_message_end.files_changed` accumulation: keep one per-path summary in the cache with line counts summed across turns and Create/Modify/Delete kinds collapsed to a single net-effect per file.

use aura_os_core::ProjectId;
use aura_os_storage::StorageTaskFileChangeSummary;

use super::common::parse_task_key;
use crate::state::AppState;

/// Drain `assistant_message_end.files_changed` into the per-task cache.
///
/// Closes the long-standing "Lines = 0" dashboard gap. The cache field
/// has documented `Populated from … assistant_message_end` semantics
/// since the dev-loop refactor, but no production code path was
/// actually wiring the event payload into the cache — leaving
/// `cached.files_changed` always-empty and so `tasks.files_changed`
/// always-empty too.
///
/// Reads the protocol-typed `created` / `modified` / `deleted` arrays
/// for the file list, then joins per-path against the `diffs` array
/// (which the harness populates from per-tool line counts) to fill
/// `lines_added` / `lines_removed` on the persisted summary. Paths
/// without a `diffs` entry fall through to 0 — that's the "unknown"
/// signal the dashboard should treat as missing data, not as a real
/// zero-line change.
///
/// Cross-turn merge: the harness's `AgentLoopResult.file_changes` is
/// per-turn, so each `assistant_message_end` carries only that turn's
/// mutations. Multi-turn tasks (the common case in the dev loop) need
/// their per-turn summaries combined into a single net-effect view per
/// path, mirroring the within-turn collapse rules aura-agent already
/// enforces in `record_file_change`. Without this, a task that edits
/// `lib.rs` in turn 1 and `main.rs` in turn 2 would persist only the
/// turn-2 change and silently drop turn 1.
pub(super) async fn record_files_changed(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let Some(files) = event.get("files_changed") else {
        return;
    };
    let incoming = build_files_changed_summary(files);
    if incoming.is_empty() {
        return;
    }

    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    for change in incoming {
        merge_file_change(&mut entry.files_changed, change);
    }
}

/// Merge a freshly-arrived per-path summary into the existing cache
/// vector with the same kind-collapse semantics aura-agent applies
/// within a single turn (see `aura_agent::AgentLoopResult::record_file_change`).
///
/// Line counts always sum across merges (`saturating_add` guards the
/// pathological overflow case). The kind transition table:
///
/// | existing | incoming | result    |
/// |----------|----------|-----------|
/// | Create   | Modify   | Create    |
/// | Create   | Delete   | (dropped) |
/// | Modify   | Modify   | Modify    |
/// | Modify   | Delete   | Delete    |
/// | Delete   | Create   | Modify    |
/// | Delete   | Modify   | Modify    |
/// | otherwise (same/unknown) | (incoming kind wins) |
///
/// Create→Delete drops the entry entirely (the file existed only
/// transiently across the merged turns) and the accumulated line
/// counts go with it — matches the within-turn behavior so a file
/// that's created in turn 1 and deleted in turn 3 doesn't pollute
/// the dashboard with a phantom line count.
fn merge_file_change(
    target: &mut Vec<StorageTaskFileChangeSummary>,
    incoming: StorageTaskFileChangeSummary,
) {
    let Some(idx) = target.iter().position(|c| c.path == incoming.path) else {
        target.push(incoming);
        return;
    };
    let collapsed = collapse_op(target[idx].op.as_str(), incoming.op.as_str());
    if collapsed.is_none() {
        // Create → Delete: net effect is "no file"; drop the entry
        // entirely along with its accumulated counts.
        target.swap_remove(idx);
        return;
    }
    target[idx].lines_added = target[idx].lines_added.saturating_add(incoming.lines_added);
    target[idx].lines_removed = target[idx]
        .lines_removed
        .saturating_add(incoming.lines_removed);
    if let Some(op) = collapsed {
        target[idx].op = op.to_string();
    }
}

/// Decide the post-merge `op` value for a path that already has an
/// entry. Returns `None` when the merge net-effect is "no file"
/// (`Create` followed by `Delete`); the caller drops the entry in
/// that case.
fn collapse_op(existing: &str, incoming: &str) -> Option<&'static str> {
    match (existing, incoming) {
        ("create", "modify") => Some("create"),
        ("create", "delete") => None,
        ("modify", "modify") => Some("modify"),
        ("modify", "delete") => Some("delete"),
        ("delete", "create") => Some("modify"),
        ("delete", "modify") => Some("modify"),
        ("create", "create") => Some("create"),
        ("delete", "delete") => Some("delete"),
        // Any unrecognized op string falls through to the incoming
        // value, matching the within-turn fallback in aura-agent.
        (_, "create") => Some("create"),
        (_, "modify") => Some("modify"),
        (_, "delete") => Some("delete"),
        _ => Some("modify"),
    }
}

/// Pure conversion from a `files_changed` JSON payload (as emitted on
/// `assistant_message_end`) to the typed summary the cache stores.
///
/// Joins per-path against the `diffs` array (sent by the harness for
/// tools that compute a real line diff — currently `edit_file`) to fill
/// `lines_added` / `lines_removed`. Paths without a matching diff entry
/// keep counts at 0; consumers must read 0 as "unknown" rather than
/// "no change".
fn build_files_changed_summary(files: &serde_json::Value) -> Vec<StorageTaskFileChangeSummary> {
    let lookup_lines = |path: &str| -> (u32, u32) {
        let Some(diffs) = files.get("diffs").and_then(|v| v.as_array()) else {
            return (0, 0);
        };
        for diff in diffs {
            if diff.get("path").and_then(|v| v.as_str()) == Some(path) {
                let added = diff
                    .get("lines_added")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                let removed = diff
                    .get("lines_removed")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                return (
                    u32::try_from(added).unwrap_or(u32::MAX),
                    u32::try_from(removed).unwrap_or(u32::MAX),
                );
            }
        }
        (0, 0)
    };

    let mut summary: Vec<StorageTaskFileChangeSummary> = Vec::new();
    for (op, field) in [
        ("create", "created"),
        ("modify", "modified"),
        ("delete", "deleted"),
    ] {
        if let Some(paths) = files.get(field).and_then(|v| v.as_array()) {
            for path in paths.iter().filter_map(|v| v.as_str()) {
                let (lines_added, lines_removed) = lookup_lines(path);
                summary.push(StorageTaskFileChangeSummary {
                    op: op.to_string(),
                    path: path.to_string(),
                    lines_added,
                    lines_removed,
                });
            }
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::{build_files_changed_summary, collapse_op, merge_file_change};
    use aura_os_storage::StorageTaskFileChangeSummary;
    use serde_json::json;

    fn s(path: &str, op: &str, added: u32, removed: u32) -> StorageTaskFileChangeSummary {
        StorageTaskFileChangeSummary {
            op: op.to_string(),
            path: path.to_string(),
            lines_added: added,
            lines_removed: removed,
        }
    }

    #[test]
    fn build_files_changed_summary_groups_paths_by_op() {
        let files = json!({
            "created": ["src/new.rs"],
            "modified": ["src/lib.rs"],
            "deleted": ["src/old.rs"],
        });
        let summary = build_files_changed_summary(&files);
        assert_eq!(summary.len(), 3);
        assert_eq!(summary[0].op, "create");
        assert_eq!(summary[0].path, "src/new.rs");
        assert_eq!(summary[1].op, "modify");
        assert_eq!(summary[2].op, "delete");
        // No diffs supplied -> counts default to 0 across the board.
        assert!(summary.iter().all(|s| s.lines_added == 0));
        assert!(summary.iter().all(|s| s.lines_removed == 0));
    }

    #[test]
    fn build_files_changed_summary_joins_diffs_by_path() {
        let files = json!({
            "created": [],
            "modified": ["src/lib.rs", "src/main.rs"],
            "deleted": [],
            "diffs": [
                {"path": "src/lib.rs", "lines_added": 12, "lines_removed": 3},
                // src/main.rs intentionally absent — exercises the
                // "unknown" / 0-fallback branch.
            ],
        });
        let summary = build_files_changed_summary(&files);
        assert_eq!(summary.len(), 2);

        let lib = summary.iter().find(|s| s.path == "src/lib.rs").unwrap();
        assert_eq!(lib.lines_added, 12);
        assert_eq!(lib.lines_removed, 3);

        let main = summary.iter().find(|s| s.path == "src/main.rs").unwrap();
        assert_eq!(main.lines_added, 0);
        assert_eq!(main.lines_removed, 0);
    }

    #[test]
    fn build_files_changed_summary_returns_empty_when_no_paths() {
        let files = json!({
            "created": [],
            "modified": [],
            "deleted": [],
        });
        assert!(build_files_changed_summary(&files).is_empty());
    }

    #[test]
    fn build_files_changed_summary_clamps_pathological_line_counts() {
        let files = json!({
            "modified": ["x"],
            "diffs": [
                // u32::MAX + 1 — out-of-range u32 should clamp, not panic.
                {"path": "x", "lines_added": 4_294_967_296u64, "lines_removed": 0},
            ],
        });
        let summary = build_files_changed_summary(&files);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].lines_added, u32::MAX);
        assert_eq!(summary[0].lines_removed, 0);
    }

    // ====================================================================
    // collapse_op — kind-transition table (mirrors aura_agent's within-turn
    // record_file_change so cross-turn merges in the cache stay consistent
    // with the harness's net-effect semantics).
    // ====================================================================

    #[test]
    fn collapse_op_create_then_modify_keeps_create() {
        assert_eq!(collapse_op("create", "modify"), Some("create"));
    }

    #[test]
    fn collapse_op_create_then_delete_drops_entry() {
        assert_eq!(collapse_op("create", "delete"), None);
    }

    #[test]
    fn collapse_op_modify_then_modify_stays_modify() {
        assert_eq!(collapse_op("modify", "modify"), Some("modify"));
    }

    #[test]
    fn collapse_op_modify_then_delete_becomes_delete() {
        assert_eq!(collapse_op("modify", "delete"), Some("delete"));
    }

    #[test]
    fn collapse_op_delete_then_create_becomes_modify() {
        // The file existed before the turn, was deleted, then re-created
        // with potentially different content — net effect is a modify
        // (matches aura_agent::record_file_change).
        assert_eq!(collapse_op("delete", "create"), Some("modify"));
    }

    #[test]
    fn collapse_op_delete_then_modify_becomes_modify() {
        assert_eq!(collapse_op("delete", "modify"), Some("modify"));
    }

    #[test]
    fn collapse_op_create_then_create_stays_create() {
        // Pathological idempotent case (shouldn't happen with a sane
        // harness) but the merge must still be deterministic.
        assert_eq!(collapse_op("create", "create"), Some("create"));
    }

    #[test]
    fn collapse_op_delete_then_delete_stays_delete() {
        assert_eq!(collapse_op("delete", "delete"), Some("delete"));
    }

    #[test]
    fn collapse_op_unknown_existing_falls_through_to_incoming() {
        // Defensive fallback: if an upstream contract drift ever
        // serialised an unrecognised existing op, take the incoming
        // value rather than panicking.
        assert_eq!(collapse_op("rename", "modify"), Some("modify"));
        assert_eq!(collapse_op("rename", "create"), Some("create"));
        assert_eq!(collapse_op("rename", "delete"), Some("delete"));
    }

    #[test]
    fn collapse_op_unknown_pair_defaults_to_modify() {
        // Both ends unrecognised — pick the safest non-destructive
        // bucket so the row still surfaces in the dashboard.
        assert_eq!(collapse_op("rename", "rename"), Some("modify"));
    }

    // ====================================================================
    // merge_file_change — applies collapse_op + sums lines on a Vec target.
    // ====================================================================

    #[test]
    fn merge_file_change_inserts_new_path() {
        let mut target = vec![s("src/a.rs", "modify", 1, 1)];
        merge_file_change(&mut target, s("src/b.rs", "create", 5, 0));
        assert_eq!(target.len(), 2);
        let b = target.iter().find(|c| c.path == "src/b.rs").unwrap();
        assert_eq!(b.op, "create");
        assert_eq!(b.lines_added, 5);
    }

    #[test]
    fn merge_file_change_sums_line_counts_on_existing_path() {
        let mut target = vec![s("src/lib.rs", "modify", 10, 2)];
        merge_file_change(&mut target, s("src/lib.rs", "modify", 5, 3));
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].lines_added, 15);
        assert_eq!(target[0].lines_removed, 5);
    }

    #[test]
    fn merge_file_change_create_then_delete_drops_entry_and_counts() {
        let mut target = vec![
            s("src/keep.rs", "modify", 1, 1),
            s("src/temp.rs", "create", 100, 0),
        ];
        merge_file_change(&mut target, s("src/temp.rs", "delete", 0, 0));
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].path, "src/keep.rs");
    }

    #[test]
    fn merge_file_change_create_then_modify_preserves_create_kind() {
        let mut target = vec![s("src/new.rs", "create", 7, 0)];
        merge_file_change(&mut target, s("src/new.rs", "modify", 3, 1));
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].op, "create");
        assert_eq!(target[0].lines_added, 10);
        assert_eq!(target[0].lines_removed, 1);
    }

    #[test]
    fn merge_file_change_clamps_at_u32_max() {
        let mut target = vec![s("x", "modify", u32::MAX - 1, 0)];
        merge_file_change(&mut target, s("x", "modify", 5, 0));
        assert_eq!(target[0].lines_added, u32::MAX);
    }

    // ====================================================================
    // Regression test for the multi-turn merge bug — the original case
    // that motivated the merge-not-overwrite redesign.
    // ====================================================================

    #[test]
    fn merge_preserves_paths_across_simulated_turns() {
        // Turn 1: edits src/lib.rs (+5/-2)
        // Turn 2: edits src/main.rs (+10/-0)
        // Turn 3: re-edits src/lib.rs (+3/-1) and creates src/new.rs (+8/-0)
        // Final cache must show all three paths with summed line counts —
        // the original overwrite-on-each-call implementation only kept
        // the last turn's payload.
        let mut target: Vec<StorageTaskFileChangeSummary> = Vec::new();

        merge_file_change(&mut target, s("src/lib.rs", "modify", 5, 2));
        merge_file_change(&mut target, s("src/main.rs", "modify", 10, 0));
        merge_file_change(&mut target, s("src/lib.rs", "modify", 3, 1));
        merge_file_change(&mut target, s("src/new.rs", "create", 8, 0));

        assert_eq!(target.len(), 3, "all three paths must survive merging");

        let lib = target.iter().find(|c| c.path == "src/lib.rs").unwrap();
        assert_eq!(lib.op, "modify");
        assert_eq!(lib.lines_added, 8); // 5 + 3
        assert_eq!(lib.lines_removed, 3); // 2 + 1

        let main = target.iter().find(|c| c.path == "src/main.rs").unwrap();
        assert_eq!(main.lines_added, 10);

        let new = target.iter().find(|c| c.path == "src/new.rs").unwrap();
        assert_eq!(new.op, "create");
        assert_eq!(new.lines_added, 8);
    }
}
