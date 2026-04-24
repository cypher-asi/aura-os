use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessFailureKind {
    Truncation,
    RateLimited,
    PushTimeout,
    CompletionContract,
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HarnessSignal {
    TaskCompleted {
        task_id: Option<String>,
    },
    TaskFailed {
        task_id: Option<String>,
        reason: Option<String>,
        failure: HarnessFailureKind,
    },
    GitCommitted {
        task_id: Option<String>,
        commit_sha: Option<String>,
    },
    GitPushed {
        task_id: Option<String>,
        commit_sha: Option<String>,
    },
    GitPushFailed {
        task_id: Option<String>,
        commit_sha: Option<String>,
        reason: Option<String>,
    },
    ToolResult {
        task_id: Option<String>,
        name: Option<String>,
        is_error: bool,
        reason: Option<String>,
    },
}

impl HarnessSignal {
    pub fn from_event(event_type: &str, content: &serde_json::Value) -> Option<Self> {
        if let Some(signal) = Self::from_wrapped_event(event_type, content) {
            return Some(signal);
        }

        match event_type {
            "task_completed" => Some(Self::TaskCompleted {
                task_id: task_id(content),
            }),
            "task_failed" => {
                let reason = reason(content);
                Some(Self::TaskFailed {
                    task_id: task_id(content),
                    failure: classify_failure(reason.as_deref()),
                    reason,
                })
            }
            "git_committed" | "commit_created" => Some(Self::GitCommitted {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
            }),
            "git_pushed" | "push_succeeded" | "pushed" => Some(Self::GitPushed {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
            }),
            "git_push_failed" | "push_failed" => Some(Self::GitPushFailed {
                task_id: task_id(content),
                commit_sha: commit_sha(content),
                reason: reason(content),
            }),
            "tool_call_completed" | "tool_result" => Some(Self::ToolResult {
                task_id: task_id(content),
                name: string_field(content, &["name", "tool_name"]),
                is_error: content
                    .get("is_error")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                reason: reason(content),
            }),
            _ => None,
        }
    }

    fn from_wrapped_event(event_type: &str, content: &serde_json::Value) -> Option<Self> {
        match event_type {
            "task_sync_checkpoint" => content.get("checkpoint").and_then(|checkpoint| {
                Self::from_event_value_with_task_id(checkpoint, task_id(content))
            }),
            "task_checkpoint_state" => content
                .get("sync_state")
                .and_then(|state| state.get("status"))
                .and_then(|status| status.as_str())
                .and_then(|status| Self::from_event(status, content)),
            _ => None,
        }
    }

    pub fn from_event_value(value: &serde_json::Value) -> Option<Self> {
        Self::from_event_value_with_task_id(value, None)
    }

    pub fn task_id(&self) -> Option<&str> {
        match self {
            Self::TaskCompleted { task_id }
            | Self::TaskFailed { task_id, .. }
            | Self::GitCommitted { task_id, .. }
            | Self::GitPushed { task_id, .. }
            | Self::GitPushFailed { task_id, .. }
            | Self::ToolResult { task_id, .. } => task_id.as_deref(),
        }
    }

    pub fn failure_kind(&self) -> Option<HarnessFailureKind> {
        match self {
            Self::TaskFailed { failure, .. } => Some(*failure),
            Self::GitPushFailed { reason, .. } => Some(
                reason
                    .as_deref()
                    .map(|reason| {
                        if is_push_timeout(reason) {
                            HarnessFailureKind::PushTimeout
                        } else {
                            HarnessFailureKind::Other
                        }
                    })
                    .unwrap_or(HarnessFailureKind::Other),
            ),
            Self::ToolResult {
                is_error: true,
                reason,
                ..
            } => Some(classify_failure(reason.as_deref())),
            _ => None,
        }
    }

    fn from_event_value_with_task_id(
        value: &serde_json::Value,
        fallback_task_id: Option<String>,
    ) -> Option<Self> {
        let event_type = string_field(value, &["type", "event_type", "kind", "status"])?;
        let mut content = value.clone();
        if task_id(&content).is_none() {
            if let (Some(object), Some(task_id)) = (content.as_object_mut(), fallback_task_id) {
                object.insert("task_id".into(), serde_json::Value::String(task_id));
            }
        }
        Self::from_event(&event_type, &content)
    }
}

pub fn classify_failure(reason: Option<&str>) -> HarnessFailureKind {
    let Some(reason) = reason else {
        return HarnessFailureKind::Other;
    };
    let reason = reason.to_ascii_lowercase();
    if is_completion_contract_failure(&reason) {
        HarnessFailureKind::CompletionContract
    } else if reason.contains("truncat")
        || reason.contains("max_tokens")
        || reason.contains("maximum tokens")
        || reason.contains("needsdecomposition")
        || reason.contains("needs decomposition")
    {
        HarnessFailureKind::Truncation
    } else if reason.contains("rate limit")
        || reason.contains("rate_limited")
        || reason.contains("429")
        || reason.contains("529")
        || reason.contains("overloaded")
    {
        HarnessFailureKind::RateLimited
    } else if is_push_timeout(&reason) {
        HarnessFailureKind::PushTimeout
    } else {
        HarnessFailureKind::Other
    }
}

fn is_completion_contract_failure(reason: &str) -> bool {
    let mentions_task_done =
        reason.contains("task_done") || reason.contains("completing this task");
    let mentions_missing_edits = reason.contains("not made any file changes")
        || reason.contains("no file changes")
        || reason.contains("no files changed")
        || reason.contains("no file edited")
        || reason.contains("no file edits");
    let mentions_no_change_escape_hatch = reason.contains("no_changes_needed");

    mentions_task_done && (mentions_missing_edits || mentions_no_change_escape_hatch)
}

fn is_push_timeout(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    reason.contains("git") && reason.contains("push") && reason.contains("timeout")
}

fn task_id(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["task_id", "taskId"])
}

