use axum::http::StatusCode;
use tracing::warn;

use aura_os_agents::AgentError;
use aura_os_core::{AgentId, ZeroAuthSession};

use crate::capture_auth::{demo_agent_id, is_capture_access_token};
use crate::state::AppState;

pub(crate) async fn require_agent_proxy_access(
    state: &AppState,
    jwt: &str,
    session: &ZeroAuthSession,
    agent_id: &AgentId,
) -> Result<(), StatusCode> {
    if state.harness_http.hosted_base_requires_transport_auth() {
        warn!(
            %agent_id,
            "refusing hosted local harness proxy without LOCAL_HARNESS_AUTH_TOKEN"
        );
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    if !state.harness_http.has_transport_auth() {
        return Ok(());
    }

    if is_capture_access_token(jwt) && *agent_id == demo_agent_id() {
        return Ok(());
    }

    if state.network_client.is_some() {
        return match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
            Ok(_) => Ok(()),
            Err(AgentError::NotFound) => Err(StatusCode::FORBIDDEN),
            Err(error) => {
                warn!(%agent_id, %error, "harness proxy agent access check failed");
                Err(StatusCode::FORBIDDEN)
            }
        };
    }

    let agent = state
        .agent_service
        .get_agent_local(agent_id)
        .map_err(|error| {
            warn!(%agent_id, %error, "harness proxy local agent access check failed");
            StatusCode::FORBIDDEN
        })?;

    let owns_agent = agent.user_id == session.user_id
        || session
            .network_user_id
            .as_ref()
            .is_some_and(|user_id| agent.user_id == user_id.to_string());

    if owns_agent {
        Ok(())
    } else {
        warn!(
            %agent_id,
            agent_user_id = %agent.user_id,
            session_user_id = %session.user_id,
            "harness proxy local agent ownership check failed"
        );
        Err(StatusCode::FORBIDDEN)
    }
}
