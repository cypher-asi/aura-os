use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;

use crate::types::*;

use super::db::{new_id, SharedDb};

pub(super) async fn create_project_agent(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateProjectAgentRequest>,
) -> Json<StorageProjectAgent> {
    let now = Utc::now().to_rfc3339();
    let agent = StorageProjectAgent {
        id: new_id(),
        project_id: Some(project_id),
        org_id: req.org_id,
        agent_id: Some(req.agent_id),
        name: Some(req.name),
        role: req.role,
        personality: req.personality,
        system_prompt: req.system_prompt,
        skills: req.skills,
        icon: req.icon,
        harness: req.harness,
        status: Some("active".to_string()),
        model: None,
        total_input_tokens: None,
        total_output_tokens: None,
        instance_role: req.instance_role,
        permissions: req.permissions,
        intent_classifier: req.intent_classifier,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.project_agents.push(agent.clone());
    Json(agent)
}

pub(super) async fn list_project_agents(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageProjectAgent>> {
    let db = db.lock().await;
    let agents: Vec<_> = db
        .project_agents
        .iter()
        .filter(|a| a.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(agents)
}

pub(super) async fn get_project_agent(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageProjectAgent>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.project_agents
        .iter()
        .find(|a| a.id == project_agent_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

pub(super) async fn update_project_agent(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateProjectAgentRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(agent) = db
        .project_agents
        .iter_mut()
        .find(|a| a.id == project_agent_id)
    {
        agent.status = Some(req.status);
        agent.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

pub(super) async fn delete_project_agent(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let before = db.project_agents.len();
    db.project_agents.retain(|a| a.id != project_agent_id);
    if db.project_agents.len() < before {
        axum::http::StatusCode::NO_CONTENT
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}
