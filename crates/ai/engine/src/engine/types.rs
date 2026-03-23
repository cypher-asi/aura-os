use aura_core::*;

use crate::file_ops::{FileOp, Replacement};

#[derive(Debug, Clone)]
pub struct TaskExecution {
    pub notes: String,
    pub file_ops: Vec<FileOp>,
    pub follow_up_tasks: Vec<FollowUpSuggestion>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub parse_retries: u32,
    pub files_already_applied: bool,
}

#[derive(Debug, Clone)]
pub struct FollowUpSuggestion {
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopCommand {
    Continue,
    Pause,
    Stop,
}

#[derive(Debug, Clone)]
pub enum LoopOutcome {
    AllTasksComplete,
    Paused {
        completed_count: usize,
    },
    Stopped {
        completed_count: usize,
    },
    AllTasksBlocked,
    TaskFailed {
        completed_count: usize,
        task_id: TaskId,
        reason: String,
    },
    Error(String),
}

pub(crate) fn track_file_op(tool_name: &str, input: &serde_json::Value, ops: &mut Vec<FileOp>) {
    let path = input
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if path.is_empty() {
        return;
    }
    match tool_name {
        "write_file" => {
            let content = input
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            ops.push(FileOp::Create { path, content });
        }
        "edit_file" => {
            let old_text = input
                .get("old_text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let new_text = input
                .get("new_text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            ops.push(FileOp::SearchReplace {
                path,
                replacements: vec![Replacement {
                    search: old_text,
                    replace: new_text,
                }],
            });
        }
        "delete_file" => {
            ops.push(FileOp::Delete { path });
        }
        _ => {}
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct TaskTimings {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub fix_input_tokens: u64,
    pub fix_output_tokens: u64,
    pub parse_retries: u32,
    pub build_fix_attempts: u32,
    pub duplicate_error_bailouts: u32,
    pub llm_duration_ms: u64,
    pub file_ops_duration_ms: u64,
    pub build_verify_duration_ms: u64,
    pub task_duration_ms: u64,
    pub files_changed: u32,
}

impl TaskTimings {
    pub fn total_input(&self) -> u64 {
        self.input_tokens + self.fix_input_tokens
    }
    pub fn total_output(&self) -> u64 {
        self.output_tokens + self.fix_output_tokens
    }
}

#[derive(Debug, Clone)]
pub(crate) enum TaskOutcome {
    Completed {
        notes: String,
        follow_up_tasks: Vec<FollowUpSuggestion>,
        file_ops: Vec<FileOp>,
        timings: TaskTimings,
    },
    Failed {
        reason: String,
        phase: String,
        credit_failure: bool,
        timings: TaskTimings,
    },
}

impl TaskOutcome {
    pub fn timings(&self) -> &TaskTimings {
        match self {
            TaskOutcome::Completed { timings, .. } => timings,
            TaskOutcome::Failed { timings, .. } => timings,
        }
    }

    pub fn is_completed(&self) -> bool {
        matches!(self, TaskOutcome::Completed { .. })
    }
}

pub(crate) fn simple_file_changes(ops: &[FileOp]) -> Vec<FileChangeSummary> {
    ops.iter()
        .map(|op| match op {
            FileOp::Create { path, content } => FileChangeSummary {
                op: "create".to_string(),
                path: path.clone(),
                lines_added: content.lines().count() as u32,
                lines_removed: 0,
            },
            FileOp::Modify { path, content } => FileChangeSummary {
                op: "modify".to_string(),
                path: path.clone(),
                lines_added: content.lines().count() as u32,
                lines_removed: 0,
            },
            FileOp::Delete { path } => FileChangeSummary {
                op: "delete".to_string(),
                path: path.clone(),
                lines_added: 0,
                lines_removed: 0,
            },
            FileOp::SearchReplace { path, replacements } => FileChangeSummary {
                op: "modify".to_string(),
                path: path.clone(),
                lines_added: replacements
                    .iter()
                    .map(|r| r.replace.lines().count() as u32)
                    .sum(),
                lines_removed: replacements
                    .iter()
                    .map(|r| r.search.lines().count() as u32)
                    .sum(),
            },
        })
        .collect()
}
