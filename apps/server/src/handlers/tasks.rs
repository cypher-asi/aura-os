use std::path::Path as FsPath;

use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;

use aura_core::{ProjectId, SpecId, Task, TaskId, TaskStatus};
use aura_storage::StorageTask;
use aura_tasks::ProjectProgress;

use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn parse_dt(s: &Option<String>) -> DateTime<Utc> {
    s.as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn parse_task_status(s: &str) -> TaskStatus {
    serde_json::from_str(&format!("\"{s}\"")).unwrap_or(TaskStatus::Pending)
}

pub(crate) fn storage_task_to_task(s: StorageTask) -> Result<Task, String> {
    Ok(Task {
        task_id: s.id.parse().map_err(|e| format!("invalid task id: {e}"))?,
        project_id: s
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid project id: {e}"))?,
        spec_id: s
            .spec_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid spec id: {e}"))?,
        title: s.title.unwrap_or_default(),
        description: s.description.unwrap_or_default(),
        status: parse_task_status(s.status.as_deref().unwrap_or("pending")),
        order_index: s.order_index.unwrap_or(0) as u32,
        dependency_ids: s
            .dependency_ids
            .unwrap_or_default()
            .into_iter()
            .filter_map(|id| id.parse().ok())
            .collect(),
        parent_task_id: None,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: vec![],
        live_output: String::new(),
        build_steps: vec![],
        test_steps: vec![],
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: parse_dt(&s.created_at),
        updated_at: parse_dt(&s.updated_at),
    })
}

pub async fn list_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .collect();
    Ok(Json(tasks))
}

pub async fn list_tasks_by_spec(
    State(state): State<AppState>,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .filter(|t| t.spec_id == spec_id)
        .collect();
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
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<TransitionTaskRequest>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let status_str =
        serde_json::to_value(req.new_status).unwrap().as_str().unwrap_or("pending").to_string();

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_storage::TransitionTaskRequest { status: status_str },
        )
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            aura_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(e.to_string()),
        })?;

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let task = storage_task_to_task(updated).map_err(|e| ApiError::internal(e))?;
    Ok(Json(task))
}

pub async fn retry_task(
    State(state): State<AppState>,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    storage
        .transition_task(
            &task_id.to_string(),
            &jwt,
            &aura_storage::TransitionTaskRequest {
                status: "ready".to_string(),
            },
        )
        .await
        .map_err(|e| match &e {
            aura_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            aura_storage::StorageError::Server { status: 400, body } => {
                ApiError::bad_request(body.clone())
            }
            _ => ApiError::internal(e.to_string()),
        })?;

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let task = storage_task_to_task(updated).map_err(|e| ApiError::internal(e))?;
    Ok(Json(task))
}

pub async fn get_progress(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<ProjectProgress>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .collect();

    let total = tasks.len();
    let done = tasks.iter().filter(|t| t.status == TaskStatus::Done).count();
    let pct = if total == 0 { 0.0 } else { (done as f64 / total as f64) * 100.0 };

    let mut progress = ProjectProgress {
        project_id,
        total_tasks: total,
        pending_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Pending).count(),
        ready_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Ready).count(),
        in_progress_tasks: tasks.iter().filter(|t| t.status == TaskStatus::InProgress).count(),
        blocked_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Blocked).count(),
        done_tasks: done,
        failed_tasks: tasks.iter().filter(|t| t.status == TaskStatus::Failed).count(),
        completion_percentage: pct,
        total_tokens: 0,
        total_cost: 0.0,
        lines_changed: 0,
        lines_of_code: 0,
        total_commits: 0,
        total_pull_requests: 0,
        total_messages: 0,
        total_sessions: 0,
        total_time_seconds: 0,
        total_tests: 0,
        total_agents: 0,
        total_parse_retries: 0,
        total_build_fix_attempts: 0,
        build_verify_failures: 0,
        execution_failures: 0,
        file_ops_failures: 0,
    };

    aggregate_session_metrics(&state, &project_id, &mut progress).await;
    aggregate_agent_instance_metrics(&state, &project_id, &mut progress).await;

    if let Ok(count) = state.store.count_messages_by_project(&project_id) {
        progress.total_messages = count as u64;
    }

    aggregate_repo_metrics(&state, &project_id, &mut progress).await;

    Ok(Json(progress))
}

