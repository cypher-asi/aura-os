# Spec 08 — Backend HTTP API

## Purpose

Expose all domain operations over HTTP so the React interface (running in a webview) can interact with the Rust backend. This spec defines the Axum router, REST endpoints for every domain (settings, projects, specs, tasks, agents), WebSocket endpoint for real-time event streaming, request/response DTO types, and a consistent error format. CORS is configured for the webview origin.

---

## Core Concepts

### Server Architecture

The HTTP server runs as an Axum application bound to `127.0.0.1` on a configurable port (default: `3100`). It is started by the desktop shell (`src/main.rs`) before the webview opens. The interface connects to `http://localhost:3100`.

### Shared Application State

All handlers share an `AppState` struct injected via Axum's `State` extractor. This holds `Arc` references to every service.

### REST Conventions

- All request/response bodies are JSON.
- Successful responses return `200 OK` with a JSON body.
- Creation endpoints return `201 Created`.
- Deletion endpoints return `204 No Content`.
- Errors return a structured JSON error body with an HTTP status code.

### WebSocket for Events

A single WebSocket endpoint (`/ws/events`) streams `EngineEvent`s and other state changes to the interface. The interface subscribes once on load and receives all events as JSON messages. No per-topic filtering in MVP — the interface ignores events it doesn't care about.

---

## Interfaces

### Application State

```rust
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<RocksStore>,
    pub settings_service: Arc<SettingsService>,
    pub project_service: Arc<ProjectService>,
    pub spec_gen_service: Arc<SpecGenerationService>,
    pub task_extraction_service: Arc<TaskExtractionService>,
    pub task_service: Arc<TaskService>,
    pub agent_service: Arc<AgentService>,
    pub session_service: Arc<SessionService>,
    pub engine: Arc<tokio::sync::Mutex<Option<DevLoopEngine>>>,
    pub event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub event_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<EngineEvent>>>,
}
```

### Router

```rust
use axum::{Router, routing::{get, post, put, delete}};
use tower_http::cors::{CorsLayer, Any};

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Settings
        .route("/api/settings/api-key", post(set_api_key))
        .route("/api/settings/api-key", get(get_api_key_info))
        .route("/api/settings/api-key", delete(delete_api_key))
        .route("/api/settings/:key", get(get_setting))
        .route("/api/settings/:key", put(set_setting))

        // Projects
        .route("/api/projects", post(create_project))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/:project_id", get(get_project))
        .route("/api/projects/:project_id", put(update_project))
        .route("/api/projects/:project_id/archive", post(archive_project))

        // Specs
        .route("/api/projects/:project_id/specs", get(list_specs))
        .route("/api/projects/:project_id/specs/:spec_id", get(get_spec))
        .route("/api/projects/:project_id/specs/generate", post(generate_specs))

        // Tasks
        .route("/api/projects/:project_id/tasks", get(list_tasks))
        .route("/api/projects/:project_id/specs/:spec_id/tasks", get(list_tasks_by_spec))
        .route("/api/projects/:project_id/tasks/extract", post(extract_tasks))
        .route("/api/projects/:project_id/tasks/:task_id/transition", post(transition_task))
        .route("/api/projects/:project_id/tasks/:task_id/retry", post(retry_task))
        // Agents
        .route("/api/projects/:project_id/agents", get(list_agents))
        .route("/api/projects/:project_id/agents/:agent_id", get(get_agent))
        .route("/api/projects/:project_id/agents/:agent_id/sessions", get(list_sessions))

        // Dev Loop Control
        .route("/api/projects/:project_id/loop/start", post(start_loop))
        .route("/api/projects/:project_id/loop/pause", post(pause_loop))
        .route("/api/projects/:project_id/loop/stop", post(stop_loop))

        // Social / Analytics (proxied from aura-network)
        .route("/api/leaderboard", get(get_leaderboard))
        .route("/api/stats", get(get_platform_stats))
        .route("/api/users/me/usage", get(get_personal_usage))
        .route("/api/orgs/:org_id/usage", get(get_org_usage))
        .route("/api/orgs/:org_id/usage/members", get(get_org_usage_members))

        // WebSocket
        .route("/ws/events", get(ws_events))

        .layer(cors)
        .with_state(state)
}
```

### Request / Response DTOs

```rust
use serde::{Deserialize, Serialize};

// --- Settings ---

#[derive(Debug, Deserialize)]
pub struct SetApiKeyRequest {
    pub api_key: String,
}

// Response: ApiKeyInfo (from Spec 03)

#[derive(Debug, Deserialize)]
pub struct SetSettingRequest {
    pub value: String,
}

// --- Projects ---

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub requirements_doc_path: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub requirements_doc_path: Option<String>,
}

// Response: Project entity directly

// --- Tasks ---

#[derive(Debug, Deserialize)]
pub struct TransitionTaskRequest {
    pub new_status: TaskStatus,
}

// Response: Task entity directly

// --- Loop ---

#[derive(Debug, Serialize)]
pub struct LoopStatusResponse {
    pub running: bool,
    pub paused: bool,
    pub project_id: Option<ProjectId>,
    pub agent_id: Option<AgentId>,
    pub session_number: Option<usize>,
}
```

