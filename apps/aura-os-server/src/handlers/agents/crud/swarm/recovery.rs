use aura_os_network::{NetworkAgent, NetworkClient};
use axum::http::StatusCode;
use axum::Json;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::provision::{persist_vm_id, provision_swarm_agent};
use super::readiness::{wait_for_swarm_agent_ready_with_broadcast, BroadcastReadinessRequest};
use super::{ReprovisionedRemoteAgent, SwarmAgentReadyError};

/// Recovery flow: delete the existing Swarm machine, provision a fresh one,
/// and wait for it to become ready -- streaming progress via `event_broadcast`.
pub(crate) async fn recover_remote_agent_pipeline(
    state: &AppState,
    client: &NetworkClient,
    jwt: &str,
    net_agent: &NetworkAgent,
) -> ApiResult<ReprovisionedRemoteAgent> {
    let previous_vm_id = net_agent.vm_id.clone();
    let swarm_base_url = state.swarm_base_url.as_deref().ok_or_else(|| {
        ApiError::service_unavailable(
            "swarm gateway is not configured (SWARM_BASE_URL); cannot create remote agent",
        )
    })?;

    broadcast_recovery_phase(state, &net_agent.id, "deleting", None);

    delete_swarm_agent(client.http_client(), swarm_base_url, jwt, &net_agent.id).await?;

    broadcast_recovery_phase(state, &net_agent.id, "provisioning", None);

    let provisioned = provision_swarm_agent(
        client.http_client(),
        swarm_base_url,
        jwt,
        &net_agent.id,
        &net_agent.name,
    )
    .await?;

    // Recovery has no separate "intended org" signal — the agent already
    // exists — so fall back to whatever org `net_agent` carries (now healed
    // on the list read path for legacy NULL-org records).
    let agent = persist_vm_id(state, client, jwt, net_agent, &provisioned.vm_id, None).await?;

    info!(
        agent_id = %net_agent.id,
        previous_vm_id = previous_vm_id.as_deref().unwrap_or("none"),
        new_vm_id = %provisioned.vm_id,
        "Swarm VM recovered for remote agent (delete + provision)"
    );

    await_recovery_readiness(RecoveryReadinessContext {
        state,
        client,
        jwt,
        net_agent,
        swarm_base_url,
        provisioned: &provisioned,
    })
    .await?;

    // The old VM (and its harness run) is gone, but any warm
    // `chat_session` we held still points at the dead WS — and
    // `ChatSession::is_alive` only checks the command channel, so the
    // next turn would reuse it and silently stall until the 180s
    // first-event watchdog fires. Evict so the next send cold-opens
    // against the freshly-provisioned VM.
    state.evict_chat_sessions_for_agent(&net_agent.id);

    Ok(ReprovisionedRemoteAgent {
        agent,
        status: "running".to_string(),
        previous_vm_id,
    })
}

/// Bundle of state required to broadcast and await readiness during a
/// remote agent recovery. Grouped to keep [`await_recovery_readiness`] under
/// the 5-parameter cap while preserving the borrow shape of the original
/// inline logic.
struct RecoveryReadinessContext<'a> {
    state: &'a AppState,
    client: &'a NetworkClient,
    jwt: &'a str,
    net_agent: &'a NetworkAgent,
    swarm_base_url: &'a str,
    provisioned: &'a super::ProvisionedSwarmAgent,
}

async fn await_recovery_readiness(ctx: RecoveryReadinessContext<'_>) -> ApiResult<()> {
    if matches!(ctx.provisioned.status.as_str(), "running" | "idle") {
        broadcast_recovery_phase(ctx.state, &ctx.net_agent.id, "ready", None);
        return Ok(());
    }

    broadcast_recovery_phase(ctx.state, &ctx.net_agent.id, "waiting_for_ready", None);
    let request = BroadcastReadinessRequest {
        http: ctx.client.http_client(),
        swarm_base_url: ctx.swarm_base_url,
        jwt: ctx.jwt,
        swarm_agent_id: &ctx.provisioned.agent_id,
        aura_agent_id: &ctx.net_agent.id,
        broadcast: &ctx.state.event_broadcast,
    };
    if let Err(error) = wait_for_swarm_agent_ready_with_broadcast(request).await {
        return Err(handle_recovery_readiness_error(
            ctx.state,
            &ctx.net_agent.id,
            error,
        ));
    }
    broadcast_recovery_phase(ctx.state, &ctx.net_agent.id, "ready", None);
    Ok(())
}

