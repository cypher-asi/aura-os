use std::collections::HashSet;

use aura_os_core::{ProjectId, Task, TaskId, TaskStatus};
use aura_os_storage::StorageClient;
use aura_os_tasks::TaskService;

use super::{broadcast_task_updated, storage_task_to_task};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Validate the persisted dependency graph and make every currently-runnable
/// pending task Ready before an automation loop starts. Task creation in
/// aura-storage always begins at Pending, so without this reconciliation a
/// freshly extracted plan can contain dozens of tasks and still expose no
/// claimable first task.
pub(crate) async fn prepare_task_graph_for_run(
    state: &AppState,
    jwt: &str,
    project_id: ProjectId,
) -> ApiResult<()> {
    let storage = state.require_storage_client()?;
    let tasks = load_tasks(storage, jwt, project_id)
        .await
        .map_err(ApiError::internal)?;
    validate_dependency_graph(&tasks).map_err(ApiError::bad_request)?;
    let promoted = promote_runnable_tasks(storage, jwt, &tasks, None)
        .await
        .map_err(ApiError::internal)?;
    broadcast_promotions(state, project_id, &promoted);
    Ok(())
}

/// Completion-time counterpart to [`prepare_task_graph_for_run`]. The
/// harness transitions the completed row through Aura's flat task endpoint;
/// this hook promotes every dependent whose full prerequisite set is now
/// Done, allowing the autonomous loop to claim the next task without a user
/// manually clicking Run on each row.
pub(crate) async fn promote_unblocked_after_completion(
    state: &AppState,
    jwt: &str,
    project_id: ProjectId,
    completed_task_id: TaskId,
) -> Result<(), String> {
    let storage = state
        .storage_client
        .as_deref()
        .ok_or_else(|| "storage client not configured".to_string())?;
    let tasks = load_tasks(storage, jwt, project_id).await?;
    let promoted = promote_runnable_tasks(storage, jwt, &tasks, Some(completed_task_id)).await?;
    broadcast_promotions(state, project_id, &promoted);
    Ok(())
}

async fn load_tasks(
    storage: &StorageClient,
    jwt: &str,
    project_id: ProjectId,
) -> Result<Vec<Task>, String> {
    storage
        .list_tasks(&project_id.to_string(), jwt)
        .await
        .map_err(|error| format!("listing tasks for dependency reconciliation: {error}"))?
        .into_iter()
        .map(storage_task_to_task)
        .collect()
}

fn validate_dependency_graph(tasks: &[Task]) -> Result<(), String> {
    let ids: HashSet<TaskId> = tasks.iter().map(|task| task.task_id).collect();
    let dangling = tasks
        .iter()
        .filter(|task| task.status != TaskStatus::Done)
        .flat_map(|task| {
            task.dependency_ids
                .iter()
                .filter(|dependency_id| !ids.contains(dependency_id))
                .map(move |dependency_id| format!("{} -> {}", task.title, dependency_id))
        })
        .collect::<Vec<_>>();
    if !dangling.is_empty() {
        return Err(format!(
            "Task dependency graph references missing tasks: {}. Regenerate or edit the plan before starting the dev run.",
            dangling.join(", ")
        ));
    }
    let unfinished = tasks
        .iter()
        .filter(|task| task.status != TaskStatus::Done)
        .cloned()
        .collect::<Vec<_>>();
    TaskService::detect_cycles(&unfinished).map_err(|_| {
        "Task dependency graph contains a cycle. Regenerate or edit the plan before starting the dev run."
            .to_string()
    })
}

async fn promote_runnable_tasks(
    storage: &StorageClient,
    jwt: &str,
    tasks: &[Task],
    assume_done: Option<TaskId>,
) -> Result<Vec<Task>, String> {
    let mut done_ids: HashSet<TaskId> = tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Done)
        .map(|task| task.task_id)
        .collect();
    done_ids.extend(assume_done);

    let mut promoted = Vec::new();
    for task in tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Pending)
    {
        if assume_done.is_some_and(|completed_id| !task.dependency_ids.contains(&completed_id)) {
            continue;
        }
        if task
            .dependency_ids
            .iter()
            .all(|dependency_id| done_ids.contains(dependency_id))
        {
            let ready = aura_os_tasks::safe_transition(
                storage,
                jwt,
                &task.task_id.to_string(),
                TaskStatus::Ready,
            )
            .await
            .map_err(|error| format!("promoting task {} to Ready: {error}", task.task_id))?;
            promoted.push(ready);
        }
    }
    Ok(promoted)
}

