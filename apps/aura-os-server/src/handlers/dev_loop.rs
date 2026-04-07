use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use std::sync::Arc;
use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, SessionId, TaskId, TaskStatus};
use aura_os_link::{connect_with_retries, AutomatonStartError, AutomatonStartParams};
use aura_os_network::{NetworkClient, ReportUsageRequest};
use aura_os_sessions::{CreateSessionParams, UpdateContextUsageParams};
use aura_os_storage::StorageTaskFileChangeSummary;
use aura_os_tasks::TaskService;

use super::projects_helpers::resolve_agent_instance_workspace_path;
use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org,
};
use crate::persistence;
use crate::state::{
    ActiveAutomaton, AppState, AuthJwt, AutomatonRegistry, CachedTaskOutput, TaskOutputCache,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VerificationStepKind {
    Build,
    Test,
}

/// Resolve the effective git clone URL for a project. If `git_repo_url` is set,
/// use it directly. Otherwise construct from `orbit_base_url` (or `ORBIT_BASE_URL`
/// env var) combined with `orbit_owner` / `orbit_repo`.
fn resolve_git_repo_url(project: Option<&aura_os_core::Project>) -> Option<String> {
    let p = project?;
    if let Some(ref url) = p.git_repo_url {
        if !url.is_empty() {
            return Some(url.clone());
        }
    }
    let owner = p.orbit_owner.as_deref().filter(|s| !s.is_empty())?;
    let repo = p.orbit_repo.as_deref().filter(|s| !s.is_empty())?;
    let base = p
        .orbit_base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| std::env::var("ORBIT_BASE_URL").ok())
        .filter(|s| !s.is_empty())?;
    let base = base.trim_end_matches('/');
    Some(format!("{base}/{owner}/{repo}.git"))
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

/// Broadcast a synthetic domain event as JSON on the global event channel.
fn emit_domain_event(
    broadcast_tx: &tokio::sync::broadcast::Sender<serde_json::Value>,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let (Some(base), Some(ext)) = (event.as_object_mut(), extra.as_object()) {
        for (k, v) in ext {
            base.insert(k.clone(), v.clone());
        }
    }
    let _ = broadcast_tx.send(event);
}

fn automaton_is_active(status: &serde_json::Value) -> bool {
    if let Some(running) = status.get("running").and_then(|v| v.as_bool()) {
        return running;
    }
    let state = status
        .get("state")
        .or_else(|| status.get("status"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_ascii_lowercase());
    match state.as_deref() {
        // Paused loops are still active for singleton semantics.
        Some("running" | "active" | "started" | "paused") => true,
        Some(
            "done" | "stopped" | "finished" | "failed" | "cancelled" | "terminated" | "completed",
        ) => false,
        // Unknown schema/state: stay conservative and treat as active.
        _ => true,
    }
}

fn automaton_client_for_mode(
    state: &AppState,
    mode: HarnessMode,
    swarm_agent_id: Option<&str>,
    jwt: Option<&str>,
) -> Result<std::sync::Arc<aura_os_link::AutomatonClient>, (StatusCode, Json<ApiError>)> {
    match mode {
        HarnessMode::Local => Ok(state.automaton_client.clone()),
        HarnessMode::Swarm => {
            let base = state
                .swarm_base_url
                .as_deref()
                .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?;
            let base = base.trim_end_matches('/');
            let scoped_base = match swarm_agent_id {
                Some(aid) => format!("{base}/v1/agents/{aid}"),
                None => base.to_string(),
            };
            let client =
                aura_os_link::AutomatonClient::new(&scoped_base).with_auth(jwt.map(String::from));
            Ok(std::sync::Arc::new(client))
        }
    }
}

fn extract_run_command(event: &serde_json::Value) -> Option<String> {
    if event.get("name").and_then(|value| value.as_str()) != Some("run_command") {
        return None;
    }

    let input = event.get("input")?;
    if let Some(command) = input.get("command").and_then(|value| value.as_str()) {
        let command = command.trim();
        if !command.is_empty() {
            return Some(command.to_string());
        }
    }

    let program = input
        .get("program")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let args: Vec<&str> = input
        .get("args")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().filter_map(|value| value.as_str()).collect())
        .unwrap_or_default();

    if args.is_empty() {
        Some(program.to_string())
    } else {
        Some(format!("{program} {}", args.join(" ")))
    }
}

fn classify_run_command_steps(
    event_type: &str,
    event: &serde_json::Value,
) -> Vec<VerificationStepKind> {
    if !matches!(event_type, "tool_call_snapshot" | "tool_call_completed") {
        return Vec::new();
    }

    let Some(command) = extract_run_command(event) else {
        return Vec::new();
    };
    let normalized = command.to_ascii_lowercase();

    let build_markers = [
        "npm run build",
        "npm build",
        "pnpm run build",
        "pnpm build",
        "yarn run build",
        "yarn build",
        "bun run build",
        "bun build",
        "cargo build",
        "cargo check",
        "go build",
        "vite build",
        "next build",
        "turbo build",
        "mvn package",
        "mvn verify",
        "gradle build",
        "./gradlew build",
        "make build",
        "tsc",
    ];
    let test_markers = [
        "npm run test",
        "npm test",
        "pnpm run test",
        "pnpm test",
        "yarn run test",
        "yarn test",
        "bun run test",
        "bun test",
        "cargo test",
        "cargo nextest",
        "pytest",
        "go test",
        "vitest",
        "jest",
        "playwright test",
        "mvn test",
        "gradle test",
        "./gradlew test",
        "tox",
        "rspec",
    ];

    let mut kinds = Vec::new();
    if build_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        kinds.push(VerificationStepKind::Build);
    }
    if test_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        kinds.push(VerificationStepKind::Test);
    }
    kinds
}

#[derive(Clone, Debug, Default)]
struct TurnUsageSnapshot {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    cumulative_input_tokens: Option<u64>,
    cumulative_output_tokens: Option<u64>,
    cumulative_cache_creation_input_tokens: Option<u64>,
    cumulative_cache_read_input_tokens: Option<u64>,
    estimated_context_tokens: Option<u64>,
    context_utilization: Option<f64>,
    model: Option<String>,
    provider: Option<String>,
}

fn usage_payload(event: &serde_json::Value) -> &serde_json::Value {
    event.get("usage").unwrap_or(event)
}

fn extract_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(serde_json::Value::as_u64)
}

fn extract_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn extract_turn_usage(event: &serde_json::Value) -> Option<TurnUsageSnapshot> {
    let usage = usage_payload(event);
    let input_tokens = extract_u64(usage, "input_tokens")?;
    let output_tokens = extract_u64(usage, "output_tokens")?;

    Some(TurnUsageSnapshot {
        input_tokens,
        output_tokens,
        cache_creation_input_tokens: extract_u64(usage, "cache_creation_input_tokens")
            .unwrap_or_default(),
        cache_read_input_tokens: extract_u64(usage, "cache_read_input_tokens").unwrap_or_default(),
        cumulative_input_tokens: extract_u64(usage, "cumulative_input_tokens"),
        cumulative_output_tokens: extract_u64(usage, "cumulative_output_tokens"),
        cumulative_cache_creation_input_tokens: extract_u64(
            usage,
            "cumulative_cache_creation_input_tokens",
        ),
        cumulative_cache_read_input_tokens: extract_u64(
            usage,
            "cumulative_cache_read_input_tokens",
        ),
        estimated_context_tokens: extract_u64(usage, "estimated_context_tokens"),
        context_utilization: usage
            .get("context_utilization")
            .and_then(serde_json::Value::as_f64),
        model: extract_string(usage, "model"),
        provider: extract_string(usage, "provider"),
    })
}

