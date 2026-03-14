use std::path::Path as FsPath;

use axum::extract::{Path, State};
use axum::Json;

use serde::Serialize;

use aura_core::{ProjectId, SpecId, Task, TaskId};
use aura_tasks::ProjectProgress;

use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn list_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let tasks = state
        .store
        .list_tasks_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(tasks))
}

pub async fn list_tasks_by_spec(
    State(state): State<AppState>,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Vec<Task>>> {
    let tasks = state
        .store
        .list_tasks_by_spec(&project_id, &spec_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(tasks))
}

pub async fn extract_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let tasks = state
        .task_extraction_service
        .extract_all_tasks(&project_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(tasks))
}

pub async fn transition_task(
    State(state): State<AppState>,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<TransitionTaskRequest>,
) -> ApiResult<Json<Task>> {
    let all_tasks = state
        .store
        .list_tasks_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let task = all_tasks
        .iter()
        .find(|t| t.task_id == task_id)
        .ok_or_else(|| ApiError::not_found("task not found"))?;

    let updated = state
        .task_service
        .transition_task(&project_id, &task.spec_id, &task_id, req.new_status)
        .map_err(|e| match &e {
            aura_tasks::TaskError::NotFound => ApiError::not_found("task not found"),
            aura_tasks::TaskError::IllegalTransition { .. } => {
                ApiError::bad_request(e.to_string())
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(updated))
}

pub async fn retry_task(
    State(state): State<AppState>,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let all_tasks = state
        .store
        .list_tasks_by_project(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let task = all_tasks
        .iter()
        .find(|t| t.task_id == task_id)
        .ok_or_else(|| ApiError::not_found("task not found"))?;

    let updated = state
        .task_service
        .retry_task(&project_id, &task.spec_id, &task_id)
        .map_err(|e| match &e {
            aura_tasks::TaskError::NotFound => ApiError::not_found("task not found"),
            aura_tasks::TaskError::IllegalTransition { .. } => {
                ApiError::bad_request(e.to_string())
            }
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(updated))
}

pub async fn get_progress(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<ProjectProgress>> {
    let mut progress = state
        .task_service
        .get_project_progress(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    // Sessions + tokens + cost: aggregate across all sessions for this project
    if let Ok(sessions) = state.store.list_sessions_by_project(&project_id) {
        let fee_schedule = state.pricing_service.get_fee_schedule();
        progress.total_sessions = sessions.len() as u64;
        progress.total_tokens = sessions
            .iter()
            .map(|s| s.total_input_tokens + s.total_output_tokens)
            .sum();
        progress.total_cost = sessions
            .iter()
            .map(|s| {
                let model = s.model.as_deref().unwrap_or("claude-opus-4-6");
                let (inp, out) = aura_pricing::lookup_rate_in(&fee_schedule, model);
                aura_pricing::compute_cost_with_rates(
                    s.total_input_tokens, s.total_output_tokens, inp, out,
                )
            })
            .sum();
    }

    // Messages: count from chat store
    if let Ok(count) = state.store.count_messages_by_project(&project_id) {
        progress.total_messages = count as u64;
    }

    // LOC + commits need the project's linked folder
    if let Ok(project) = state.project_service.get_project(&project_id) {
        let folder = &project.linked_folder_path;
        if FsPath::new(folder).is_dir() {
            progress.lines_of_code = count_lines_of_code(folder).await;
            progress.total_commits = count_git_commits(folder).await;
            progress.total_tests = count_tests(folder).await;
        }

        // PRs: query GitHub if integration is configured
        if let Some(ref repo_full_name) = project.github_repo_full_name {
            progress.total_pull_requests = count_github_prs(&state, repo_full_name).await;
        }
    }

    Ok(Json(progress))
}

#[derive(Serialize)]
pub struct TaskOutputResponse {
    pub output: String,
}

pub async fn get_task_output(
    State(state): State<AppState>,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<TaskOutputResponse>> {
    let output = state
        .task_output_buffers
        .lock()
        .map_err(|e| ApiError::internal(e.to_string()))?
        .get(&task_id)
        .cloned()
        .unwrap_or_default();

    if !output.is_empty() {
        return Ok(Json(TaskOutputResponse { output }));
    }

    let persisted = state
        .store
        .find_task_by_id(&task_id)
        .ok()
        .flatten()
        .map(|t| t.live_output)
        .unwrap_or_default();

    Ok(Json(TaskOutputResponse { output: persisted }))
}

async fn count_lines_of_code(folder: &str) -> u64 {
    tokio::task::spawn_blocking({
        let folder = folder.to_string();
        move || count_loc_sync(&folder)
    })
    .await
    .unwrap_or(0)
}

fn count_loc_sync(folder: &str) -> u64 {
    use std::fs;

    const SKIP: &[&str] = &[
        ".git",
        "target",
        "node_modules",
        "__pycache__",
        ".venv",
        "dist",
        "build",
    ];
    const EXTS: &[&str] = &[
        "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "css", "html", "sql", "sh", "yaml",
        "yml", "toml", "json", "md",
    ];

    fn walk(dir: &FsPath, total: &mut u64) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !SKIP.contains(&name.as_str()) {
                    walk(&path, total);
                }
            } else if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or_default();
                if EXTS.contains(&ext) {
                    if let Ok(content) = fs::read_to_string(&path) {
                        *total += content.lines().count() as u64;
                    }
                }
            }
        }
    }

    let mut total = 0u64;
    walk(FsPath::new(folder), &mut total);
    total
}

async fn count_tests(folder: &str) -> u64 {
    tokio::task::spawn_blocking({
        let folder = folder.to_string();
        move || count_tests_sync(&folder)
    })
    .await
    .unwrap_or(0)
}

fn count_tests_sync(folder: &str) -> u64 {
    use std::fs;

    const SKIP: &[&str] = &[
        ".git",
        "target",
        "node_modules",
        "__pycache__",
        ".venv",
        "dist",
        "build",
    ];

    fn walk(dir: &FsPath, total: &mut u64) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !SKIP.contains(&name.as_str()) {
                    walk(&path, total);
                }
            } else if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or_default();
                if let Ok(content) = fs::read_to_string(&path) {
                    match ext {
                        "rs" => {
                            *total += content.matches("#[test]").count() as u64;
                            *total += content.matches("#[tokio::test]").count() as u64;
                        }
                        "ts" | "tsx" | "js" | "jsx" => {
                            if name.contains(".test.") || name.contains(".spec.") {
                                for line in content.lines() {
                                    let trimmed = line.trim_start();
                                    if trimmed.starts_with("it(")
                                        || trimmed.starts_with("it.only(")
                                        || trimmed.starts_with("test(")
                                        || trimmed.starts_with("test.only(")
                                    {
                                        *total += 1;
                                    }
                                }
                            }
                        }
                        "py" => {
                            for line in content.lines() {
                                let trimmed = line.trim_start();
                                if trimmed.starts_with("def test_")
                                    || trimmed.starts_with("async def test_")
                                {
                                    *total += 1;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    let mut total = 0u64;
    walk(FsPath::new(folder), &mut total);
    total
}

async fn count_git_commits(folder: &str) -> u64 {
    let output = tokio::process::Command::new("git")
        .args(["rev-list", "--count", "HEAD"])
        .current_dir(folder)
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse::<u64>()
            .unwrap_or(0),
        _ => 0,
    }
}

/// Count PRs via `gh pr list` CLI if available, otherwise 0.
async fn count_github_prs(_state: &AppState, repo_full_name: &str) -> u64 {
    let output = tokio::process::Command::new("gh")
        .args([
            "pr",
            "list",
            "--repo",
            repo_full_name,
            "--state",
            "all",
            "--json",
            "number",
            "--limit",
            "1000",
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let json: Result<Vec<serde_json::Value>, _> =
                serde_json::from_slice(&o.stdout);
            json.map(|v| v.len() as u64).unwrap_or(0)
        }
        _ => 0,
    }
}
