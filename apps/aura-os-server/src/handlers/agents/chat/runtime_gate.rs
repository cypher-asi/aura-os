use aura_os_core::HarnessMode;

use crate::error::{ApiError, ApiResult};
use crate::handlers::swarm::fetch_remote_agent_state;
use crate::state::AppState;

pub(super) fn ensure_chat_runtime_allowed(
    state: &AppState,
    harness_mode: HarnessMode,
) -> ApiResult<()> {
    if state.remote_only && harness_mode == HarnessMode::Local {
        return Err(ApiError::bad_request(
            "local agents can only be used in the desktop app",
        ));
    }
    Ok(())
}

/// Cross-agent turns are initiated by a model tool, so there is no composer
/// UI available to prevent a delivery to a stopped remote runtime. Check the
/// live VM state at the server boundary and return a tool-visible failure.
///
/// This intentionally runs only for cross-agent turns. User-authored remote
/// chats already have an availability guard in the client, and should not pay
/// for a second state request on every message.
pub(super) async fn ensure_cross_agent_runtime_available(
    state: &AppState,
    jwt: &str,
    agent_id: &str,
    harness_mode: HarnessMode,
) -> ApiResult<()> {
    ensure_chat_runtime_allowed(state, harness_mode)?;
    if harness_mode != HarnessMode::Swarm {
        return Ok(());
    }

    let remote = fetch_remote_agent_state(state, jwt, agent_id).await?;
    if remote_state_accepts_chat(&remote.state) {
        return Ok(());
    }

    Err(ApiError::service_unavailable(format!(
        "target agent is not available for delegation (remote state: {})",
        normalized_remote_state(&remote.state),
    )))
}

fn remote_state_accepts_chat(state: &str) -> bool {
    matches!(
        state.trim().to_ascii_lowercase().as_str(),
        "running" | "working"
    )
}

fn normalized_remote_state(state: &str) -> &str {
    let state = state.trim();
    if state.is_empty() {
        "unknown"
    } else {
        state
    }
}

#[cfg(test)]
mod tests {
    use super::{normalized_remote_state, remote_state_accepts_chat};

    #[test]
    fn remote_delegation_accepts_only_live_states() {
        for state in ["running", "working", " RUNNING "] {
            assert!(remote_state_accepts_chat(state), "{state}");
        }
        for state in [
            "",
            "provisioning",
            "hibernating",
            "stopping",
            "stopped",
            "offline",
            "error",
            "blocked",
        ] {
            assert!(!remote_state_accepts_chat(state), "{state}");
        }
    }

    #[test]
    fn blank_remote_state_is_reported_as_unknown() {
        assert_eq!(normalized_remote_state("  "), "unknown");
        assert_eq!(normalized_remote_state("hibernating"), "hibernating");
    }
}