fn extract_token_usage(event: &serde_json::Value) -> Option<(u64, u64)> {
    let usage = extract_turn_usage(event)?;
    Some((usage.input_tokens, usage.output_tokens))
}

fn extract_files_changed(event: &serde_json::Value) -> Vec<StorageTaskFileChangeSummary> {
    let Some(files_changed) = event.get("files_changed") else {
        return Vec::new();
    };

    [
        ("create", "created"),
        ("modify", "modified"),
        ("delete", "deleted"),
    ]
    .into_iter()
    .flat_map(|(op, key)| {
        files_changed
            .get(key)
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(move |value| {
                value.as_str().map(|path| StorageTaskFileChangeSummary {
                    op: op.to_string(),
                    path: path.to_string(),
                    lines_added: 0,
                    lines_removed: 0,
                })
            })
    })
    .collect()
}

fn default_fee_schedule() -> [(&'static str, f64, f64); 3] {
    [
        ("claude-opus-4-6", 5.0, 25.0),
        ("claude-sonnet-4-5", 3.0, 15.0),
        ("claude-haiku-4-5", 0.80, 4.00),
    ]
}

#[derive(Clone, Copy, Debug)]
struct ModelRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

fn lookup_model_rates(model: &str) -> ModelRates {
    let normalized_model = model.trim().to_ascii_lowercase();
    let mut exact: Vec<_> = default_fee_schedule()
        .into_iter()
        .filter(|(candidate, _, _)| *candidate == normalized_model)
        .collect();
    if let Some((_, input, output)) = exact.pop() {
        return ModelRates {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: input * 0.10,
        };
    }

    let mut partial: Vec<_> = default_fee_schedule()
        .into_iter()
        .filter(|(candidate, _, _)| {
            normalized_model.starts_with(candidate) || candidate.starts_with(&normalized_model)
        })
        .collect();
    if let Some((_, input, output)) = partial.pop() {
        return ModelRates {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: input * 0.10,
        };
    }

    default_fee_schedule()
        .into_iter()
        .next()
        .map(|(_, input, output)| ModelRates {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: input * 0.10,
        })
        .unwrap_or(ModelRates {
            input: 5.0,
            output: 25.0,
            cache_write: 6.25,
            cache_read: 0.5,
        })
}

fn estimate_usage_cost_usd(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
) -> f64 {
    let rates = lookup_model_rates(model);
    input_tokens as f64 * rates.input / 1_000_000.0
        + output_tokens as f64 * rates.output / 1_000_000.0
        + cache_creation_input_tokens as f64 * rates.cache_write / 1_000_000.0
        + cache_read_input_tokens as f64 * rates.cache_read / 1_000_000.0
}

#[derive(Clone)]
struct UsageReportingContext {
    network_client: Arc<NetworkClient>,
    access_token: String,
    network_user_id: String,
    model: String,
    org_id: Option<String>,
}

async fn report_automaton_usage(
    usage: &UsageReportingContext,
    project_id: ProjectId,
    turn_usage: &TurnUsageSnapshot,
) {
    let model = turn_usage.model.as_deref().unwrap_or(&usage.model);
    let estimated_cost_usd = estimate_usage_cost_usd(
        model,
        turn_usage.input_tokens,
        turn_usage.output_tokens,
        turn_usage.cache_creation_input_tokens,
        turn_usage.cache_read_input_tokens,
    );
    let req = ReportUsageRequest {
        user_id: usage.network_user_id.clone(),
        model: model.to_string(),
        input_tokens: turn_usage.input_tokens,
        output_tokens: turn_usage.output_tokens,
        estimated_cost_usd,
        org_id: usage.org_id.clone(),
        agent_id: None,
        project_id: Some(project_id.to_string()),
        duration_ms: None,
    };

    if let Err(error) = usage
        .network_client
        .report_usage(&req, &usage.access_token)
        .await
    {
        warn!(%project_id, model, %error, "Failed to report automaton usage");
    }
}

async fn create_automaton_session(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    active_task_id: Option<TaskId>,
    jwt: Option<&str>,
) -> Option<SessionId> {
    let model = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .ok()
        .and_then(|instance| instance.model);
    let user_id = jwt
        .and_then(|j| state.validation_cache.get(j))
        .map(|entry| entry.session.user_id.clone());

    match state
        .session_service
        .create_session(CreateSessionParams {
            agent_instance_id,
            project_id,
            active_task_id,
            summary: String::new(),
            user_id,
            model,
        })
        .await
    {
        Ok(session) => Some(session.session_id),
        Err(error) => {
            warn!(%project_id, %agent_instance_id, %error, "Failed to create automaton session");
            None
        }
    }
}

async fn build_usage_reporting_context(
    state: &AppState,
    _project_id: ProjectId,
    _agent_instance_id: AgentInstanceId,
    org_id: Option<String>,
    model: Option<String>,
    jwt: Option<&str>,
) -> Option<UsageReportingContext> {
    let network_client = state.network_client.as_ref()?.clone();
    let jwt_str = jwt?;
    let cached = state.validation_cache.get(jwt_str)?;
    let network_user_id = cached.session.network_user_id.as_ref()?;

    Some(UsageReportingContext {
        network_client,
        access_token: jwt_str.to_string(),
        network_user_id: network_user_id.to_string(),
        model: model.unwrap_or_else(|| "claude-opus-4-6".to_string()),
        org_id,
    })
}

async fn close_automaton_session(
    storage_client: Option<&std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<&str>,
    session_id: SessionId,
    status: &str,
) {
    let (Some(storage_client), Some(jwt)) = (storage_client, jwt) else {
        return;
    };

    let req = aura_os_storage::UpdateSessionRequest {
        status: Some(status.to_string()),
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
        summary_of_previous_context: None,
        tasks_worked_count: None,
        ended_at: Some(Utc::now().to_rfc3339()),
    };
    if let Err(error) = storage_client
        .update_session(&session_id.to_string(), jwt, &req)
        .await
    {
        warn!(%session_id, %error, "Failed to close automaton session");
    }
}
struct ForwardParams {
    automaton_events_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    app_broadcast: tokio::sync::broadcast::Sender<serde_json::Value>,
    automaton_registry: AutomatonRegistry,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
    task_service: std::sync::Arc<TaskService>,
    task_output_cache: TaskOutputCache,
    storage_client: Option<std::sync::Arc<aura_os_storage::StorageClient>>,
    jwt: Option<String>,
    session_id: Option<SessionId>,
    session_service: std::sync::Arc<aura_os_sessions::SessionService>,
    agent_instance_service: std::sync::Arc<aura_os_agents::AgentInstanceService>,
    usage_reporting: Option<UsageReportingContext>,
    router_url: String,
    http_client: reqwest::Client,
}

async fn resolve_active_task_id(
    task_service: &TaskService,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> Option<String> {
    let tasks = task_service.list_tasks(project_id).await.ok()?;

    // Best signal: an in-progress task already assigned to this agent instance.
    if let Some(task) = tasks.iter().find(|t| {
        t.status == TaskStatus::InProgress
            && t.assigned_agent_instance_id == Some(*agent_instance_id)
    }) {
        return Some(task.task_id.to_string());
    }

    // The harness may assign tasks using its own agent ID which differs from
    // the agent_instance_id that start_loop generated.  Fall back to any
    // in-progress task so we can still stamp events with a task_id.
    if let Some(task) = tasks.iter().find(|t| t.status == TaskStatus::InProgress) {
        return Some(task.task_id.to_string());
    }

    // Fallback: global scheduler's next ready task.
    task_service
        .select_next_task(project_id)
        .await
        .ok()
        .flatten()
        .map(|t| t.task_id.to_string())
}

/// Forward automaton events from the harness WebSocket to the app's global
/// event broadcast, mapping `AutomatonEvent` types to the app's domain events.
/// Also accumulates task output in the in-memory cache and persists to storage
/// on task completion.
fn forward_automaton_events(params: ForwardParams) {
    let ForwardParams {
        automaton_events_tx,
        app_broadcast,
        automaton_registry,
        project_id,
        agent_instance_id,
        task_id,
        task_service,
        task_output_cache,
        storage_client,
        jwt,
        session_id,
        session_service,
        agent_instance_service,
        usage_reporting,
        router_url,
        http_client,
    } = params;

    let mut rx = automaton_events_tx.subscribe();
    let pid = project_id.to_string();
    let aiid = agent_instance_id.to_string();
    let current_session_id = session_id;
    let current_session_id_string = current_session_id.map(|id| id.to_string());

    tokio::spawn(async move {
        let mut first_work_seen = false;
        let mut current_task_id: Option<String> = task_id;
        let mut session_status = "completed";
        let clear_active_automaton =
            |registry: AutomatonRegistry,
             project_id: ProjectId,
             agent_instance_id: AgentInstanceId| async move {
                let mut reg = registry.lock().await;
                if reg
                    .get(&agent_instance_id)
                    .is_some_and(|entry| entry.project_id == project_id)
                {
                    reg.remove(&agent_instance_id);
                }
            };

        loop {
            match rx.recv().await {
                Ok(event) => {
                    let event_type = event
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let is_work = matches!(
                        event_type,
                        "task_started"
                            | "text_delta"
                            | "thinking_delta"
                            | "tool_call_started"
                            | "tool_result"
                            | "log_line"
                            | "progress"
                    );

                    // Keep trying to discover the active task_id until it is known.
                    // Some harness streams emit deltas before task_started, and if
                    // we stop attempting resolution after first work we can forward
                    // all first-task output without task_id.
                    if current_task_id.is_none() {
                        if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                            current_task_id = Some(tid.to_owned());
                        } else if is_work {
                            current_task_id = resolve_active_task_id(
                                task_service.as_ref(),
                                &project_id,
                                &agent_instance_id,
                            )
                            .await;
                        }
                    }
                    // If we see any work event before a task_started, emit a
                    // synthetic task_started so the UI exits "Preparing" state.
                    // This handles the race where the real task_started was
                    // emitted before our WebSocket connected.
                    // Track the active task_id from lifecycle events so
                    // streaming events (text_delta, etc.) that don't carry
                    // task_id in their payload still get stamped correctly.
                    if event_type == "task_started" {
                        if let Some(tid) = event.get("task_id").and_then(|v| v.as_str()) {
                            current_task_id = Some(tid.to_owned());
                            if let (Some(session_id), Ok(task_id)) =
                                (current_session_id, tid.parse::<TaskId>())
                            {
                                let _ = agent_instance_service
                                    .start_working(
                                        &project_id,
                                        &agent_instance_id,
                                        &task_id,
                                        &session_id,
                                    )
                                    .await;
                                if let (Some(sc), Some(jwt)) =
                                    (storage_client.as_ref(), jwt.as_deref())
                                {
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        session_id: Some(session_id.to_string()),
                                        assigned_project_agent_id: Some(aiid.clone()),
                                        ..Default::default()
                                    };
                                    if let Err(e) = sc.update_task(tid, jwt, &req).await {
                                        warn!(task_id = %tid, error = %e, "Failed to persist session_id on task start");
                                    }
                                }
                            }
                            let mut cache = task_output_cache.lock().await;
                            cache.insert(
                                tid.to_owned(),
                                CachedTaskOutput {
                                    project_id: Some(pid.clone()),
                                    agent_instance_id: Some(aiid.clone()),
                                    session_id: current_session_id_string.clone(),
                                    ..Default::default()
                                },
                            );
                        }
                    }

                    if !first_work_seen {
                        let event_task_id = event
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let mut effective_task_id = current_task_id.clone().or(event_task_id);
                        if effective_task_id.is_none() {
                            effective_task_id = resolve_active_task_id(
                                task_service.as_ref(),
                                &project_id,
                                &agent_instance_id,
                            )
                            .await;
                            if let Some(ref tid) = effective_task_id {
                                current_task_id = Some(tid.clone());
                            }
                        }
                        if is_work {
                            if event_type == "task_started" || effective_task_id.is_some() {
                                first_work_seen = true;
                            }
                            if event_type != "task_started" && effective_task_id.is_some() {
                                let extra = match &effective_task_id {
                                    Some(tid) => serde_json::json!({"task_id": tid}),
                                    None => serde_json::json!({}),
                                };
                                emit_domain_event(
                                    &app_broadcast,
                                    "task_started",
                                    project_id,
                                    agent_instance_id,
                                    extra,
                                );
                            }
                        }
                    }

                    // Accumulate task output in the in-memory cache.
                    {
                        let event_task_id = event
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let eff_tid = current_task_id.clone().or(event_task_id);
                        if let Some(ref tid) = eff_tid {
                            let mut cache = task_output_cache.lock().await;
                            let entry = cache.entry(tid.clone()).or_default();
                            if entry.project_id.is_none() {
                                entry.project_id = Some(pid.clone());
                            }
                            if entry.agent_instance_id.is_none() {
                                entry.agent_instance_id = Some(aiid.clone());
                            }
                            if entry.session_id.is_none() {
                                entry.session_id = current_session_id_string.clone();
                            }
                            match event_type {
                                "text_delta" => {
                                    if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
                                        entry.live_output.push_str(text);
                                    }
                                }
                                "assistant_message_end" => {
                                    if !entry.live_output.is_empty()
                                        && !entry.live_output.ends_with("\n\n")
                                    {
                                        entry.live_output.push_str("\n\n");
                                    }
                                    if let Some(turn_usage) = extract_turn_usage(&event) {
                                        entry.saw_rich_usage = true;
                                        entry.input_tokens = turn_usage.input_tokens;
                                        entry.output_tokens = turn_usage.output_tokens;
                                        entry.total_input_tokens =
                                            turn_usage.cumulative_input_tokens.unwrap_or(
                                                entry.total_input_tokens + turn_usage.input_tokens,
                                            );
                                        entry.total_output_tokens =
                                            turn_usage.cumulative_output_tokens.unwrap_or(
                                                entry.total_output_tokens
                                                    + turn_usage.output_tokens,
                                            );
                                        entry.total_cache_creation_input_tokens = turn_usage
                                            .cumulative_cache_creation_input_tokens
                                            .unwrap_or(
                                                entry.total_cache_creation_input_tokens
                                                    + turn_usage.cache_creation_input_tokens,
                                            );
                                        entry.total_cache_read_input_tokens = turn_usage
                                            .cumulative_cache_read_input_tokens
                                            .unwrap_or(
                                                entry.total_cache_read_input_tokens
                                                    + turn_usage.cache_read_input_tokens,
                                            );
                                        if let Some(estimated_context_tokens) =
                                            turn_usage.estimated_context_tokens
                                        {
                                            entry.estimated_context_tokens =
                                                estimated_context_tokens;
                                        }
                                        entry.context_usage_estimate =
                                            turn_usage.context_utilization;
                                        if let Some(model) = turn_usage.model {
                                            entry.model = Some(model);
                                        }
                                        if let Some(provider) = turn_usage.provider {
                                            entry.provider = Some(provider);
                                        }
                                    }
                                    let files_changed = extract_files_changed(&event);
                                    if !files_changed.is_empty() {
                                        entry.files_changed = files_changed;
                                    }
                                }
                                "build_verification_skipped"
                                | "build_verification_started"
                                | "build_verification_passed"
                                | "build_verification_failed"
                                | "build_fix_attempt" => {
                                    entry.build_steps.push(event.clone());
                                }
                                "test_verification_started"
                                | "test_verification_passed"
                                | "test_verification_failed"
                                | "test_fix_attempt" => {
                                    entry.test_steps.push(event.clone());
                                }
                                "token_usage" => {
                                    if !entry.saw_rich_usage {
                                        if let Some((input_tokens, output_tokens)) =
                                            extract_token_usage(&event)
                                        {
                                            entry.input_tokens = input_tokens;
                                            entry.output_tokens = output_tokens;
                                            entry.total_input_tokens += input_tokens;
                                            entry.total_output_tokens += output_tokens;
                                        }
                                    }
                                }
                                _ => {
                                    for kind in classify_run_command_steps(event_type, &event) {
                                        match kind {
                                            VerificationStepKind::Build => {
                                                entry.build_steps.push(event.clone())
                                            }
                                            VerificationStepKind::Test => {
                                                entry.test_steps.push(event.clone())
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if event_type == "assistant_message_end" {
                        if let (Some(session_id), Some(turn_usage)) =
                            (current_session_id, extract_turn_usage(&event))
                        {
                            if let Err(error) = session_service
                                .update_context_usage(UpdateContextUsageParams {
                                    project_id,
                                    agent_instance_id,
                                    session_id,
                                    input_tokens: turn_usage.input_tokens,
                                    output_tokens: turn_usage.output_tokens,
                                    total_input_tokens: turn_usage.cumulative_input_tokens,
                                    total_output_tokens: turn_usage.cumulative_output_tokens,
                                    context_usage_estimate: turn_usage.context_utilization,
                                })
                                .await
                            {
                                warn!(%session_id, %error, "Failed to persist automaton session usage");
                            }
                        }
                        if let (Some(usage_reporting), Some(turn_usage)) =
                            (usage_reporting.as_ref(), extract_turn_usage(&event))
                        {
                            report_automaton_usage(usage_reporting, project_id, &turn_usage).await;
                        }
                    } else if event_type == "token_usage" {
                        if let (Some(session_id), Some(turn_usage)) =
                            (current_session_id, extract_turn_usage(&event))
                        {
                            if let Err(error) = session_service
                                .update_context_usage(UpdateContextUsageParams {
                                    project_id,
                                    agent_instance_id,
                                    session_id,
                                    input_tokens: turn_usage.input_tokens,
                                    output_tokens: turn_usage.output_tokens,
                                    total_input_tokens: None,
                                    total_output_tokens: None,
                                    context_usage_estimate: None,
                                })
                                .await
                            {
                                warn!(%session_id, %error, "Failed to persist fallback automaton token usage");
                            }
                        }
                        if let (Some(usage_reporting), Some(turn_usage)) =
                            (usage_reporting.as_ref(), extract_turn_usage(&event))
                        {
                            report_automaton_usage(usage_reporting, project_id, &turn_usage).await;
                        }
                    }

                    let mapped_type = match event_type {
                        "started" => Some("loop_started"),
                        "stopped" => Some("loop_stopped"),
                        "paused" => Some("loop_paused"),
                        "resumed" => Some("loop_resumed"),
                        "task_started" => Some("task_started"),
                        "task_completed" => {
                            // Persist accumulated output to storage.
                            let event_tid = event
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(str::to_owned);
                            let tid = current_task_id.clone().or(event_tid);
                            if let Some(ref tid) = tid {
                                let session_id = event
                                    .get("session_id")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_owned);
                                let cached = {
                                    let mut cache = task_output_cache.lock().await;
                                    if let Some(entry) = cache.get_mut(tid) {
                                        if session_id.is_some() {
                                            entry.session_id = session_id;
                                        }
                                        entry.clone()
                                    } else {
                                        CachedTaskOutput::default()
                                    }
                                };
                                if let (Some(storage_client), Some(jwt), Some(session_id)) = (
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    cached.session_id.clone(),
                                ) {
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        title: None,
                                        description: None,
                                        order_index: None,
                                        dependency_ids: None,
                                        execution_notes: None,
                                        files_changed: (!cached.files_changed.is_empty())
                                            .then_some(cached.files_changed.clone()),
                                        model: cached.model.clone(),
                                        total_input_tokens: Some(cached.total_input_tokens),
                                        total_output_tokens: Some(cached.total_output_tokens),
                                        session_id: Some(session_id),
                                        assigned_project_agent_id: Some(aiid.clone()),
                                    };
                                    if let Err(error) =
                                        storage_client.update_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to persist task usage metadata");
                                    }
                                }
                                persistence::persist_task_output(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    tid,
                                    &cached,
                                )
                                .await;
                            }
                            Some("task_completed")
                        }
                        "task_failed" => {
                            session_status = "failed";
                            let event_tid = event
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(str::to_owned);
                            let tid = current_task_id.clone().or(event_tid);
                            if let Some(ref tid) = tid {
                                let session_id = event
                                    .get("session_id")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_owned);
                                let cached = {
                                    let mut cache = task_output_cache.lock().await;
                                    if let Some(entry) = cache.get_mut(tid) {
                                        if session_id.is_some() {
                                            entry.session_id = session_id;
                                        }
                                        entry.clone()
                                    } else {
                                        CachedTaskOutput::default()
                                    }
                                };
                                if let (Some(storage_client), Some(jwt), Some(session_id)) = (
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    cached.session_id.clone(),
                                ) {
                                    let req = aura_os_storage::UpdateTaskRequest {
                                        title: None,
                                        description: None,
                                        order_index: None,
                                        dependency_ids: None,
                                        execution_notes: None,
                                        files_changed: (!cached.files_changed.is_empty())
                                            .then_some(cached.files_changed.clone()),
                                        model: cached.model.clone(),
                                        total_input_tokens: Some(cached.total_input_tokens),
                                        total_output_tokens: Some(cached.total_output_tokens),
                                        session_id: Some(session_id),
                                        assigned_project_agent_id: Some(aiid.clone()),
                                    };
                                    if let Err(error) =
                                        storage_client.update_task(tid, jwt, &req).await
                                    {
                                        warn!(task_id = %tid, %error, "Failed to persist failed-task usage metadata");
                                    }
                                }
                                persistence::persist_task_output(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    tid,
                                    &cached,
                                )
                                .await;
                            }
                            Some("task_failed")
                        }
                        "task_retrying" => Some("task_retrying"),
                        "loop_finished" => Some("loop_finished"),
                        "token_usage" => Some("token_usage"),
                        "text_delta" => Some("text_delta"),
                        "thinking_delta" => Some("thinking_delta"),
                        "tool_call_started" => Some("tool_use_start"),
                        "tool_result" => Some("tool_result"),
                        "progress" => Some("progress"),
                        "git_pushed" => Some("git_pushed"),
                        "git_committed" => Some("git_committed"),
                        "done" => {
                            clear_active_automaton(
                                automaton_registry.clone(),
                                project_id,
                                agent_instance_id,
                            )
                            .await;
                            let _ = agent_instance_service
                                .finish_working(&project_id, &agent_instance_id)
                                .await;
                            if let Some(session_id) = current_session_id {
                                close_automaton_session(
                                    storage_client.as_ref(),
                                    jwt.as_deref(),
                                    session_id,
                                    session_status,
                                )
                                .await;

                                if let (Some(sc), Some(j)) = (storage_client.clone(), jwt.clone()) {
                                    let sid = session_id.to_string();
                                    let rurl = router_url.clone();
                                    let hclient = http_client.clone();
                                    tokio::spawn(async move {
                                        if let Err(e) = super::agents::generate_session_summary(
                                            &sc, &hclient, &rurl, &j, &sid,
                                        )
                                        .await
                                        {
                                            warn!(session_id = %sid, error = %e, "Background session summary generation failed");
                                        }
                                    });
                                }
                            }
                            emit_domain_event(
                                &app_broadcast,
                                "loop_finished",
                                project_id,
                                agent_instance_id,
                                serde_json::json!({}),
                            );
                            break;
                        }
                        _ => None,
                    };

                    let mut forwarded = event.clone();
                    if let Some(obj) = forwarded.as_object_mut() {
                        let event_task_id = obj
                            .get("task_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        let effective_task_id = current_task_id.clone().or(event_task_id);
                        obj.insert("project_id".into(), serde_json::Value::String(pid.clone()));
                        obj.insert(
                            "agent_instance_id".into(),
                            serde_json::Value::String(aiid.clone()),
                        );
                        if let Some(ref tid) = effective_task_id {
                            obj.insert("task_id".into(), serde_json::Value::String(tid.clone()));
                        }
                        if let Some(mapped) = mapped_type {
                            obj.insert("type".into(), serde_json::Value::String(mapped.into()));
                        }
                    }
                    let _ = app_broadcast.send(forwarded.clone());

                    if let Some(session_id) = current_session_id_string.as_deref() {
                        let event_type =
                            forwarded.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if persistence::is_session_event_worthy(event_type) {
                            let sc = storage_client.clone();
                            let j = jwt.clone();
                            let sid = session_id.to_string();
                            let ev = forwarded.clone();
                            tokio::spawn(async move {
                                persistence::persist_session_event(
                                    sc.as_ref(),
                                    j.as_deref(),
                                    &sid,
                                    &ev,
                                )
                                .await;
                            });
                        }
                    }

                    if persistence::is_log_worthy(
                        forwarded.get("type").and_then(|t| t.as_str()).unwrap_or(""),
                    ) {
                        let sc = storage_client.clone();
                        let j = jwt.clone();
                        let p = pid.clone();
                        tokio::spawn(async move {
                            persistence::persist_log_event(
                                sc.as_ref(),
                                j.as_deref(),
                                &p,
                                &forwarded,
                            )
                            .await;
                        });
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    clear_active_automaton(
                        automaton_registry.clone(),
                        project_id,
                        agent_instance_id,
                    )
                    .await;
                    let _ = agent_instance_service
                        .finish_working(&project_id, &agent_instance_id)
                        .await;
                    if let Some(session_id) = current_session_id {
                        close_automaton_session(
                            storage_client.as_ref(),
                            jwt.as_deref(),
                            session_id,
                            session_status,
                        )
                        .await;

                        if let (Some(sc), Some(j)) = (storage_client.clone(), jwt.clone()) {
                            let sid = session_id.to_string();
                            let rurl = router_url.clone();
                            let hclient = http_client.clone();
                            tokio::spawn(async move {
                                if let Err(e) = super::agents::generate_session_summary(
                                    &sc, &hclient, &rurl, &j, &sid,
                                )
                                .await
                                {
                                    warn!(session_id = %sid, error = %e, "Background session summary generation failed");
                                }
                            });
                        }
                    }
                    emit_domain_event(
                        &app_broadcast,
                        "loop_finished",
                        project_id,
                        agent_instance_id,
                        serde_json::json!({}),
                    );
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });
}

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    super::billing::require_credits(&state, &jwt).await?;

    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);

    let jwt = Some(jwt);
    let project = state.project_service.get_project(&project_id).ok();
    let project_name = project.as_ref().map(|p| p.name.as_str()).unwrap_or("");
    let (machine_type, swarm_agent_id) = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map(|inst| {
            info!(
                %project_id, %agent_instance_id,
                agent_id = %inst.agent_id,
                machine_type = %inst.machine_type,
                "Resolved agent instance for loop start"
            );
            (inst.machine_type, Some(inst.agent_id.to_string()))
        })
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                ApiError::not_found(format!("agent instance {agent_instance_id} not found"))
            }
            other => ApiError::internal(format!(
                "looking up agent instance {agent_instance_id}: {other}"
            )),
        })?;
    let harness_mode = HarnessMode::from_machine_type(&machine_type);
    let automaton_client = automaton_client_for_mode(
        &state,
        harness_mode,
        swarm_agent_id.as_deref(),
        jwt.as_deref(),
    )?;
    info!(
        %project_id, %agent_instance_id,
        base_url = %automaton_client.base_url(),
        ?harness_mode,
        "Automaton client configured for loop start"
    );
    let usage_reporting = build_usage_reporting_context(
        &state,
        project_id,
        agent_instance_id,
        project.as_ref().map(|project| project.org_id.to_string()),
        state
            .agent_instance_service
            .get_instance(&project_id, &agent_instance_id)
            .await
            .ok()
            .and_then(|instance| instance.model),
        jwt.as_deref(),
    )
    .await;
    let project_path = if harness_mode == HarnessMode::Swarm {
        match automaton_client.resolve_workspace(project_name).await {
            Ok(path) => path,
            Err(e) => {
                warn!(%project_id, error = %e, "Harness workspace resolve failed; using local computation");
                resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
                    .await
                    .unwrap_or_else(|| {
                        format!(
                            "/home/aura/{}",
                            super::projects_helpers::slugify(project_name)
                        )
                    })
            }
        }
    } else {
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
            .await
            .unwrap_or_default()
    };

    let jwt_for_persist = jwt.clone();
    let installed_tools = jwt
        .as_deref()
        .zip(project.as_ref().map(|project| &project.org_id))
        .map(|(jwt, org_id)| installed_workspace_app_tools(&state, org_id, jwt));
    let installed_integrations = project
        .as_ref()
        .map(|project| installed_workspace_integrations_for_org(&state, &project.org_id));
    let start_params = AutomatonStartParams {
        project_id: project_id.to_string(),
        auth_token: jwt,
        model: None,
        workspace_root: Some(project_path),
        task_id: None,
        git_repo_url: resolve_git_repo_url(project.as_ref()),
        git_branch: project.as_ref().and_then(|p| p.git_branch.clone()),
        installed_tools,
        installed_integrations,
    };

    let (automaton_id, adopted, event_stream_url) = match automaton_client
        .start(start_params.clone())
        .await
    {
        Ok(r) => {
            let esurl = r.event_stream_url.clone();
            (r.automaton_id, false, Some(esurl))
        }
        Err(AutomatonStartError::Conflict(existing_id)) => match existing_id {
            Some(aid) => {
                let stale_or_dead = match automaton_client.status(&aid).await {
                    Ok(status) => !automaton_is_active(&status),
                    Err(e) => {
                        warn!(
                            %aid,
                            %project_id,
                            error = %e,
                            "Failed to inspect conflicting automaton status; treating as stale"
                        );
                        true
                    }
                };

                if stale_or_dead {
                    info!(
                        %aid,
                        %project_id,
                        "Conflicting automaton appears stale; stopping and retrying start"
                    );
                    if let Err(e) = automaton_client.stop(&aid).await {
                        warn!(
                            %aid,
                            %project_id,
                            error = %e,
                            "Failed to stop stale conflicting automaton before retry"
                        );
                    }
                    match automaton_client.start(start_params).await {
                        Ok(r) => {
                            let esurl = r.event_stream_url.clone();
                            (r.automaton_id, false, Some(esurl))
                        }
                        Err(AutomatonStartError::Conflict(Some(retry_id))) => {
                            info!(
                                %retry_id,
                                %project_id,
                                "Retry still conflicts; adopting existing automaton"
                            );
                            (retry_id, true, None)
                        }
                        Err(AutomatonStartError::Conflict(None)) => {
                            return Err(ApiError::conflict(
                                "A dev loop is already running but its ID could not be determined",
                            ));
                        }
                        Err(e) => {
                            return Err(ApiError::internal(format!(
                                "starting dev loop after stale cleanup: {e}"
                            )));
                        }
                    }
                } else {
                    info!(%aid, %project_id, "Adopting existing automaton from harness");
                    (aid, true, None)
                }
            }
            None => {
                return Err(ApiError::conflict(
                    "A dev loop is already running but its ID could not be determined",
                ));
            }
        },
        Err(AutomatonStartError::Request {
            message,
            is_connect,
            is_timeout,
        }) => {
            warn!(
                %project_id, %agent_instance_id,
                base_url = %automaton_client.base_url(),
                %is_connect, %is_timeout,
                %message,
                "Automaton start request error"
            );
            if is_connect {
                crate::app_builder::ensure_local_harness_running();
                return Err(ApiError::service_unavailable(format!(
                    "Service unavailable: local aura-harness at {} could not be reached ({message}). \
                     Recovery spawn was attempted; if this keeps failing, check harness build/startup logs.",
                    automaton_client.base_url(),
                )));
            }
            if is_timeout {
                return Err(ApiError::service_unavailable(format!(
                    "Service unavailable: local aura-harness at {} timed out while handling start ({message}).",
                    automaton_client.base_url(),
                )));
            }
            return Err(ApiError::internal(format!("starting dev loop: {message}")));
        }
        Err(AutomatonStartError::Response { status, body }) => {
            warn!(
                %project_id, %agent_instance_id,
                base_url = %automaton_client.base_url(),
                %status,
                response_body = %body,
                "Automaton start response error"
            );
            if harness_mode == HarnessMode::Swarm && status == 404 {
                return Err(ApiError::service_unavailable(format!(
                    "Remote dev-loop start is unavailable: swarm gateway at {} does not expose /automaton/start (HTTP 404).",
                    automaton_client.base_url()
                )));
            }
            return Err(ApiError::bad_gateway(format!(
                "automaton start failed via {} (status {}): {}",
                automaton_client.base_url(),
                status,
                body
            )));
        }
        Err(e) => return Err(ApiError::internal(format!("starting dev loop: {e}"))),
    };

    info!(
        %project_id,
        %agent_instance_id,
        %automaton_id,
        adopted,
        event_stream_url = event_stream_url.as_deref().unwrap_or("<none>"),
        "Dev loop automaton ready"
    );

    let events_tx = match automaton_client
        .connect_event_stream(&automaton_id, event_stream_url.as_deref())
        .await
    {
        Ok(tx) => tx,
        Err(e) => {
            // If start succeeded but event-stream attach failed, proactively stop
            // the spawned automaton so we don't leak an untracked loop that
            // cannot be stopped via our registry.
            if !adopted {
                if let Err(stop_err) = automaton_client.stop(&automaton_id).await {
                    warn!(
                        %project_id,
                        %agent_instance_id,
                        %automaton_id,
                        error = %stop_err,
                        "Failed to stop newly started automaton after stream attach failure"
                    );
                } else {
                    info!(
                        %project_id,
                        %agent_instance_id,
                        %automaton_id,
                        "Stopped newly started automaton after stream attach failure"
                    );
                }
            }
            return Err(ApiError::internal(format!(
                "connecting event stream for dev loop (adopted={adopted}): {e}"
            )));
        }
    };

    // Resolve the first task the automaton will pick so that events
    // arriving before the real task_started get stamped with a task_id.
    // Without this, text_delta events have no task_id and the frontend
    // silently discards them.
    let first_task_id =
        resolve_active_task_id(state.task_service.as_ref(), &project_id, &agent_instance_id).await;
    let first_task_uuid = first_task_id
        .as_deref()
        .and_then(|task_id| task_id.parse::<TaskId>().ok());
    let current_session_id = if adopted {
        state
            .agent_instance_service
            .get_instance(&project_id, &agent_instance_id)
            .await
            .ok()
            .and_then(|instance| instance.current_session_id)
    } else {
        create_automaton_session(
            &state,
            project_id,
            agent_instance_id,
            first_task_uuid,
            jwt_for_persist.as_deref(),
        )
        .await
    };

    if let Some(ref tid) = first_task_id {
        emit_domain_event(
            &state.event_broadcast,
            "task_started",
            project_id,
            agent_instance_id,
            serde_json::json!({"task_id": tid}),
        );
        let mut cache = state.task_output_cache.lock().await;
        cache.insert(
            tid.clone(),
            CachedTaskOutput {
                project_id: Some(project_id.to_string()),
                agent_instance_id: Some(agent_instance_id.to_string()),
                session_id: current_session_id.map(|id| id.to_string()),
                ..Default::default()
            },
        );
    }

    forward_automaton_events(ForwardParams {
        automaton_events_tx: events_tx,
        app_broadcast: state.event_broadcast.clone(),
        automaton_registry: state.automaton_registry.clone(),
        project_id,
        agent_instance_id,
        task_id: first_task_id,
        task_service: state.task_service.clone(),
        task_output_cache: state.task_output_cache.clone(),
        storage_client: state.storage_client.clone(),
        jwt: jwt_for_persist.clone(),
        session_id: current_session_id,
        session_service: state.session_service.clone(),
        agent_instance_service: state.agent_instance_service.clone(),
        usage_reporting,
        router_url: state.super_agent_service.router_url.clone(),
        http_client: state.super_agent_service.http_client.clone(),
    });

    emit_domain_event(
        &state.event_broadcast,
        "loop_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"automaton_id": &automaton_id, "adopted": adopted}),
    );
    {
        let ev = serde_json::json!({"type": "loop_started", "project_id": project_id.to_string(), "agent_instance_id": agent_instance_id.to_string()});
        let sc = state.storage_client.clone();
        let j = jwt_for_persist.clone();
        let p = project_id.to_string();
        tokio::spawn(async move {
            persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
        });
    }

    {
        let mut reg = state.automaton_registry.lock().await;
        reg.insert(
            agent_instance_id,
            ActiveAutomaton {
                automaton_id: automaton_id.clone(),
                project_id,
                harness_base_url: automaton_client.base_url().to_string(),
            },
        );
    }

    let active_agent_instances = active_instances(&state, project_id).await;

    Ok((
        StatusCode::CREATED,
        Json(LoopStatusResponse {
            running: true,
            paused: false,
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            active_agent_instances: Some(active_agent_instances),
        }),
    ))
}

pub(crate) async fn pause_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let reg = state.automaton_registry.lock().await;
    let targets: Vec<(AgentInstanceId, String)> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone()))
        .collect();
    drop(reg);

    if targets.is_empty() {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for (aiid, automaton_id) in &targets {
        let base_url = {
            let reg = state.automaton_registry.lock().await;
            reg.get(aiid)
                .map(|a| a.harness_base_url.clone())
                .unwrap_or_else(|| state.automaton_client.base_url().to_string())
        };
        let client = aura_os_link::AutomatonClient::new(&base_url);
        if let Err(e) = client.pause(automaton_id).await {
            warn!(automaton_id, error = %e, "Failed to pause automaton");
        }
        emit_domain_event(
            &state.event_broadcast,
            "loop_paused",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
        {
            let ev = serde_json::json!({"type": "loop_paused", "project_id": project_id.to_string(), "agent_instance_id": aiid.to_string()});
            let sc = state.storage_client.clone();
            let j: Option<String> = Some(jwt.clone());
            let p = project_id.to_string();
            tokio::spawn(async move {
                persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
            });
        }
    }

    let active_agent_instances = active_instances(&state, project_id).await;

    Ok(Json(LoopStatusResponse {
        running: true,
        paused: true,
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(active_agent_instances),
    }))
}

pub(crate) async fn stop_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let mut reg = state.automaton_registry.lock().await;
    let targets: Vec<(AgentInstanceId, String)> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .filter(|(aiid, _)| params.agent_instance_id.is_none_or(|t| **aiid == t))
        .map(|(aiid, a)| (*aiid, a.automaton_id.clone()))
        .collect();

    if targets.is_empty() {
        drop(reg);
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }

    for (aiid, automaton_id) in &targets {
        let base_url = reg
            .get(aiid)
            .map(|a| a.harness_base_url.clone())
            .unwrap_or_else(|| state.automaton_client.base_url().to_string());
        let client = aura_os_link::AutomatonClient::new(&base_url);
        if let Err(e) = client.stop(automaton_id).await {
            warn!(automaton_id, error = %e, "Failed to stop automaton");
        }
        reg.remove(aiid);
        emit_domain_event(
            &state.event_broadcast,
            "loop_stopped",
            project_id,
            *aiid,
            serde_json::json!({}),
        );
        {
            let ev = serde_json::json!({"type": "loop_stopped", "project_id": project_id.to_string(), "agent_instance_id": aiid.to_string()});
            let sc = state.storage_client.clone();
            let j: Option<String> = Some(jwt.clone());
            let p = project_id.to_string();
            tokio::spawn(async move {
                persistence::persist_log_event(sc.as_ref(), j.as_deref(), &p, &ev).await;
            });
        }
    }

    let remaining: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, a)| a.project_id == project_id)
        .map(|(aiid, _)| *aiid)
        .collect();
    drop(reg);

    Ok(Json(LoopStatusResponse {
        running: !remaining.is_empty(),
        paused: false,
        project_id: Some(project_id),
        agent_instance_id: params.agent_instance_id,
        active_agent_instances: Some(remaining),
    }))
}