fn commit_sha(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["commit_sha", "commitSha", "sha"]).or_else(|| {
        value
            .get("commits")
            .and_then(|commits| commits.as_array())
            .and_then(|commits| commits.last())
            .and_then(|commit| commit.get("sha"))
            .and_then(|sha| sha.as_str())
            .map(str::to_owned)
    })
}

fn reason(value: &serde_json::Value) -> Option<String> {
    string_field(value, &["reason", "error", "message", "failure_class"])
}

fn string_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_task_failed_with_classification() {
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": "harness response truncated; needs decomposition",
            }),
        )
        .expect("signal");

        assert_eq!(signal.task_id(), Some("task-1"));
        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::Truncation));
    }

    #[test]
    fn classifies_task_done_without_file_edits_as_completion_contract() {
        let reason = "ERROR: You are completing this task but have not made any file changes \
                      (write_file, edit_file, or delete_file). Implementation tasks must produce \
                      file changes. If this task genuinely requires no file changes, call \
                      task_done again with \"no_changes_needed\": true and explain why in the \
                      notes field.";
        let signal = HarnessSignal::from_event(
            "task_failed",
            &serde_json::json!({
                "task_id": "task-1",
                "reason": reason,
            }),
        )
        .expect("signal");

        assert_eq!(
            signal.failure_kind(),
            Some(HarnessFailureKind::CompletionContract)
        );
    }

    #[test]
    fn completion_contract_does_not_swallow_plain_truncation() {
        assert_eq!(
            classify_failure(Some(
                "response truncated because no file context was available"
            )),
            HarnessFailureKind::Truncation
        );
    }

    #[test]
    fn parses_legacy_git_push_failed_step() {
        let signal = HarnessSignal::from_event_value(&serde_json::json!({
            "type": "git_push_failed",
            "commit_sha": "abc123",
            "reason": "git push timeout",
        }))
        .expect("signal");

        assert_eq!(signal.failure_kind(), Some(HarnessFailureKind::PushTimeout));
        assert!(matches!(
            signal,
            HarnessSignal::GitPushFailed {
                commit_sha: Some(ref sha),
                ..
            } if sha == "abc123"
        ));
    }

    #[test]
    fn parses_checkpoint_wrapper_with_task_id() {
        let signal = HarnessSignal::from_event(
            "task_sync_checkpoint",
            &serde_json::json!({
                "task_id": "task-1",
                "checkpoint": {
                    "kind": "git_pushed",
                    "commits": [{ "sha": "def456" }],
                },
            }),
        )
        .expect("signal");

        assert_eq!(signal.task_id(), Some("task-1"));
        assert!(matches!(
            signal,
            HarnessSignal::GitPushed {
                commit_sha: Some(ref sha),
                ..
            } if sha == "def456"
        ));
    }
}