fn handle_recovery_readiness_error(
    state: &AppState,
    aura_agent_id: &str,
    error: SwarmAgentReadyError,
) -> (StatusCode, Json<ApiError>) {
    match error {
        SwarmAgentReadyError::Timeout => {
            broadcast_recovery_phase(
                state,
                aura_agent_id,
                "error",
                Some("Machine is still starting up -- timed out waiting"),
            );
            ApiError::bad_gateway("new machine provisioned but timed out waiting for ready state")
        }
        SwarmAgentReadyError::ErrorState(reason) => {
            // Forward the swarm-supplied diagnostic (e.g. an `Unschedulable`
            // PodScheduled message) all the way to the UI and the API
            // response. Without this, callers fell back to a generic
            // "entered error state" string and the user had no way to
            // distinguish a transient pull failure from a hard scheduling
            // problem.
            let display = reason.as_deref().unwrap_or("no detail provided");
            let banner = format!("New machine entered error state: {display}");
            broadcast_recovery_phase(state, aura_agent_id, "error", Some(&banner));
            ApiError::bad_gateway(format!(
                "new machine entered error state after provisioning: {display}"
            ))
        }
        SwarmAgentReadyError::Transport(msg) => {
            broadcast_recovery_phase(
                state,
                aura_agent_id,
                "error",
                Some(&format!("Lost contact with swarm gateway: {msg}")),
            );
            ApiError::bad_gateway(format!("readiness check transport error: {msg}"))
        }
        SwarmAgentReadyError::Parse(msg) => {
            broadcast_recovery_phase(
                state,
                aura_agent_id,
                "error",
                Some(&format!("Unexpected gateway response: {msg}")),
            );
            ApiError::bad_gateway(format!("readiness check parse error: {msg}"))
        }
    }
}

pub(crate) async fn delete_swarm_agent(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
) -> ApiResult<()> {
    let url = format!("{}/v1/agents/{}", swarm_base_url, agent_id);

    match send_swarm_delete(http, &url, jwt).await? {
        SwarmDeleteAttempt::Deleted => return Ok(()),
        SwarmDeleteAttempt::NeedsStop => {
            stop_swarm_agent(http, swarm_base_url, jwt, agent_id).await?;
        }
    }

    for attempt in 0..12 {
        if attempt > 0 {
            sleep(Duration::from_secs(5)).await;
        }
        match send_swarm_delete(http, &url, jwt).await? {
            SwarmDeleteAttempt::Deleted => return Ok(()),
            SwarmDeleteAttempt::NeedsStop => continue,
        }
    }

    Err(ApiError::bad_gateway(
        "swarm gateway did not finish stopping remote agent before deletion",
    ))
}

enum SwarmDeleteAttempt {
    Deleted,
    NeedsStop,
}

async fn send_swarm_delete(
    http: &reqwest::Client,
    url: &str,
    jwt: &str,
) -> ApiResult<SwarmDeleteAttempt> {
    let resp = http
        .delete(url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| {
            ApiError::bad_gateway(format!(
                "swarm gateway unreachable during machine deletion: {e}"
            ))
        })?;

    if resp.status().is_success() || resp.status().as_u16() == 404 {
        return Ok(SwarmDeleteAttempt::Deleted);
    }

    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    if status == 409 && swarm_delete_requires_stop(&body) {
        return Ok(SwarmDeleteAttempt::NeedsStop);
    }
    Err(match status {
        401 => ApiError::unauthorized("swarm gateway rejected auth token"),
        _ => ApiError::bad_gateway(format!(
            "swarm gateway returned {status} during machine deletion: {body}"
        )),
    })
}

async fn stop_swarm_agent(
    http: &reqwest::Client,
    swarm_base_url: &str,
    jwt: &str,
    agent_id: &str,
) -> ApiResult<()> {
    let url = format!("{}/v1/agents/{}/stop", swarm_base_url, agent_id);
    let resp = http
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| {
            ApiError::bad_gateway(format!(
                "swarm gateway unreachable during machine stop: {e}"
            ))
        })?;
    if resp.status().is_success() {
        return Ok(());
    }
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    if status == 409 && swarm_delete_requires_stop(&body) {
        return Ok(());
    }
    Err(match status {
        401 => ApiError::unauthorized("swarm gateway rejected auth token"),
        _ => ApiError::bad_gateway(format!(
            "swarm gateway returned {status} during machine stop: {body}"
        )),
    })
}

fn swarm_delete_requires_stop(body: &str) -> bool {
    body.contains("cannot transition from Running to Stopped")
        || body.contains("cannot transition from Hibernating to Stopped")
        || body.contains("cannot transition from Stopping to Stopped")
}

fn broadcast_recovery_phase(state: &AppState, agent_id: &str, phase: &str, error: Option<&str>) {
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "remote_agent_state_changed",
        "agent_id": agent_id,
        "state": if phase == "ready" { "running" } else if phase == "error" { "error" } else { "provisioning" },
        "action": "recover",
        "phase": phase,
        "error_message": error,
        "uptime_seconds": 0,
        "active_sessions": 0,
    }));
}
