use axum::extract::{Path, State};
use axum::Json;
use tracing::warn;

use aura_os_core::{Agent, AgentId};

use crate::dto::UpdateAgentRequest;
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions::agent_from_network;
use crate::handlers::agents::marketplace_fields::{
    merge_marketplace_tags, normalize_marketplace_fields,
};
use crate::state::{AppState, AuthJwt};

use super::validation::{build_runtime_config, ensure_supported_agent_name, RuntimeConfigInputs};

pub(crate) async fn update_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<UpdateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    let client = state.require_network_client()?;
    let existing = load_existing_agent(&state, &agent_id).await?;
    validate_renamed_agent(&body, &existing)?;

    let prepared = prepare_update(&body, &existing)?;
    let submitted_permissions = body.permissions.clone();

    let net_agent = client
        .update_agent(&agent_id.to_string(), &jwt, &prepared.net_req)
        .await
        .map_err(map_network_error)?;
    state
        .agent_service
        .save_agent_runtime_config(&agent_id, &prepared.runtime_config)
        .map_err(|e| ApiError::internal(format!("saving agent runtime config: {e}")))?;

    let mut agent = agent_from_network(&net_agent);
    reconcile_post_update(
        &state,
        &mut agent,
        &agent_id,
        submitted_permissions.as_ref(),
    )?;
    apply_local_overrides(
        &state,
        &mut agent,
        &existing,
        &body,
        prepared.submitted_icon,
    );
    let _ = state.agent_service.save_agent_shadow(&agent);

    invalidate_chat_sessions_for_agent(&state, &agent_id).await;
    Ok(Json(agent))
}

async fn load_existing_agent(state: &AppState, agent_id: &AgentId) -> ApiResult<Agent> {
    state
        .agent_service
        .get_agent_async("", agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(agent_id))
        .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))
}

fn validate_renamed_agent(body: &UpdateAgentRequest, existing: &Agent) -> ApiResult<()> {
    if let Some(name) = body.name.as_ref() {
        let trimmed = name.trim();
        if trimmed != existing.name {
            ensure_supported_agent_name(trimmed)?;
        }
    }
    Ok(())
}

/// Validated update inputs derived from an [`UpdateAgentRequest`]. Splitting
/// the request prep out of [`update_agent`] keeps the handler body under
/// the 50-line cap while preserving the original semantics.
struct PreparedUpdate {
    runtime_config: aura_os_core::AgentRuntimeConfig,
    net_req: aura_os_network::UpdateAgentRequest,
    submitted_icon: Option<String>,
}

fn prepare_update(body: &UpdateAgentRequest, existing: &Agent) -> ApiResult<PreparedUpdate> {
    let runtime_config = build_runtime_config(merged_runtime_inputs(body, existing))?;
    let submitted_icon = match &body.icon {
        Some(Some(url)) => Some(url.clone()),
        _ => None,
    };
    // `body.tags == Some(vec)` replaces the tag set wholesale; `None` leaves
    // the aura-network-stored tags untouched so host-mode / role tags survive
    // partial PUTs. Marketplace fields (`listing_status`, `expertise`) are
    // sent as typed columns on the network request — see Phase 3 migration
    // for the schema change.
    let marketplace =
        normalize_marketplace_fields(body.listing_status.as_deref(), body.expertise.as_deref())?;
    let dual_write_tags = merge_marketplace_tags(body.tags.clone(), &marketplace);
    let net_req = build_network_update(body, &runtime_config, dual_write_tags, &marketplace);
    Ok(PreparedUpdate {
        runtime_config,
        net_req,
        submitted_icon,
    })
}

fn merged_runtime_inputs(body: &UpdateAgentRequest, existing: &Agent) -> RuntimeConfigInputs {
    let merged_machine_type = body
        .machine_type
        .clone()
        .unwrap_or_else(|| existing.machine_type.clone());
    RuntimeConfigInputs {
        adapter_type: body
            .adapter_type
            .clone()
            .or_else(|| Some(existing.adapter_type.clone())),
        environment: body
            .environment
            .clone()
            .or_else(|| Some(existing.environment.clone())),
        auth_source: body
            .auth_source
            .clone()
            .or_else(|| Some(existing.auth_source.clone())),
        integration_id: match body.integration_id.clone() {
            Some(value) => value,
            None => existing.integration_id.clone(),
        },
        default_model: match body.default_model.clone() {
            Some(value) => value,
            None => existing.default_model.clone(),
        },
        machine_type: Some(merged_machine_type),
    }
}

fn build_network_update(
    body: &UpdateAgentRequest,
    runtime_config: &aura_os_core::AgentRuntimeConfig,
    dual_write_tags: Option<Vec<String>>,
    marketplace: &crate::handlers::agents::marketplace_fields::MarketplaceFields,
) -> aura_os_network::UpdateAgentRequest {
    aura_os_network::UpdateAgentRequest {
        name: body.name.clone().map(|value| value.trim().to_string()),
        role: body.role.clone(),
        personality: body.personality.clone(),
        system_prompt: body.system_prompt.clone(),
        skills: body.skills.clone(),
        icon: match body.icon.clone() {
            Some(Some(url)) => Some(url),
            Some(None) => Some(String::new()),
            None => None,
        },
        machine_type: Some(if runtime_config.environment == "swarm_microvm" {
            "remote".to_string()
        } else {
            "local".to_string()
        }),
        harness: None,
        vm_id: None,
        tags: dual_write_tags,
        listing_status: marketplace.listing_status.clone(),
        expertise: marketplace.expertise.clone(),
        permissions: body.permissions.clone(),
        intent_classifier: body.intent_classifier.clone(),
    }
}