### Error Response Format

```rust
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: String,
    pub code: String,
    pub details: Option<String>,
}

impl ApiError {
    pub fn not_found(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (StatusCode::NOT_FOUND, Json(Self {
            error: msg.into(),
            code: "not_found".to_string(),
            details: None,
        }))
    }

    pub fn bad_request(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (StatusCode::BAD_REQUEST, Json(Self {
            error: msg.into(),
            code: "bad_request".to_string(),
            details: None,
        }))
    }

    pub fn internal(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(Self {
            error: msg.into(),
            code: "internal_error".to_string(),
            details: None,
        }))
    }

    pub fn conflict(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (StatusCode::CONFLICT, Json(Self {
            error: msg.into(),
            code: "conflict".to_string(),
            details: None,
        }))
    }
}
```

### Handler Examples

```rust
async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> Result<(StatusCode, Json<Project>), (StatusCode, Json<ApiError>)> {
    let input = CreateProjectInput {
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        requirements_doc_path: req.requirements_doc_path,
    };
    let project = state.project_service
        .create_project(input)
        .map_err(|e| match e {
            ProjectError::InvalidInput(msg) => ApiError::bad_request(msg),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok((StatusCode::CREATED, Json(project)))
}

async fn generate_specs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> Result<Json<Vec<Spec>>, (StatusCode, Json<ApiError>)> {
    let specs = state.spec_gen_service
        .generate_specs(&project_id)
        .await
        .map_err(|e| match e {
            SpecGenError::ProjectNotFound(_) => ApiError::not_found("project not found"),
            SpecGenError::RequirementsFileNotFound(p) =>
                ApiError::bad_request(format!("requirements file not found: {p}")),
            SpecGenError::Settings(_) =>
                ApiError::bad_request("API key not configured"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(specs))
}

async fn start_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> Result<Json<LoopStatusResponse>, (StatusCode, Json<ApiError>)> {
    // Build and start the engine
    // Store LoopHandle in AppState for pause/stop
    // Return current status
}
```

### WebSocket Handler

```rust
use axum::extract::ws::{WebSocket, WebSocketUpgrade, Message};
use tokio::sync::broadcast;

async fn ws_events(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    // Subscribe to the event broadcast channel
    let mut rx = state.event_broadcast.subscribe();

    loop {
        tokio::select! {
            Ok(event) = rx.recv() => {
                let json = serde_json::to_string(&event).unwrap_or_default();
                if socket.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}
```

---

## Endpoint Summary

### Settings

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/api/settings/api-key` | `set_api_key` | Store/update Claude API key |
| `GET` | `/api/settings/api-key` | `get_api_key_info` | Get masked key + status |
| `DELETE` | `/api/settings/api-key` | `delete_api_key` | Remove stored API key |
| `GET` | `/api/settings/:key` | `get_setting` | Get a plain setting value |
| `PUT` | `/api/settings/:key` | `set_setting` | Set a plain setting value |

### Projects

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/api/projects` | `create_project` | Create a new project |
| `GET` | `/api/projects` | `list_projects` | List all projects |
| `GET` | `/api/projects/:project_id` | `get_project` | Get project details |
| `PUT` | `/api/projects/:project_id` | `update_project` | Update project fields |
| `POST` | `/api/projects/:project_id/archive` | `archive_project` | Archive a project |

### Specs

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/projects/:project_id/specs` | `list_specs` | List specs for a project (ordered) |
| `GET` | `/api/projects/:project_id/specs/:spec_id` | `get_spec` | Get a single spec |
| `POST` | `/api/projects/:project_id/specs/generate` | `generate_specs` | Generate specs from requirements |

### Tasks

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/projects/:project_id/tasks` | `list_tasks` | List all tasks for a project |
| `GET` | `/api/projects/:project_id/specs/:spec_id/tasks` | `list_tasks_by_spec` | List tasks for a specific spec |
| `POST` | `/api/projects/:project_id/tasks/extract` | `extract_tasks` | Extract tasks from all specs |
| `POST` | `/api/projects/:project_id/tasks/:task_id/transition` | `transition_task` | Transition task status |
| `POST` | `/api/projects/:project_id/tasks/:task_id/retry` | `retry_task` | Retry a failed task |

### Agents & Sessions

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/projects/:project_id/agents` | `list_agents` | List agents for project |
| `GET` | `/api/projects/:project_id/agents/:agent_id` | `get_agent` | Get agent details |
| `GET` | `/api/projects/:project_id/agents/:agent_id/sessions` | `list_sessions` | List sessions for agent |

### Dev Loop

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/api/projects/:project_id/loop/start` | `start_loop` | Start autonomous dev loop |
| `POST` | `/api/projects/:project_id/loop/pause` | `pause_loop` | Pause the dev loop |
| `POST` | `/api/projects/:project_id/loop/stop` | `stop_loop` | Stop the dev loop |

