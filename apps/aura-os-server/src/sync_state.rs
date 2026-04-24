use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskSyncStatus {
    #[default]
    NotAttempted,
    PendingPush,
    Pushed,
    PushFailed,
    CommitFailed,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskSyncState {
    pub phase: Option<String>,
    pub status: TaskSyncStatus,
    pub last_commit_sha: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub last_error: Option<String>,
    pub retry_safe: bool,
    pub last_attempt: Option<u32>,
    #[serde(default)]
    pub orphaned_commits: Vec<String>,
    pub needs_reconciliation: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskSyncCheckpoint {
    pub kind: String,
    pub phase: Option<String>,
    pub commit_sha: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub reason: Option<String>,
    pub attempt: Option<u32>,
    pub observed_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskCheckpointSummary {
    pub execution_started: bool,
    pub files_changed: bool,
    pub verification_passed: bool,
    pub commit_created: bool,
    pub push_confirmed: bool,
    pub push_failed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskRecoveryPointKind {
    PendingPush,
    RetryPush,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskRecoveryPoint {
    pub kind: TaskRecoveryPointKind,
    pub commit_sha: String,
    pub retry_safe: bool,
}

fn step_string(step: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        step.get(*key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    })
}

fn checkpoint_phase(kind: &str) -> Option<&'static str> {
    match kind {
        "task_started" => Some("executing"),
        "task_retrying" => Some("retrying"),
        "git_committed" => Some("committed"),
        "git_commit_failed" => Some("commit_failed"),
        "git_pushed" => Some("pushed"),
        "git_push_failed" => Some("push_failed"),
        "task_completed" => Some("completed"),
        "task_failed" => Some("failed"),
        _ => None,
    }
}

pub(crate) fn checkpoint_from_git_step(step: &serde_json::Value) -> Option<TaskSyncCheckpoint> {
    let kind = step.get("type").and_then(|v| v.as_str())?;
    Some(TaskSyncCheckpoint {
        kind: kind.to_string(),
        phase: checkpoint_phase(kind).map(str::to_owned),
        commit_sha: step
            .get("commit_sha")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .or_else(|| {
                step.get("commits")
                    .and_then(|v| v.as_array())
                    .and_then(|commits| commits.last())
                    .and_then(|commit| commit.get("sha"))
                    .and_then(|v| v.as_str())
                    .map(str::to_owned)
            }),
        repo: step_string(step, &["repo", "remote", "remote_name"]),
        branch: step_string(step, &["branch", "git_branch"]),
        reason: step_string(step, &["reason", "error", "message"]),
        attempt: step
            .get("attempt")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok()),
        observed_at: step_string(step, &["created_at", "timestamp"]),
    })
}

pub(crate) fn derive_sync_state_from_checkpoints(
    checkpoints: &[TaskSyncCheckpoint],
) -> Option<TaskSyncState> {
    if checkpoints.is_empty() {
        return None;
    }

    let mut state = TaskSyncState::default();
    let mut unresolved_commits: Vec<String> = Vec::new();

    for checkpoint in checkpoints {
        if let Some(phase) = checkpoint.phase.clone() {
            state.phase = Some(phase);
        }
        if let Some(commit_sha) = checkpoint.commit_sha.clone() {
            state.last_commit_sha = Some(commit_sha.clone());
            if checkpoint.kind == "git_committed" {
                unresolved_commits.push(commit_sha);
            }
        }
        if let Some(repo) = checkpoint.repo.clone() {
            state.repo = Some(repo);
        }
        if let Some(branch) = checkpoint.branch.clone() {
            state.branch = Some(branch);
        }
        if let Some(reason) = checkpoint.reason.clone() {
            state.last_error = Some(reason);
        }
        if let Some(attempt) = checkpoint.attempt {
            state.last_attempt = Some(attempt);
        }

        match checkpoint.kind.as_str() {
            "git_committed" | "commit_created" => {
                state.status = TaskSyncStatus::PendingPush;
                state.last_error = None;
                state.retry_safe = state.last_commit_sha.is_some();
            }
            "git_commit_failed" => {
                state.status = TaskSyncStatus::CommitFailed;
                state.retry_safe = false;
            }
            "git_pushed" | "push_succeeded" => {
                state.status = TaskSyncStatus::Pushed;
                if let Some(commit_sha) = checkpoint.commit_sha.as_ref() {
                    if let Some(pos) = unresolved_commits.iter().rposition(|sha| sha == commit_sha)
                    {
                        unresolved_commits.remove(pos);
                    }
                } else {
                    unresolved_commits.pop();
                }
                state.last_error = None;
                state.retry_safe = false;
            }
            "git_push_failed" | "push_failed" => {
                state.status = TaskSyncStatus::PushFailed;
                state.retry_safe = state.last_commit_sha.is_some();
            }
            _ => {}
        }
    }

    if state.last_commit_sha.is_none() {
        state.last_commit_sha = unresolved_commits.last().cloned();
    }
    state.orphaned_commits = unresolved_commits;
    state.needs_reconciliation = !state.orphaned_commits.is_empty()
        || matches!(
            state.status,
            TaskSyncStatus::PushFailed | TaskSyncStatus::CommitFailed
        );
    Some(state)
}

pub(crate) fn derive_sync_state(git_steps: &[serde_json::Value]) -> TaskSyncState {
    let checkpoints: Vec<_> = git_steps
        .iter()
        .filter_map(checkpoint_from_git_step)
        .collect();
    derive_sync_state_from_checkpoints(&checkpoints).unwrap_or_default()
}

pub(crate) fn derive_checkpoint_summary(
    has_output: bool,
    files_changed_count: usize,
    build_steps: &[serde_json::Value],
    test_steps: &[serde_json::Value],
    git_steps: &[serde_json::Value],
) -> TaskCheckpointSummary {
    let sync_state = derive_sync_state(git_steps);
    TaskCheckpointSummary {
        execution_started: has_output
            || files_changed_count > 0
            || !build_steps.is_empty()
            || !test_steps.is_empty()
            || !git_steps.is_empty(),
        files_changed: files_changed_count > 0,
        // Display-only summary of harness-reported verification evidence.
        // The harness, not aura-os, decides whether the task satisfied DoD.
        verification_passed: !build_steps.is_empty() && !test_steps.is_empty(),
        commit_created: sync_state.last_commit_sha.is_some(),
        push_confirmed: sync_state.status == TaskSyncStatus::Pushed,
        push_failed: sync_state.status == TaskSyncStatus::PushFailed,
    }
}

pub(crate) fn derive_recovery_point(sync_state: &TaskSyncState) -> Option<TaskRecoveryPoint> {
    let commit_sha = sync_state.last_commit_sha.clone()?;
    match sync_state.status {
        TaskSyncStatus::PendingPush => Some(TaskRecoveryPoint {
            kind: TaskRecoveryPointKind::PendingPush,
            commit_sha,
            retry_safe: true,
        }),
        TaskSyncStatus::PushFailed if sync_state.retry_safe => Some(TaskRecoveryPoint {
            kind: TaskRecoveryPointKind::RetryPush,
            commit_sha,
            retry_safe: true,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        checkpoint_from_git_step, derive_checkpoint_summary, derive_recovery_point,
        derive_sync_state, derive_sync_state_from_checkpoints, TaskRecoveryPointKind,
        TaskSyncCheckpoint, TaskSyncStatus,
    };

    #[test]
    fn derives_pending_push_state_after_commit() {
        let state = derive_sync_state(&[serde_json::json!({
            "type": "git_committed",
            "commit_sha": "abc12345",
        })]);
        assert_eq!(state.status, TaskSyncStatus::PendingPush);
        assert_eq!(state.last_commit_sha.as_deref(), Some("abc12345"));
        assert!(state.retry_safe);
    }

    #[test]
    fn derives_push_failed_state_with_recovery_point() {
        let steps = vec![
            serde_json::json!({
                "type": "git_committed",
                "commit_sha": "abc12345",
            }),
            serde_json::json!({
                "type": "git_push_failed",
                "reason": "git push timed out",
            }),
        ];
        let state = derive_sync_state(&steps);
        assert_eq!(state.status, TaskSyncStatus::PushFailed);
        assert_eq!(state.last_commit_sha.as_deref(), Some("abc12345"));
        assert!(state.retry_safe);

        let recovery = derive_recovery_point(&state).expect("push failure should be retryable");
        assert_eq!(recovery.kind, TaskRecoveryPointKind::RetryPush);
        assert_eq!(recovery.commit_sha, "abc12345");
    }

    #[test]
    fn derives_reconciliation_state_from_checkpoints() {
        let checkpoints = vec![
            TaskSyncCheckpoint {
                kind: "git_committed".into(),
                phase: Some("committed".into()),
                commit_sha: Some("abc12345".into()),
                ..Default::default()
            },
            TaskSyncCheckpoint {
                kind: "git_push_failed".into(),
                phase: Some("push_failed".into()),
                reason: Some("timed out".into()),
                ..Default::default()
            },
        ];
        let state = derive_sync_state_from_checkpoints(&checkpoints).expect("state");
        assert_eq!(state.phase.as_deref(), Some("push_failed"));
        assert_eq!(state.status, TaskSyncStatus::PushFailed);
        assert_eq!(state.orphaned_commits, vec!["abc12345".to_string()]);
        assert!(state.needs_reconciliation);
    }

    #[test]
    fn checkpoint_can_be_built_from_legacy_push_step() {
        let checkpoint = checkpoint_from_git_step(&serde_json::json!({
            "type": "git_pushed",
            "commits": [{ "sha": "abc12345" }],
            "branch": "main",
            "repo": "origin",
        }))
        .expect("checkpoint");
        assert_eq!(checkpoint.kind, "git_pushed");
        assert_eq!(checkpoint.commit_sha.as_deref(), Some("abc12345"));
        assert_eq!(checkpoint.branch.as_deref(), Some("main"));
        assert_eq!(checkpoint.repo.as_deref(), Some("origin"));
    }

    #[test]
    fn derives_checkpoint_summary_from_steps() {
        let checkpoints = derive_checkpoint_summary(
            true,
            1,
            &[serde_json::json!({"type": "build_verification_passed"})],
            &[serde_json::json!({"type": "test_verification_passed"})],
            &[serde_json::json!({"type": "git_committed", "commit_sha": "abc12345"})],
        );
        assert!(checkpoints.execution_started);
        assert!(checkpoints.files_changed);
        assert!(checkpoints.verification_passed);
        assert!(checkpoints.commit_created);
        assert!(!checkpoints.push_confirmed);
    }
}
