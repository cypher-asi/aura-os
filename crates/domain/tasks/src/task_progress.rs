use serde::{Deserialize, Serialize};

use aura_core::*;

use crate::error::TaskError;
use crate::TaskService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectProgress {
    pub project_id: ProjectId,
    pub total_tasks: usize,
    pub pending_tasks: usize,
    pub ready_tasks: usize,
    pub in_progress_tasks: usize,
    pub blocked_tasks: usize,
    pub done_tasks: usize,
    pub failed_tasks: usize,
    pub completion_percentage: f64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub lines_changed: u64,
    pub lines_of_code: u64,
    pub total_commits: u64,
    pub total_pull_requests: u64,
    pub total_messages: u64,
    pub total_sessions: u64,
    pub total_time_seconds: u64,
    pub total_tests: u64,
    pub total_agents: u32,
    pub total_parse_retries: u32,
    pub total_build_fix_attempts: u32,
    pub build_verify_failures: usize,
    pub execution_failures: usize,
    pub file_ops_failures: usize,
}

fn count_status(tasks: &[Task], status: TaskStatus) -> usize {
    tasks.iter().filter(|t| t.status == status).count()
}

fn aggregate_build_stats(tasks: &[Task]) -> (u32, u32) {
    let parse_retries = tasks
        .iter()
        .flat_map(|t| &t.build_steps)
        .filter(|s| s.kind == "fix_attempt")
        .count() as u32;
    let build_fix_attempts = tasks
        .iter()
        .map(|t| t.build_steps.iter().filter(|s| s.kind == "fix_attempt").count() as u32)
        .sum();
    (parse_retries, build_fix_attempts)
}

fn classify_failure_reasons(tasks: &[Task]) -> (usize, usize, usize) {
    let failed: Vec<&Task> = tasks.iter().filter(|t| t.status == TaskStatus::Failed).collect();
    let build = failed.iter().filter(|t| t.execution_notes.contains("build verification failed")).count();
    let file_ops = failed.iter().filter(|t| t.execution_notes.contains("file operation failed")).count();
    let execution = failed.len() - build - file_ops;
    (build, file_ops, execution)
}

impl TaskService {
    pub async fn get_project_progress(
        &self,
        project_id: &ProjectId,
    ) -> Result<ProjectProgress, TaskError> {
        let tasks = self.list_tasks(project_id).await?;
        let total = tasks.len();
        let done = count_status(&tasks, TaskStatus::Done);
        let pct = if total == 0 { 0.0 } else { (done as f64 / total as f64) * 100.0 };

        let lines_changed: u64 = tasks
            .iter()
            .flat_map(|t| &t.files_changed)
            .map(|f| (f.lines_added as u64) + (f.lines_removed as u64))
            .sum();
        let total_tokens: u64 = tasks.iter().map(|t| t.total_input_tokens + t.total_output_tokens).sum();
        let (total_parse_retries, total_build_fix_attempts) = aggregate_build_stats(&tasks);
        let (build_verify_failures, file_ops_failures, execution_failures) = classify_failure_reasons(&tasks);

        Ok(ProjectProgress {
            project_id: *project_id,
            total_tasks: total,
            pending_tasks: count_status(&tasks, TaskStatus::Pending),
            ready_tasks: count_status(&tasks, TaskStatus::Ready),
            in_progress_tasks: count_status(&tasks, TaskStatus::InProgress),
            blocked_tasks: count_status(&tasks, TaskStatus::Blocked),
            done_tasks: done,
            failed_tasks: count_status(&tasks, TaskStatus::Failed),
            completion_percentage: pct,
            total_tokens,
            total_cost: tasks.iter().map(|t| {
                let model = t.model.as_deref().unwrap_or("claude-opus-4-6");
                self.cost_calculator.compute_task_cost(model, t.total_input_tokens, t.total_output_tokens)
            }).sum(),
            lines_changed,
            lines_of_code: 0,
            total_commits: 0,
            total_pull_requests: 0,
            total_messages: 0,
            total_sessions: 0,
            total_time_seconds: 0,
            total_tests: 0,
            total_agents: 0,
            total_parse_retries,
            total_build_fix_attempts,
            build_verify_failures,
            execution_failures,
            file_ops_failures,
        })
    }
}
