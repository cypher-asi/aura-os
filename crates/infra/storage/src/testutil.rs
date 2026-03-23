/// Reusable in-memory mock aura-storage HTTP server for integration tests.
///
/// Supports sessions, tasks, specs, messages, and project agents. Use
/// [`start_mock_storage`] to spin up a server and get a base URL suitable
/// for `StorageClient::with_base_url`.
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{get, post, put},
    Json, Router,
};
use chrono::Utc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::types::*;

// ---------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct MockStorageDb {
    pub sessions: Vec<StorageSession>,
    pub tasks: Vec<StorageTask>,
    pub specs: Vec<StorageSpec>,
    pub messages: Vec<StorageMessage>,
    pub project_agents: Vec<StorageProjectAgent>,
}

pub type SharedDb = Arc<Mutex<MockStorageDb>>;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------

async fn create_session(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateSessionRequest>,
) -> Json<StorageSession> {
    let session = StorageSession {
        id: new_id(),
        project_agent_id: Some(project_agent_id),
        project_id: Some(req.project_id),
        status: req.status.or(Some("active".to_string())),
        context_usage_estimate: req.context_usage_estimate,
        summary_of_previous_context: req.summary_of_previous_context,
        tasks_worked_count: Some(0),
        ended_at: None,
        created_at: Some(Utc::now().to_rfc3339()),
        updated_at: Some(Utc::now().to_rfc3339()),
    };
    let mut db = db.lock().await;
    db.sessions.push(session.clone());
    Json(session)
}

