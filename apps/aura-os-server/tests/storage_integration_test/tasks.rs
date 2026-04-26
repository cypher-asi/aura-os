//! Spec and Task CRUD/transition lifecycles.

use aura_os_storage::types::UpdateSpecRequest;
use aura_os_storage::{
    CreateSpecRequest, CreateTaskRequest, StorageTaskFileChangeSummary, TransitionTaskRequest,
    UpdateTaskRequest,
};

use super::{client, JWT};

#[tokio::test]
async fn spec_crud_lifecycle() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let spec1 = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "01: User Authentication".into(),
                org_id: None,
                order_index: Some(1),
                markdown_contents: Some("# User Auth\n\nLogin/register flow.".into()),
            },
        )
        .await
        .unwrap();

    let _spec2 = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "02: Dashboard".into(),
                org_id: None,
                order_index: Some(2),
                markdown_contents: Some("# Dashboard".into()),
            },
        )
        .await
        .unwrap();

    let specs = sc.list_specs(&pid, JWT).await.unwrap();
    assert_eq!(specs.len(), 2);

    let fetched = sc.get_spec(&spec1.id, JWT).await.unwrap();
    assert_eq!(fetched.title.as_deref(), Some("01: User Authentication"));
    assert_eq!(
        fetched.markdown_contents.as_deref(),
        Some("# User Auth\n\nLogin/register flow.")
    );

    sc.update_spec(
        &spec1.id,
        JWT,
        &UpdateSpecRequest {
            title: Some("01: Auth Updated".into()),
            order_index: Some(3),
            markdown_contents: Some("# Updated Auth".into()),
        },
    )
    .await
    .unwrap();

    let updated = sc.get_spec(&spec1.id, JWT).await.unwrap();
    assert_eq!(updated.title.as_deref(), Some("01: Auth Updated"));
    assert_eq!(updated.order_index, Some(3));
    assert_eq!(updated.markdown_contents.as_deref(), Some("# Updated Auth"));

    sc.delete_spec(&spec1.id, JWT).await.unwrap();
    let specs = sc.list_specs(&pid, JWT).await.unwrap();
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].title.as_deref(), Some("02: Dashboard"));
}

#[tokio::test]
async fn task_crud_and_transition_lifecycle() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let spec = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "Spec for tasks".into(),
                org_id: None,
                order_index: Some(1),
                markdown_contents: None,
            },
        )
        .await
        .unwrap();

    let task = sc
        .create_task(
            &pid,
            JWT,
            &CreateTaskRequest {
                spec_id: spec.id.clone(),
                title: "Implement login form".into(),
                org_id: None,
                description: Some("Build the login component.".into()),
                status: Some("pending".into()),
                order_index: Some(1),
                dependency_ids: None,
                assigned_project_agent_id: None,
            },
        )
        .await
        .unwrap();

    let task2 = sc
        .create_task(
            &pid,
            JWT,
            &CreateTaskRequest {
                spec_id: spec.id.clone(),
                title: "Add validation".into(),
                org_id: None,
                description: Some("Form validation rules.".into()),
                status: Some("pending".into()),
                order_index: Some(2),
                dependency_ids: Some(vec![task.id.clone()]),
                assigned_project_agent_id: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(sc.list_tasks(&pid, JWT).await.unwrap().len(), 2);
    assert_eq!(
        sc.get_task(&task.id, JWT).await.unwrap().title.as_deref(),
        Some("Implement login form")
    );

    sc.update_task(
        &task.id,
        JWT,
        &UpdateTaskRequest {
            title: None,
            description: None,
            order_index: None,
            dependency_ids: None,
            execution_notes: Some("Done in 3 turns.".into()),
            files_changed: Some(vec![StorageTaskFileChangeSummary {
                op: "create".into(),
                path: "src/Login.tsx".into(),
                lines_added: 50,
                lines_removed: 0,
            }]),
            model: Some("claude-sonnet-4-20250514".into()),
            total_input_tokens: Some(15000),
            total_output_tokens: Some(8000),
            session_id: Some("session-1".into()),
            assigned_project_agent_id: Some("agent-1".into()),
        },
    )
    .await
    .unwrap();

    sc.transition_task(
        &task.id,
        JWT,
        &TransitionTaskRequest {
            status: "done".into(),
        },
    )
    .await
    .unwrap();

    let done_task = sc.get_task(&task.id, JWT).await.unwrap();
    assert_eq!(done_task.status.as_deref(), Some("done"));
    assert_eq!(
        done_task.execution_notes.as_deref(),
        Some("Done in 3 turns.")
    );

    sc.delete_task(&task.id, JWT).await.unwrap();
    sc.delete_task(&task2.id, JWT).await.unwrap();
    let remaining = sc.list_tasks(&pid, JWT).await.unwrap();
    assert!(remaining.is_empty(), "tasks should be deleted");
}
