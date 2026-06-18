//! Step 3 of the run pipeline: start (or adopt) the harness
//! automaton, with mode-specific handling for the conflict /
//! identity-guard / capacity branches.
//!
//! [`RunMode::Automation`] dispatches through
//! [`super::super::start::start_or_adopt`], which already wraps the
//! conflict + identity preflight + capacity-503 handling. After a
//! successful adoption, the controller consults
//! [`super::super::registry::can_reuse_forwarder`] to decide whether
//! the existing live forwarder is fresh enough to short-circuit the
//! rest of the bootstrap.
//!
//! [`RunMode::SingleTask`] mints a fresh ephemeral, so there is
//! never an automaton to adopt - the path runs the identity guard
//! once and calls `client.start` directly. Failures in either step
//! trigger the same ephemeral-row cleanup the pre-refactor handler
//! performed.

use aura_os_harness::{submit_automaton_run, AutomatonStartParams};

use crate::error::ApiResult;
use crate::handlers::agents::session_identity::{
    validate_automaton_identity, SessionIdentityRequirements,
};

use super::super::start::{build_start_params, map_start_error, start_or_adopt, StartParamsInputs};
use super::super::types::StartedAutomaton;
use super::context::{spawn_ephemeral_cleanup_if_single, RunContext};
use super::request::{RunMode, RunRequest};

/// Outcome of [`start_automaton`]. The `AdoptShortcutReused` variant
/// is the controller's signal to bypass the rest of the pipeline and
/// reply with the already-live registry entry.
pub(super) enum StartOutcome {
    /// Cold start (or adopted start with no live forwarder to
    /// reuse). Controller continues through the remaining pipeline
    /// steps.
    Cold { started: StartedAutomaton },
    /// Adopted an existing automaton AND
    /// [`super::super::registry::can_reuse_forwarder`] approved the
    /// live registry entry. Controller short-circuits.
    AdoptShortcutReused { started: StartedAutomaton },
}

pub(super) async fn start_automaton(
    req: &RunRequest,
    prep: &RunContext,
) -> ApiResult<StartOutcome> {
    let params = build_start_params(StartParamsInputs {
        state: &req.state,
        ctx: &prep.start,
        agent_instance_id: req.agent_instance_id,
        jwt: Some(req.jwt.clone()),
        user_id: Some(req.user_id.clone()),
        task_id: prep.task_id_str.clone(),
        loop_engineering: req.loop_engineering.as_ref(),
    })
    .await;

    match req.mode {
        RunMode::Automation => start_or_adopt_with_shortcut(req, prep, params).await,
        RunMode::SingleTask { .. } => start_single_task_automaton(req, prep, params).await,
    }
}

async fn start_or_adopt_with_shortcut(
    req: &RunRequest,
    prep: &RunContext,
    params: AutomatonStartParams,
) -> ApiResult<StartOutcome> {
    let started = start_or_adopt(
        prep.start.client.as_ref(),
        &prep.start.harness_base_url,
        prep.start.harness_auth_token.as_deref(),
        params,
        req.state.harness_ws_slots,
    )
    .await?;
    if started.adopted
        && super::super::registry::can_reuse_forwarder(
            &req.state,
            req.project_id,
            req.agent_instance_id,
            &started.automaton_id,
        )
        .await
    {
        return Ok(StartOutcome::AdoptShortcutReused { started });
    }
    Ok(StartOutcome::Cold { started })
}

async fn start_single_task_automaton(
    req: &RunRequest,
    prep: &RunContext,
    params: AutomatonStartParams,
) -> ApiResult<StartOutcome> {
    // Tier 1 fail-fast: refuse to POST /automaton/start with a
    // payload missing one of the required X-Aura-* identity fields.
    // Mirrors the guard inside `start_or_adopt` for the dev-loop
    // path - applied uniformly here so single-task runs go through
    // `validate_automaton_identity` exactly once instead of being
    // duplicated in the adapter.
    if let Err(err) = validate_automaton_identity(
        &params,
        SessionIdentityRequirements::DEV_LOOP,
        "single_task_automaton",
    ) {
        spawn_ephemeral_cleanup_if_single(req);
        return Err(err);
    }
    let result = match submit_automaton_run(
        prep.start.client.as_ref(),
        params,
        prep.start.harness_auth_token.as_deref(),
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            spawn_ephemeral_cleanup_if_single(req);
            return Err(map_start_error(
                &prep.start.harness_base_url,
                error,
                req.state.harness_ws_slots,
            ));
        }
    };
    Ok(StartOutcome::Cold {
        started: StartedAutomaton {
            automaton_id: result.run_id,
            event_stream_url: Some(result.event_stream_url),
            adopted: false,
        },
    })
}