async fn get_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageSession>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.sessions
        .iter()
        .find(|s| s.id == session_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

async fn update_session(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateSessionRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(session) = db.sessions.iter_mut().find(|s| s.id == session_id) {
        if let Some(status) = req.status {
            session.status = Some(status);
        }
        if let Some(usage) = req.context_usage_estimate {
            session.context_usage_estimate = Some(usage);
        }
        if let Some(count) = req.tasks_worked_count {
            session.tasks_worked_count = Some(count);
        }
        if let Some(ended) = req.ended_at {
            session.ended_at = Some(ended);
        }
        session.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

async fn list_sessions(
    Path(project_agent_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSession>> {
    let db = db.lock().await;
    let filtered: Vec<StorageSession> = db
        .sessions
        .iter()
        .filter(|s| s.project_agent_id.as_deref() == Some(project_agent_id.as_str()))
        .cloned()
        .collect();
    Json(filtered)
}

// ---------------------------------------------------------------------------
// Task handlers
// ---------------------------------------------------------------------------

async fn create_task(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateTaskRequest>,
) -> Json<StorageTask> {
    let now = Utc::now().to_rfc3339();
    let task = StorageTask {
        id: new_id(),
        project_id: Some(project_id),
        spec_id: Some(req.spec_id),
        title: Some(req.title),
        description: req.description,
        status: req.status.or(Some("pending".to_string())),
        order_index: req.order_index,
        dependency_ids: req.dependency_ids,
        execution_notes: None,
        files_changed: None,
        model: None,
        total_input_tokens: None,
        total_output_tokens: None,
        assigned_project_agent_id: None,
        session_id: None,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.tasks.push(task.clone());
    Json(task)
}

async fn get_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageTask>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.tasks
        .iter()
        .find(|t| t.id == task_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

async fn list_tasks(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageTask>> {
    let db = db.lock().await;
    let tasks: Vec<_> = db
        .tasks
        .iter()
        .filter(|t| t.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(tasks)
}

async fn update_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<UpdateTaskRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(task) = db.tasks.iter_mut().find(|t| t.id == task_id) {
        if let Some(v) = req.title {
            task.title = Some(v);
        }
        if let Some(v) = req.description {
            task.description = Some(v);
        }
        if let Some(v) = req.order_index {
            task.order_index = Some(v);
        }
        if let Some(v) = req.dependency_ids {
            task.dependency_ids = Some(v);
        }
        if let Some(v) = req.execution_notes {
            task.execution_notes = Some(v);
        }
        if let Some(v) = req.files_changed {
            task.files_changed = Some(v);
        }
        if let Some(v) = req.model {
            task.model = Some(v);
        }
        if let Some(v) = req.total_input_tokens {
            task.total_input_tokens = Some(v);
        }
        if let Some(v) = req.total_output_tokens {
            task.total_output_tokens = Some(v);
        }
        if let Some(v) = req.session_id {
            task.session_id = Some(v);
        }
        if let Some(v) = req.assigned_project_agent_id {
            task.assigned_project_agent_id = Some(v);
        }
        task.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

async fn transition_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<TransitionTaskRequest>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    if let Some(task) = db.tasks.iter_mut().find(|t| t.id == task_id) {
        task.status = Some(req.status);
        task.updated_at = Some(Utc::now().to_rfc3339());
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

async fn delete_task(
    Path(task_id): Path<String>,
    State(db): State<SharedDb>,
) -> axum::http::StatusCode {
    let mut db = db.lock().await;
    let len_before = db.tasks.len();
    db.tasks.retain(|t| t.id != task_id);
    if db.tasks.len() < len_before {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::NOT_FOUND
    }
}

// ---------------------------------------------------------------------------
// Spec handlers
// ---------------------------------------------------------------------------

async fn create_spec(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateSpecRequest>,
) -> Json<StorageSpec> {
    let now = Utc::now().to_rfc3339();
    let spec = StorageSpec {
        id: new_id(),
        project_id: Some(project_id),
        title: Some(req.title),
        order_index: req.order_index,
        markdown_contents: req.markdown_contents,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.specs.push(spec.clone());
    Json(spec)
}

async fn get_spec(
    Path(spec_id): Path<String>,
    State(db): State<SharedDb>,
) -> Result<Json<StorageSpec>, axum::http::StatusCode> {
    let db = db.lock().await;
    db.specs
        .iter()
        .find(|s| s.id == spec_id)
        .cloned()
        .map(Json)
        .ok_or(axum::http::StatusCode::NOT_FOUND)
}

async fn list_specs(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageSpec>> {
    let db = db.lock().await;
    let specs: Vec<_> = db
        .specs
        .iter()
        .filter(|s| s.project_id.as_deref() == Some(&project_id))
        .cloned()
        .collect();
    Json(specs)
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async fn create_message(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateMessageRequest>,
) -> Json<StorageMessage> {
    let msg = StorageMessage {
        id: new_id(),
        session_id: Some(session_id),
        project_agent_id: Some(req.project_agent_id),
        project_id: Some(req.project_id),
        role: Some(req.role),
        content: Some(req.content),
        content_blocks: req.content_blocks,
        input_tokens: req.input_tokens,
        output_tokens: req.output_tokens,
        thinking: req.thinking,
        thinking_duration_ms: req.thinking_duration_ms,
        created_at: Some(Utc::now().to_rfc3339()),
    };
    let mut db = db.lock().await;
    db.messages.push(msg.clone());
    Json(msg)
}

async fn list_messages(
    Path(session_id): Path<String>,
    State(db): State<SharedDb>,
) -> Json<Vec<StorageMessage>> {
    let db = db.lock().await;
    let msgs: Vec<_> = db
        .messages
        .iter()
        .filter(|m| m.session_id.as_deref() == Some(&session_id))
        .cloned()
        .collect();
    Json(msgs)
}

// ---------------------------------------------------------------------------
// Project Agent handlers
// ---------------------------------------------------------------------------

async fn create_project_agent(
    Path(project_id): Path<String>,
    State(db): State<SharedDb>,
    Json(req): Json<CreateProjectAgentRequest>,
) -> Json<StorageProjectAgent> {
    let now = Utc::now().to_rfc3339();
    let agent = StorageProjectAgent {
        id: new_id(),
        project_id: Some(project_id),
        agent_id: Some(req.agent_id),
        name: Some(req.name),
        role: req.role,
        personality: req.personality,
        system_prompt: req.system_prompt,
        skills: req.skills,
        icon: req.icon,
        status: Some("active".to_string()),
        model: None,
        total_input_tokens: None,
        total_output_tokens: None,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    };
    let mut db = db.lock().await;
    db.project_agents.push(agent.clone());
    Json(agent)
}

async fn list_project_agents(
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

async fn get_project_agent(
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

async fn update_project_agent(
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

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async fn health() -> axum::http::StatusCode {
    axum::http::StatusCode::OK
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Build the axum router for the mock storage server.
pub fn mock_storage_router(db: SharedDb) -> Router {
    Router::new()
        .route("/health", get(health))
        // Sessions
        .route(
            "/api/project-agents/:project_agent_id/sessions",
            post(create_session).get(list_sessions),
        )
        .route(
            "/api/sessions/:session_id",
            get(get_session).put(update_session),
        )
        // Tasks
        .route(
            "/api/projects/:project_id/tasks",
            post(create_task).get(list_tasks),
        )
        .route(
            "/api/tasks/:task_id",
            get(get_task).put(update_task).delete(delete_task),
        )
        .route("/api/tasks/:task_id/transition", post(transition_task))
        // Specs
        .route(
            "/api/projects/:project_id/specs",
            post(create_spec).get(list_specs),
        )
        .route("/api/specs/:spec_id", get(get_spec))
        // Messages
        .route(
            "/api/sessions/:session_id/messages",
            post(create_message).get(list_messages),
        )
        // Project Agents
        .route(
            "/api/projects/:project_id/agents",
            post(create_project_agent).get(list_project_agents),
        )
        .route(
            "/api/project-agents/:id",
            get(get_project_agent).put(update_project_agent),
        )
        .with_state(db)
}

/// Spin up a mock aura-storage HTTP server and return (base_url, shared_db).
///
/// The server runs in a background tokio task and listens on a random port.
/// Use the returned URL with `StorageClient::with_base_url`.
pub async fn start_mock_storage() -> (String, SharedDb) {
    let db: SharedDb = Arc::new(Mutex::new(MockStorageDb::default()));
    let app = mock_storage_router(db.clone());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock storage listener");
    let url = format!("http://{}", listener.local_addr().expect("get local addr"));
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    (url, db)
}