pub(crate) async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    let active = active_instances(&state, project_id).await;

    Ok(Json(LoopStatusResponse {
        running: !active.is_empty(),
        paused: false,
        project_id: Some(project_id),
        agent_instance_id: None,
        active_agent_instances: Some(active),
    }))
}

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    super::billing::require_credits(&state, &jwt).await?;

    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);

    let jwt = Some(jwt);
    let project = state.project_service.get_project(&project_id).ok();
    let project_name = project.as_ref().map(|p| p.name.as_str()).unwrap_or("");
    let (machine_type, swarm_agent_id) = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map(|inst| (inst.machine_type, Some(inst.agent_id.to_string())))
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                ApiError::not_found(format!("agent instance {agent_instance_id} not found"))
            }
            other => ApiError::internal(format!(
                "looking up agent instance {agent_instance_id}: {other}"
            )),
        })?;
    let harness_mode = HarnessMode::from_machine_type(&machine_type);
    let automaton_client = automaton_client_for_mode(
        &state,
        harness_mode,
        swarm_agent_id.as_deref(),
        jwt.as_deref(),
    )?;
    let project_path = if harness_mode == HarnessMode::Swarm {
        match automaton_client.resolve_workspace(project_name).await {
            Ok(path) => path,
            Err(e) => {
                warn!(%project_id, error = %e, "Harness workspace resolve failed; using local computation");
                resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
                    .await
                    .unwrap_or_else(|| {
                        format!(
                            "/home/aura/{}",
                            super::projects_helpers::slugify(project_name)
                        )
                    })
            }
        }
    } else {
        resolve_agent_instance_workspace_path(&state, &project_id, Some(agent_instance_id))
            .await
            .unwrap_or_default()
    };
    let usage_reporting = build_usage_reporting_context(
        &state,
        project_id,
        agent_instance_id,
        project.as_ref().map(|project| project.org_id.to_string()),
        state
            .agent_instance_service
            .get_instance(&project_id, &agent_instance_id)
            .await
            .ok()
            .and_then(|instance| instance.model),
        jwt.as_deref(),
    )
    .await;

    let jwt_for_persist = jwt.clone();
    let installed_tools = jwt
        .as_deref()
        .zip(project.as_ref().map(|project| &project.org_id))
        .map(|(jwt, org_id)| installed_workspace_app_tools(&state, org_id, jwt));
    let installed_integrations = project
        .as_ref()
        .map(|project| installed_workspace_integrations_for_org(&state, &project.org_id));
    let result = automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: jwt,
            model: None,
            workspace_root: Some(project_path),
            task_id: Some(task_id.to_string()),
            git_repo_url: resolve_git_repo_url(project.as_ref()),
            git_branch: project.as_ref().and_then(|p| p.git_branch.clone()),
            installed_tools,
            installed_integrations,
        })
        .await
        .map_err(|e| match e {
            AutomatonStartError::Conflict(_) => {
                ApiError::conflict(format!("starting task runner: {e}"))
            }
            AutomatonStartError::Response { status, body } => ApiError::bad_gateway(format!(
                "starting task runner via {} failed (status {}): {}",
                automaton_client.base_url(),
                status,
                body
            )),
            _ => ApiError::internal(format!("starting task runner: {e}")),
        })?;

    let automaton_id = result.automaton_id;
    let event_stream_url = result.event_stream_url;
    info!(%project_id, %task_id, %automaton_id, %event_stream_url, "Single task automaton started");

    // Connect to the event stream as early as possible to minimise the window
    // between automaton start and WS attach.  Retry a few times because the
    // harness may reset the connection if the automaton isn't ready yet.
    let events_tx = connect_with_retries(&automaton_client, &automaton_id, &event_stream_url, 2)
        .await
        .ok();

    // Emit task_started immediately so the frontend gets the signal even if
    // early automaton events are lost in the race between start and WS connect.
    emit_domain_event(
        &state.event_broadcast,
        "task_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"task_id": task_id.to_string()}),
    );

    // Pre-seed the output cache so the REST endpoint can serve partial output.
    let session_id = create_automaton_session(
        &state,
        project_id,
        agent_instance_id,
        Some(task_id),
        jwt_for_persist.as_deref(),
    )
    .await;
    {
        let mut cache = state.task_output_cache.lock().await;
        cache.insert(
            task_id.to_string(),
            CachedTaskOutput {
                project_id: Some(project_id.to_string()),
                agent_instance_id: Some(agent_instance_id.to_string()),
                session_id: session_id.map(|id| id.to_string()),
                ..Default::default()
            },
        );
    }
    if let Some(session_id) = session_id {
        let _ = state
            .agent_instance_service
            .start_working(&project_id, &agent_instance_id, &task_id, &session_id)
            .await;
    }

    if let Some(events_tx) = events_tx {
        forward_automaton_events(ForwardParams {
            automaton_events_tx: events_tx,
            app_broadcast: state.event_broadcast.clone(),
            automaton_registry: state.automaton_registry.clone(),
            project_id,
            agent_instance_id,
            task_id: Some(task_id.to_string()),
            task_service: state.task_service.clone(),
            task_output_cache: state.task_output_cache.clone(),
            storage_client: state.storage_client.clone(),
            jwt: jwt_for_persist.clone(),
            session_id,
            session_service: state.session_service.clone(),
            agent_instance_service: state.agent_instance_service.clone(),
            usage_reporting,
            router_url: state.super_agent_service.router_url.clone(),
            http_client: state.super_agent_service.http_client.clone(),
        });
    } else {
        warn!(
            %project_id, %task_id, %automaton_id,
            "All event stream connection attempts failed; cleaning up"
        );
        let _ = state
            .agent_instance_service
            .finish_working(&project_id, &agent_instance_id)
            .await;
        if let Some(session_id) = session_id {
            close_automaton_session(
                state.storage_client.as_ref(),
                jwt_for_persist.as_deref(),
                session_id,
                "failed",
            )
            .await;
        }
        emit_domain_event(
            &state.event_broadcast,
            "task_failed",
            project_id,
            agent_instance_id,
            serde_json::json!({
                "task_id": task_id.to_string(),
                "error": "Failed to connect to automaton event stream"
            }),
        );
    }

    Ok(StatusCode::ACCEPTED)
}