### Social / Analytics (proxied from aura-network)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/leaderboard` | `get_leaderboard` | Leaderboard entries (tokens, cost, events) |
| `GET` | `/api/stats` | `get_platform_stats` | Platform-wide stats (DAU, users, revenue) |
| `GET` | `/api/users/me/usage` | `get_personal_usage` | Personal token usage and cost |
| `GET` | `/api/orgs/:org_id/usage` | `get_org_usage` | Org-wide token usage and cost |
| `GET` | `/api/orgs/:org_id/usage/members` | `get_org_usage_members` | Per-member usage within an org |

### WebSocket

| Path | Description |
|------|-------------|
| `/ws/events` | Real-time event stream (EngineEvent JSON messages) |

---

## Key Behaviors

1. **Consistent error mapping** — each service error type maps to an HTTP status: `NotFound` -> 404, `InvalidInput` / `IllegalTransition` -> 400, `Conflict` -> 409, everything else -> 500.
2. **Path parameter parsing** — `ProjectId`, `SpecId`, `TaskId`, `AgentId` parse from URL path segments via `FromStr` (UUID format). Invalid UUIDs return 400.
3. **Async handlers** — spec generation, task extraction, and loop start are async (they call Claude). Other handlers are synchronous reads/writes.
4. **WebSocket fan-out** — the engine writes events to an `mpsc` channel. The server rebroadcasts via a `tokio::sync::broadcast` channel to all connected WebSocket clients.
5. **CORS** — allows all origins, methods, and headers for MVP (webview runs on a local origin like `tauri://localhost` or `http://localhost`).
6. **No authentication** — the MVP is a single-user local app. No auth middleware needed.
7. **Graceful shutdown** — the server listens for a shutdown signal (Ctrl+C or webview close) and drains active connections before exiting.
8. **Loop singleton** — only one dev loop can run at a time. Starting a loop while one is already running returns 409 Conflict.

---

## Dependencies

| Spec | What is used |
|------|-------------|
| Spec 01 | All entity types for response bodies |
| Spec 02 | `RocksStore` (indirectly via services) |
| Spec 03 | `SettingsService` for API key endpoints |
| Spec 04 | `ProjectService`, `SpecGenerationService` |
| Spec 05 | `TaskService`, `TaskExtractionService` |
| Spec 06 | `AgentService`, `SessionService` |
| Spec 07 | `DevLoopEngine`, `EngineEvent`, `LoopHandle` |

**External crates:**

| Crate | Version | Purpose |
|-------|---------|---------|
| `axum` | 0.7.x | HTTP framework |
| `tower-http` | 0.5.x | CORS middleware |
| `tokio` | 1.x | Async runtime, channels, WebSocket |
| `serde_json` | 1.x | JSON serialization |

---

## Tasks

| ID | Task | Description |
|----|------|-------------|
| T08.1 | Create `aura-os-server` crate | New crate, add to workspace, depend on all service crates + axum |
| T08.2 | Implement `AppState` | Struct holding all `Arc<Service>` references |
| T08.3 | Implement `create_router` | Wire all routes with CORS |
| T08.4 | Implement settings handlers | `set_api_key`, `get_api_key_info`, `delete_api_key`, `get_setting`, `set_setting` |
| T08.5 | Implement project handlers | `create_project`, `list_projects`, `get_project`, `update_project`, `archive_project` |
| T08.6 | Implement spec handlers | `list_specs`, `get_spec`, `generate_specs` |
| T08.7 | Implement task handlers | `list_tasks`, `list_tasks_by_spec`, `extract_tasks`, `transition_task`, `retry_task` |
| T08.8 | Implement agent handlers | `list_agents`, `get_agent`, `list_sessions` |
| T08.9 | Implement loop control handlers | `start_loop`, `pause_loop`, `stop_loop` with singleton guard |
| T08.10 | Implement `ApiError` and error mapping | Consistent error responses from service errors |
| T08.11 | Implement WebSocket handler | `ws_events` with broadcast subscription |
| T08.12 | Implement event rebroadcast | `mpsc` -> `broadcast` bridge for fan-out |
| T08.13 | Integration tests — project CRUD | HTTP tests: create, list, get, update, archive |
| T08.14 | Integration tests — full pipeline | Create project, generate specs, extract tasks, start loop (mocked Claude) |
| T08.15 | Integration tests — WebSocket | Connect WS, start loop, verify events received |
| T08.16 | Integration tests — error responses | Invalid inputs return correct status codes and error format |
| T08.17 | Clippy + fmt clean | All crates pass |

---

## Test Criteria

All of the following must pass before proceeding to Spec 09:

- [ ] All CRUD endpoints return correct status codes and JSON bodies
- [ ] Invalid path parameters (bad UUIDs) return 400
- [ ] Not-found entities return 404
- [ ] `generate_specs` endpoint triggers spec generation and returns specs
- [ ] `extract_tasks` endpoint triggers task extraction and returns tasks
- [ ] `start_loop` returns 201; calling it again returns 409
- [ ] `pause_loop` and `stop_loop` work when loop is running
- [ ] WebSocket client receives `EngineEvent` JSON messages
- [ ] Error responses follow the `ApiError` schema consistently
- [ ] CORS headers are present on all responses
- [ ] Clippy and fmt are clean
