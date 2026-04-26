//! End-to-end project setup -> chat -> task execution.

use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionEventRequest, CreateSessionRequest, CreateSpecRequest,
    CreateTaskRequest, TransitionTaskRequest,
};

use super::{client, JWT};

#[tokio::test]
async fn end_to_end_project_chat_and_task_flow() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let pa = sc
        .create_project_agent(
            &pid,
            JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Aura".into(),
                org_id: None,
                role: None,
                instance_role: None,
                personality: None,
                system_prompt: None,
                skills: None,
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .unwrap();

    let session = sc
        .create_session(
            &pa.id,
            JWT,
            &CreateSessionRequest {
                project_id: pid.clone(),
                org_id: None,
                model: None,
                status: Some("active".into()),
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    sc.create_event(
        &session.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "user_message".into(),
            sender: Some("user".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pa.id.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"text": "Create specs for a todo app"})),
            session_id: Some(session.id.clone()),
        },
    )
    .await
    .unwrap();

    sc.create_event(
        &session.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "assistant_message_end".into(),
            sender: Some("agent".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pa.id.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"text": "Created two specs.", "seq": 1})),
            session_id: Some(session.id.clone()),
        },
    )
    .await
    .unwrap();

    let spec = sc
        .create_spec(
            &pid,
            JWT,
            &CreateSpecRequest {
                title: "01: Core CRUD".into(),
                org_id: None,
                order_index: Some(1),
                markdown_contents: Some("# CRUD\n\nCreate, read, update, delete.".into()),
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
                title: "Implement todo model".into(),
                org_id: None,
                description: Some("Create the Todo struct.".into()),
                status: Some("pending".into()),
                order_index: Some(1),
                dependency_ids: None,
                assigned_project_agent_id: None,
            },
        )
        .await
        .unwrap();

    sc.transition_task(
        &task.id,
        JWT,
        &TransitionTaskRequest {
            status: "in_progress".into(),
        },
    )
    .await
    .unwrap();

    sc.create_event(
        &session.id,
        JWT,
        &CreateSessionEventRequest {
            event_type: "task_output".into(),
            sender: Some("agent".into()),
            project_id: Some(pid.clone()),
            agent_id: Some(pa.id.clone()),
            org_id: None,
            user_id: None,
            content: Some(serde_json::json!({"task_id": task.id, "text": "Created Todo struct."})),
            session_id: Some(session.id.clone()),
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

    let events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert_eq!(events.len(), 3);

    let specs = sc.list_specs(&pid, JWT).await.unwrap();
    assert_eq!(specs.len(), 1);

    let final_task = sc.get_task(&task.id, JWT).await.unwrap();
    assert_eq!(final_task.status.as_deref(), Some("done"));
}
