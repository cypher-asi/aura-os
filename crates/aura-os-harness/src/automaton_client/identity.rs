use crate::error::HarnessError;

use super::start_params::AutomatonStartParams;

/// Tier 2 fail-fast: harness-side preflight for
/// [`AutomatonClient::start`] payloads, mirroring the contract on
/// [`crate::validate_session_init_identity`] for the chat / direct
/// session path.
///
/// Validates the *intersection* of fields every dev-loop /
/// single-task / scheduled-process automaton needs so the upstream
/// proxy can stamp `X-Aura-*`. `user_id` is intentionally not
/// required at this layer because some scheduled-process flows
/// genuinely have no signed-in user; server-side Tier 1 enforces it
/// per call site for the dev-loop / single-task path.
///
/// [`AutomatonClient::start`]: super::AutomatonClient::start
pub fn validate_automaton_start_identity(
    params: &AutomatonStartParams,
) -> Result<(), HarnessError> {
    if blank(params.aura_org_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "automaton_start",
        });
    }
    if blank(params.aura_session_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_session_id",
            context: "automaton_start",
        });
    }
    if blank(params.template_agent_id.as_deref())
        && blank(params.aura_agent_id.as_deref())
        && blank(params.agent_id.as_deref())
    {
        return Err(HarnessError::SessionIdentityMissing {
            field: "agent_id",
            context: "automaton_start",
        });
    }
    if blank(params.auth_token.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "auth_token",
            context: "automaton_start",
        });
    }
    Ok(())
}

fn blank(value: Option<&str>) -> bool {
    value.map(|v| v.trim().is_empty()).unwrap_or(true)
}