async fn active_instances(state: &AppState, project_id: ProjectId) -> Vec<AgentInstanceId> {
    let reg = state.automaton_registry.lock().await;
    reg.iter()
        .filter(|(_, a)| a.project_id == project_id)
        .map(|(aiid, _)| *aiid)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        classify_run_command_steps, estimate_usage_cost_usd, extract_files_changed,
        extract_run_command, extract_turn_usage, VerificationStepKind,
    };

    #[test]
    fn extracts_run_command_shell_string() {
        let event = serde_json::json!({
            "name": "run_command",
            "input": {
                "command": "npm run build"
            }
        });

        assert_eq!(
            extract_run_command(&event).as_deref(),
            Some("npm run build")
        );
    }

    #[test]
    fn extracts_run_command_program_and_args() {
        let event = serde_json::json!({
            "name": "run_command",
            "input": {
                "program": "npm",
                "args": ["run", "test"]
            }
        });

        assert_eq!(extract_run_command(&event).as_deref(), Some("npm run test"));
    }

    #[test]
    fn classifies_build_and_test_commands_from_tool_snapshots() {
        let build_event = serde_json::json!({
            "name": "run_command",
            "input": {
                "command": "npm run build"
            }
        });
        let test_event = serde_json::json!({
            "name": "run_command",
            "input": {
                "program": "npm",
                "args": ["run", "test"]
            }
        });

        assert_eq!(
            classify_run_command_steps("tool_call_snapshot", &build_event),
            vec![VerificationStepKind::Build]
        );
        assert_eq!(
            classify_run_command_steps("tool_call_completed", &test_event),
            vec![VerificationStepKind::Test]
        );
    }

    #[test]
    fn ignores_non_command_events_for_verification_steps() {
        let event = serde_json::json!({
            "name": "run_command",
            "input": {
                "command": "npm run build"
            }
        });

        assert!(classify_run_command_steps("tool_result", &event).is_empty());
        assert!(classify_run_command_steps(
            "tool_call_snapshot",
            &serde_json::json!({
                "name": "read_file",
                "input": {
                    "path": "package.json"
                }
            })
        )
        .is_empty());
    }

    #[test]
    fn extracts_rich_turn_usage_from_assistant_message_end() {
        let event = serde_json::json!({
            "type": "assistant_message_end",
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 800,
                "estimated_context_tokens": 42000,
                "cache_creation_input_tokens": 300,
                "cache_read_input_tokens": 900,
                "cumulative_input_tokens": 5000,
                "cumulative_output_tokens": 2200,
                "cumulative_cache_creation_input_tokens": 700,
                "cumulative_cache_read_input_tokens": 1400,
                "context_utilization": 0.42,
                "model": "claude-sonnet-4-5",
                "provider": "anthropic"
            }
        });

        let usage = extract_turn_usage(&event).expect("usage should parse");
        assert_eq!(usage.input_tokens, 1200);
        assert_eq!(usage.output_tokens, 800);
        assert_eq!(usage.estimated_context_tokens, Some(42_000));
        assert_eq!(usage.cumulative_input_tokens, Some(5_000));
        assert_eq!(usage.cumulative_output_tokens, Some(2_200));
        assert_eq!(usage.context_utilization, Some(0.42));
        assert_eq!(usage.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(usage.provider.as_deref(), Some("anthropic"));
    }

    #[test]
    fn extracts_files_changed_from_assistant_message_end() {
        let event = serde_json::json!({
            "type": "assistant_message_end",
            "files_changed": {
                "created": ["src/new.rs"],
                "modified": ["src/lib.rs"],
                "deleted": ["src/old.rs"]
            }
        });

        let files = extract_files_changed(&event);
        assert_eq!(files.len(), 3);
        assert!(files
            .iter()
            .any(|file| file.op == "create" && file.path == "src/new.rs"));
        assert!(files
            .iter()
            .any(|file| file.op == "modify" && file.path == "src/lib.rs"));
        assert!(files
            .iter()
            .any(|file| file.op == "delete" && file.path == "src/old.rs"));
    }

    #[test]
    fn estimate_usage_cost_includes_cache_tokens() {
        let cost_without_cache =
            estimate_usage_cost_usd("claude-sonnet-4-5", 1_000_000, 500_000, 0, 0);
        let cost_with_cache =
            estimate_usage_cost_usd("claude-sonnet-4-5", 1_000_000, 500_000, 500_000, 1_000_000);

        assert!(cost_with_cache > cost_without_cache);
        assert!((cost_with_cache - 12.675).abs() < 1e-9);
    }

    #[test]
    fn estimate_usage_cost_matches_versioned_model_ids() {
        let exact = estimate_usage_cost_usd("claude-sonnet-4-5", 1_000_000, 0, 0, 0);
        let versioned = estimate_usage_cost_usd("claude-sonnet-4-5-20250220", 1_000_000, 0, 0, 0);

        assert!((exact - versioned).abs() < 1e-9);
        assert!((exact - 3.0).abs() < 1e-9);
    }
}