fn broadcast_promotions(state: &AppState, project_id: ProjectId, promoted: &[Task]) {
    for task in promoted {
        broadcast_task_updated(
            state,
            &project_id,
            task,
            &["status"],
            Some((TaskStatus::Pending, TaskStatus::Ready)),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{SpecId, TaskId};
    use aura_os_storage::{CreateSpecRequest, CreateTaskRequest};
    use chrono::Utc;

    fn task(title: &str, dependency_ids: Vec<TaskId>) -> Task {
        Task {
            task_id: TaskId::new(),
            project_id: ProjectId::new(),
            spec_id: SpecId::new(),
            title: title.to_string(),
            description: String::new(),
            status: TaskStatus::Pending,
            order_index: 0,
            dependency_ids,
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: Vec::new(),
            live_output: String::new(),
            build_steps: Vec::new(),
            test_steps: Vec::new(),
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            attempts: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn rejects_dangling_dependencies_before_run() {
        let tasks = vec![task("Build UI", vec![TaskId::new()])];
        let error = validate_dependency_graph(&tasks).expect_err("graph should fail");
        assert!(error.contains("references missing tasks"));
    }

    #[test]
    fn rejects_dependency_cycles_before_run() {
        let mut first = task("First", Vec::new());
        let mut second = task("Second", vec![first.task_id]);
        first.dependency_ids = vec![second.task_id];
        // Keep both tasks in one project/spec; cycle detection only needs ids,
        // but realistic fixtures make future validation changes safe.
        second.project_id = first.project_id;
        second.spec_id = first.spec_id;
        let error = validate_dependency_graph(&[first, second]).expect_err("graph should fail");
        assert!(error.contains("contains a cycle"));
    }

    #[tokio::test]
    async fn promotes_roots_then_dependents_as_prerequisites_finish() {
        let (base_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
        let storage = StorageClient::with_base_url(&base_url);
        let project_id = ProjectId::new();
        let jwt = "test-jwt";
        let spec = storage
            .create_spec(
                &project_id.to_string(),
                jwt,
                &CreateSpecRequest {
                    title: "Plan".to_string(),
                    org_id: None,
                    order_index: Some(0),
                    markdown_contents: Some("# Plan".to_string()),
                },
            )
            .await
            .expect("spec");
        let root = storage
            .create_task(
                &project_id.to_string(),
                jwt,
                &CreateTaskRequest {
                    spec_id: spec.id.clone(),
                    title: "Root".to_string(),
                    org_id: None,
                    description: None,
                    status: Some("pending".to_string()),
                    order_index: Some(0),
                    dependency_ids: None,
                    assigned_project_agent_id: None,
                },
            )
            .await
            .expect("root");
        let dependent = storage
            .create_task(
                &project_id.to_string(),
                jwt,
                &CreateTaskRequest {
                    spec_id: spec.id,
                    title: "Dependent".to_string(),
                    org_id: None,
                    description: None,
                    status: Some("pending".to_string()),
                    order_index: Some(1),
                    dependency_ids: Some(vec![root.id.clone()]),
                    assigned_project_agent_id: None,
                },
            )
            .await
            .expect("dependent");

        let tasks = load_tasks(&storage, jwt, project_id).await.expect("tasks");
        let initial = promote_runnable_tasks(&storage, jwt, &tasks, None)
            .await
            .expect("initial promotion");
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].task_id.to_string(), root.id);

        aura_os_tasks::safe_transition(&storage, jwt, &root.id, TaskStatus::Done)
            .await
            .expect("complete root");
        let tasks = load_tasks(&storage, jwt, project_id).await.expect("tasks");
        let after_completion = promote_runnable_tasks(
            &storage,
            jwt,
            &tasks,
            Some(root.id.parse().expect("root id")),
        )
        .await
        .expect("dependent promotion");
        assert_eq!(after_completion.len(), 1);
        assert_eq!(after_completion[0].task_id.to_string(), dependent.id);
        assert_eq!(after_completion[0].status, TaskStatus::Ready);
    }
}