async fn aggregate_session_metrics(
    state: &AppState,
    project_id: &ProjectId,
    progress: &mut ProjectProgress,
) {
    let Some(ref storage) = state.storage_client else { return };
    let Ok(jwt) = state.get_jwt() else { return };

    let Ok(storage_agents) = storage
        .list_project_agents(&project_id.to_string(), &jwt)
        .await
    else {
        return;
    };

    let mut total_sessions = 0u64;
    let mut total_time_seconds = 0u64;
    for agent in &storage_agents {
        if let Ok(sessions) = storage.list_sessions(&agent.id, &jwt).await {
            total_sessions += sessions.len() as u64;
            total_time_seconds += sessions
                .iter()
                .map(|s| {
                    let created = s
                        .created_at
                        .as_deref()
                        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                        .map(|dt| dt.with_timezone(&Utc));
                    let ended = s
                        .ended_at
                        .as_deref()
                        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                        .map(|dt| dt.with_timezone(&Utc))
                        .or_else(|| Some(Utc::now()));
                    match (created, ended) {
                        (Some(c), Some(e)) => (e - c).num_seconds().max(0) as u64,
                        _ => 0,
                    }
                })
                .sum::<u64>();
        }
    }
    progress.total_sessions = total_sessions;
    progress.total_time_seconds = total_time_seconds;
    // Token counts and cost are now tracked via agent instances, not sessions.
    // StorageSession doesn't carry total_input_tokens / total_output_tokens.
}

async fn aggregate_agent_instance_metrics(
    state: &AppState,
    project_id: &ProjectId,
    progress: &mut ProjectProgress,
) {
    let instances = match state.agent_instance_service.list_instances(project_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(%project_id, error = %e, "Progress: failed to list agent instances");
            return;
        }
    };
    let fee_schedule = state.pricing_service.get_fee_schedule();
    for ai in &instances {
        tracing::debug!(
            %project_id,
            agent_instance_id = %ai.agent_instance_id,
            input = ai.total_input_tokens,
            output = ai.total_output_tokens,
            "Progress: agent instance token counts"
        );
    }
    let instance_tokens: u64 = instances
        .iter()
        .map(|ai| ai.total_input_tokens + ai.total_output_tokens)
        .sum();
    let instance_cost: f64 = instances
        .iter()
        .map(|ai| {
            let model = ai.model.as_deref().unwrap_or("claude-opus-4-6");
            let (inp, out) = aura_billing::lookup_rate_in(&fee_schedule, model);
            aura_billing::compute_cost_with_rates(
                ai.total_input_tokens, ai.total_output_tokens, inp, out,
            )
        })
        .sum();
    progress.total_tokens += instance_tokens;
    progress.total_cost += instance_cost;
    progress.total_agents = instances.len() as u32;
    tracing::info!(
        %project_id,
        instance_count = instances.len(),
        instance_tokens,
        total_tokens = progress.total_tokens,
        total_cost = progress.total_cost,
        "Progress: aggregated agent instance metrics"
    );
}

async fn aggregate_repo_metrics(
    state: &AppState,
    project_id: &ProjectId,
    progress: &mut ProjectProgress,
) {
    let Ok(project) = state.project_service.get_project(project_id) else {
        return;
    };
    let folder = &project.linked_folder_path;
    if FsPath::new(folder).is_dir() {
        progress.lines_of_code = count_lines_of_code(folder).await;
        progress.total_commits = count_git_commits(folder).await;
        progress.total_tests = count_tests(folder).await;
    }
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

    Ok(Json(TaskOutputResponse { output }))
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
        ".git", "target", "node_modules", "__pycache__", ".venv", "dist", "build",
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
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default();
                if let Ok(content) = fs::read_to_string(&path) {
                    *total += count_tests_in_file(ext, &name, &content);
                }
            }
        }
    }

    let mut total = 0u64;
    walk(FsPath::new(folder), &mut total);
    total
}

fn count_tests_in_file(ext: &str, name: &str, content: &str) -> u64 {
    match ext {
        "rs" => {
            (content.matches("#[test]").count() + content.matches("#[tokio::test]").count()) as u64
        }
        "ts" | "tsx" | "js" | "jsx" if name.contains(".test.") || name.contains(".spec.") => {
            content
                .lines()
                .filter(|line| {
                    let t = line.trim_start();
                    t.starts_with("it(")
                        || t.starts_with("it.only(")
                        || t.starts_with("test(")
                        || t.starts_with("test.only(")
                })
                .count() as u64
        }
        "py" => content
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                t.starts_with("def test_") || t.starts_with("async def test_")
            })
            .count() as u64,
        _ => 0,
    }
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
