//! Health check, project agent CRUD, and validation/error edge cases.

use aura_os_storage::{
    CreateProjectAgentRequest, CreateSessionRequest, CreateSpecRequest, UpdateProjectAgentRequest,
};

use super::{client, JWT};

#[tokio::test]
async fn health_check_succeeds() {
    let sc = client().await;
    sc.health_check().await.expect("health check should pass");
}

#[tokio::test]
async fn project_agent_create_list_get_update_delete() {
    let sc = client().await;
    let pid = uuid::Uuid::new_v4().to_string();

    let pa = sc
        .create_project_agent(
            &pid,
            JWT,
            &CreateProjectAgentRequest {
                agent_id: uuid::Uuid::new_v4().to_string(),
                name: "Aura Chat Agent".into(),
                org_id: None,
                role: Some("developer".into()),
                instance_role: None,
                personality: Some("helpful".into()),
                system_prompt: Some("You are a helpful assistant.".into()),
                skills: Some(vec!["code".into(), "plan".into()]),
                icon: None,
                harness: None,
                permissions: None,
                intent_classifier: None,
            },
        )
        .await
        .expect("create project agent");

    assert!(!pa.id.is_empty());
    assert_eq!(pa.name.as_deref(), Some("Aura Chat Agent"));
    assert_eq!(pa.project_id.as_deref(), Some(pid.as_str()));

    let agents = sc
        .list_project_agents(&pid, JWT)
        .await
        .expect("list project agents");
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].id, pa.id);

    let fetched = sc
        .get_project_agent(&pa.id, JWT)
        .await
        .expect("get project agent");
    assert_eq!(fetched.id, pa.id);

    sc.update_project_agent_status(
        &pa.id,
        JWT,
        &UpdateProjectAgentRequest {
            status: "working".into(),
        },
    )
    .await
    .expect("update status");
}

#[tokio::test]
async fn get_nonexistent_entities_return_errors() {
    let sc = client().await;
    assert!(sc.get_session("nonexistent", JWT).await.is_err());
    assert!(sc.get_task("nonexistent", JWT).await.is_err());
    assert!(sc.get_spec("nonexistent", JWT).await.is_err());
    assert!(sc.get_project_agent("nonexistent", JWT).await.is_err());
}

#[tokio::test]
async fn empty_id_rejected_by_validation() {
    let sc = client().await;
    assert!(sc
        .create_spec(
            "",
            JWT,
            &CreateSpecRequest {
                title: "test".into(),
                org_id: None,
                order_index: None,
                markdown_contents: None,
            }
        )
        .await
        .is_err());
    assert!(sc.list_sessions("", JWT).await.is_err());
    assert!(sc.list_events("", JWT, None, None).await.is_err());
}

#[tokio::test]
async fn list_events_empty_session_returns_empty() {
    let sc = client().await;
    let pai = uuid::Uuid::new_v4().to_string();
    let session = sc
        .create_session(
            &pai,
            JWT,
            &CreateSessionRequest {
                project_id: "p1".into(),
                org_id: None,
                model: None,
                status: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
            },
        )
        .await
        .unwrap();

    let events = sc.list_events(&session.id, JWT, None, None).await.unwrap();
    assert!(events.is_empty());
}