/// Defensive reconciliation: if the caller sent a `permissions` bundle but
/// aura-network's PUT response came back with something that doesn't match
/// (classic symptom: upstream persists the column but doesn't echo it in the
/// response, or an older deployment that silently drops the field), trust
/// what we just sent. Without this the UI's `patchAgent(updated)` call wipes
/// every toggle the user just saved because `agent_from_network` defaulted
/// `permissions` to empty.
///
/// We do NOT re-fetch the agent to verify — a single PUT that returns 200 is
/// the source of truth for persistence. We only override the local
/// projection of the response when it disagrees with the request payload.
fn reconcile_post_update(
    state: &AppState,
    agent: &mut Agent,
    agent_id: &AgentId,
    submitted_permissions: Option<&aura_os_core::AgentPermissions>,
) -> ApiResult<()> {
    if let Some(submitted) = submitted_permissions {
        if agent.permissions != *submitted {
            warn!(
                agent_id = %agent_id,
                submitted_capabilities = submitted.capabilities.len(),
                response_capabilities = agent.permissions.capabilities.len(),
                "aura-network PUT response did not echo the submitted `permissions` bundle; using the request-side value"
            );
            agent.permissions = submitted.clone();
        }
    }
    // Symmetric fallback for the common "edit form didn't submit
    // `permissions`" case (e.g. the AgentEditorModal only edits name /
    // system_prompt / personality today). When `submitted_permissions`
    // is `None` and aura-network's PUT response omitted the column,
    // `agent.permissions` is empty here — same regression that
    // `reconcile_permissions_with_shadow` fixes on the GET / list read
    // paths. Without this, renaming the CEO SuperAgent strips its
    // preset bundle on save and the UI's `isSuperAgent` check fails
    // (both the capability-based primary check and the CEO/CEO name
    // fallback), so the CEO preset banner disappears and individual
    // toggles appear. We reconcile before `save_agent_shadow` below so
    // we never overwrite a good shadow with the empty projection.
    state.agent_service.reconcile_permissions_with_shadow(agent);
    state
        .agent_service
        .apply_runtime_config(agent)
        .map_err(|e| ApiError::internal(format!("applying agent runtime config: {e}")))?;
    Ok(())
}

fn apply_local_overrides(
    state: &AppState,
    agent: &mut Agent,
    existing: &Agent,
    body: &UpdateAgentRequest,
    submitted_icon: Option<String>,
) {
    if agent.icon.is_none() {
        agent.icon = submitted_icon.or_else(|| {
            state
                .agent_service
                .get_agent_local(&agent.agent_id)
                .ok()
                .and_then(|s| s.icon)
        });
    }
    // Patch-style semantics for the local override:
    //   None            -> preserve existing value
    //   Some(None)      -> clear it
    //   Some(Some(p))   -> set it (trim; treat empty as clear)
    agent.local_workspace_path = match body.local_workspace_path.clone() {
        None => existing.local_workspace_path.clone(),
        Some(None) => None,
        Some(Some(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
    };
}

/// Invalidate any live harness session + dispatcher permissions cache keyed
/// off this agent so a later chat turn re-evaluates the freshly-saved
/// `permissions` bundle.
///
/// Why this is needed: harness sessions cache the server `installed_tools`
/// list and the native tool definitions they were seeded with at startup.
/// Cross-agent tools are harness-native and are surfaced by
/// `visible_tools_with_permissions` from `SessionConfig.agent_permissions`;
/// without invalidation, toggling a capability in the UI would not affect
/// the visible tool set until a fresh session starts. The next
/// `POST /api/.../chat` cold-starts through `setup_agent_chat_persistence`
/// and sends the freshly normalized permissions bundle to the harness.
///
/// Scope of invalidation: every live `ChatSession` whose
/// `template_agent_id` matches this agent — including both the direct
/// bare-agent session (`{template}::default` partition) and any
/// project-bound instance sessions (`{template}::{instance}` partition)
/// whose underlying agent template is this one. Back-reference via
/// `ChatSession::template_agent_id` (populated in
/// `get_or_create_chat_session` from `SessionConfig::template_agent_id`)
/// so we can resolve all affected sessions from a single in-memory sweep
/// instead of a per-key storage round-trip. Best-effort: lock contention
/// failures are silently dropped rather than failing the update — the
/// worst case is a stale session that will self-correct on the next
/// `reset_*_session` call or a server restart.
async fn invalidate_chat_sessions_for_agent(state: &AppState, agent_id: &AgentId) {
    let target_template_id = agent_id.to_string();
    let mut reg = state.chat_sessions.lock().await;
    let keys_to_drop: Vec<String> = reg
        .iter()
        .filter_map(|(key, session)| {
            let owner = session.template_agent_id.as_deref()?;
            (owner == target_template_id).then(|| key.clone())
        })
        .collect();
    for key in keys_to_drop {
        reg.remove(&key);
    }
}
