use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{info, warn};

use super::SwarmAgentReadyError;

const SWARM_AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const SWARM_AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(serde::Deserialize)]
struct SwarmAgentStateResponse {
    state: String,
}

/// Owned-data context for the background readiness check spawned by
/// [`spawn_swarm_readiness_check`]. Bundling these into a struct keeps the
/// public spawn function under the 5-parameter rule.
pub(super) struct BackgroundReadinessTask {
    pub http: reqwest::Client,
    pub swarm_base_url: String,
    pub jwt: String,
    pub provisioned_agent_id: String,
    pub vm_id: String,
    pub agent_id: String,
}

/// Borrowed-data context for the broadcasting readiness wait used during the
/// recovery pipeline. Bundling these into a struct keeps the wait function
/// under the 5-parameter rule.
pub(super) struct BroadcastReadinessRequest<'a> {
    pub http: &'a reqwest::Client,
    pub swarm_base_url: &'a str,
    pub jwt: &'a str,
    pub swarm_agent_id: &'a str,
    pub aura_agent_id: &'a str,
    pub broadcast: &'a broadcast::Sender<serde_json::Value>,
}

pub(super) fn spawn_swarm_readiness_check(task: BackgroundReadinessTask) {
    tokio::spawn(async move {
        match wait_for_swarm_agent_ready(
            &task.http,
            &task.swarm_base_url,
            &task.jwt,
            &task.provisioned_agent_id,
        )
        .await
        {
            Ok(()) => {
                info!(
                    agent_id = %task.agent_id,
                    vm_id = %task.vm_id,
                    "Remote agent reached ready state in background"
                );
            }
            Err(SwarmAgentReadyError::Timeout) => {
                warn!(
                    agent_id = %task.agent_id,
                    vm_id = %task.vm_id,
                    "Remote agent still provisioning after background readiness timeout"
                );
            }
            Err(SwarmAgentReadyError::ErrorState) => {
                warn!(
                    agent_id = %task.agent_id,
                    vm_id = %task.vm_id,
                    "Remote agent entered error state during background readiness check"
                );
            }
            Err(SwarmAgentReadyError::Transport(msg)) => {
                warn!(
                    agent_id = %task.agent_id,
                    vm_id = %task.vm_id,
                    error = %msg,
                    "Background readiness check transport error"
                );
            }
            Err(SwarmAgentReadyError::Parse(msg)) => {
                warn!(
                    agent_id = %task.agent_id,
                    vm_id = %task.vm_id,
                    error = %msg,
                    "Background readiness check parse error"
                );
            }
        }
    });
}

pub(super) async fn wait_for_swarm_agent_ready(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
) -> Result<(), SwarmAgentReadyError> {
    let url = format!("{}/v1/agents/{agent_id}/state", swarm_base_url);
    let deadline = tokio::time::Instant::now() + SWARM_AGENT_READY_TIMEOUT;

    loop {
        tokio::time::sleep(SWARM_AGENT_READY_POLL_INTERVAL).await;

        if tokio::time::Instant::now() >= deadline {
            return Err(SwarmAgentReadyError::Timeout);
        }

        match poll_swarm_agent_state(http, &url, jwt).await? {
            PollOutcome::Ready => return Ok(()),
            PollOutcome::Errored => return Err(SwarmAgentReadyError::ErrorState),
            PollOutcome::Pending(state) => {
                info!(agent_id = %agent_id, state = %state, "Waiting for remote agent provisioning");
            }
            PollOutcome::Retry => continue,
        }
    }
}

/// Same as [`wait_for_swarm_agent_ready`] but broadcasts progress events so
/// the frontend can show real-time recovery status over WebSocket.
pub(super) async fn wait_for_swarm_agent_ready_with_broadcast(
    request: BroadcastReadinessRequest<'_>,
) -> Result<(), SwarmAgentReadyError> {
    let url = format!(
        "{}/v1/agents/{}/state",
        request.swarm_base_url, request.swarm_agent_id
    );
    let deadline = tokio::time::Instant::now() + SWARM_AGENT_READY_TIMEOUT;

    loop {
        tokio::time::sleep(SWARM_AGENT_READY_POLL_INTERVAL).await;

        if tokio::time::Instant::now() >= deadline {
            return Err(SwarmAgentReadyError::Timeout);
        }

        match poll_swarm_agent_state(request.http, &url, request.jwt).await? {
            PollOutcome::Ready => return Ok(()),
            PollOutcome::Errored => return Err(SwarmAgentReadyError::ErrorState),
            PollOutcome::Pending(state) => {
                info!(swarm_agent_id = %request.swarm_agent_id, state = %state, "Waiting for recovered agent readiness");
                let _ = request.broadcast.send(serde_json::json!({
                    "type": "remote_agent_state_changed",
                    "agent_id": request.aura_agent_id,
                    "state": "provisioning",
                    "action": "recover",
                    "phase": "waiting_for_ready",
                    "uptime_seconds": 0,
                    "active_sessions": 0,
                }));
            }
            PollOutcome::Retry => continue,
        }
    }
}

enum PollOutcome {
    Ready,
    Errored,
    Pending(String),
    Retry,
}

async fn poll_swarm_agent_state(
    http: &reqwest::Client,
    url: &str,
    jwt: &str,
) -> Result<PollOutcome, SwarmAgentReadyError> {
    let resp = http
        .get(url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| SwarmAgentReadyError::Transport(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        warn!(
            url,
            status, body, "Swarm agent state check returned non-success"
        );
        return Ok(PollOutcome::Retry);
    }

    let state = resp
        .json::<SwarmAgentStateResponse>()
        .await
        .map_err(|e| SwarmAgentReadyError::Parse(e.to_string()))?;

    Ok(match state.state.as_str() {
        "running" | "idle" => PollOutcome::Ready,
        "error" => PollOutcome::Errored,
        other => PollOutcome::Pending(other.to_string()),
    })
}
