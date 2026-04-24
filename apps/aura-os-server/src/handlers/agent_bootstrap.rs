use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::{info, warn};

use aura_os_core::{Agent, AgentOrchestration};
use aura_os_network::NetworkAgent;

use crate::capture_auth::{demo_agent, is_capture_access_token};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions_pub::agent_from_network;
use crate::handlers::agents::ensure_agent_home_project_and_binding;
use crate::harness_client::HarnessClient;
use crate::state::{AppState, AuthJwt, AuthSession};

#[derive(Serialize)]
pub(crate) struct SetupResponse {
    pub agent: Agent,
    pub created: bool,
}

#[derive(Serialize)]
pub(crate) struct CleanupCeoResponse {
    /// Agent ID of the single CEO that remains after cleanup, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kept: Option<String>,
    /// Agent IDs that were successfully deleted.
    pub deleted: Vec<String>,
    /// Agent IDs whose delete call failed (logged as warnings server-side).
    pub failed: Vec<String>,
}

/// True if a network agent record looks like a CEO bootstrap agent.
///
/// The canonical signal is [`AgentPermissions::is_ceo_preset`], but older
/// aura-network deployments don't persist the full `permissions` column
/// yet, in which case the permissions bundle comes back empty via
/// `#[serde(default)]`. We therefore treat `name == "CEO" && role == "CEO"`
/// as a fallback signal so the bootstrap never creates a duplicate CEO
/// just because the network forgot its permissions.
fn looks_like_ceo(net: &NetworkAgent) -> bool {
    if net.permissions.is_ceo_preset() {
        return true;
    }
    let role = net.role.as_deref().unwrap_or("");
    net.name.eq_ignore_ascii_case("CEO") && role.eq_ignore_ascii_case("CEO")
}

/// Sort CEO candidates so the oldest record is first. `created_at == None`
/// sorts last so records that do have a timestamp always win.
fn sort_ceo_candidates_oldest_first(candidates: &mut [&NetworkAgent]) {
    candidates.sort_by(|a, b| match (&a.created_at, &b.created_at) {
        (Some(a), Some(b)) => a.cmp(b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
}

/// Result of running the dedupe sweep: the canonical CEO (oldest match),
/// the list of IDs that were deleted, and the list of IDs whose delete
/// call failed. Never creates new agents.
struct DedupeOutcome<'a> {
    canonical: Option<&'a NetworkAgent>,
    deleted: Vec<String>,
    failed: Vec<String>,
}

/// Scan `net_agents` for CEO records, keep the oldest, and best-effort
/// delete the rest via `network.delete_agent`. Pure dedupe — no creates.
async fn dedupe_ceo_agents<'a>(
    network: &aura_os_network::NetworkClient,
    jwt: &str,
    net_agents: &'a [NetworkAgent],
) -> DedupeOutcome<'a> {
    let mut candidates: Vec<&NetworkAgent> =
        net_agents.iter().filter(|a| looks_like_ceo(a)).collect();
    sort_ceo_candidates_oldest_first(&mut candidates);

    let Some((canonical, extras)) = candidates.split_first() else {
        return DedupeOutcome {
            canonical: None,
            deleted: Vec::new(),
            failed: Vec::new(),
        };
    };

    let mut deleted: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    for dup in extras {
        match network.delete_agent(&dup.id, jwt).await {
            Ok(()) => {
                info!(agent_id = %dup.id, "deleted duplicate CEO agent");
                deleted.push(dup.id.clone());
            }
            Err(err) => {
                warn!(agent_id = %dup.id, error = %err, "failed to delete duplicate CEO agent");
                failed.push(dup.id.clone());
            }
        }
    }

    DedupeOutcome {
        canonical: Some(canonical),
        deleted,
        failed,
    }
}

/// Best-effort write-back of the CEO preset for a canonical CEO whose
/// network record has a non-preset permissions bundle.
///
/// This covers the case where the CEO was originally created against an
/// older aura-network deployment that didn't persist the `permissions`
/// column — or the field was lost via a migration — and so fetches come
/// back with an empty bundle. Without this repair the next fetch would
/// again hit the read-time safety net in
/// [`crate::handlers::agents::conversions::agent_from_network`] and every
/// subsequent server boot would keep papering over the same bug.
///
/// Any failure here is logged and swallowed; the caller still returns
/// the repaired in-memory agent, and the patch will be retried on the
/// next call to [`setup_ceo_agent`].
async fn ensure_canonical_ceo_permissions_persisted(
    network: &aura_os_network::NetworkClient,
    jwt: &str,
    canonical: &NetworkAgent,
) {
    if canonical.permissions.is_ceo_preset() {
        return;
    }
    // See the note in handlers/agents/conversions.rs: CEO agents ship
    // `intent_classifier: None` and rely on the static `CEO_CORE_TOOLS`
    // allowlist. Keep whatever the canonical record carries so we don't
    // stamp a stale classifier onto a freshly-repaired permissions bundle.
    let req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: None,
        tags: None,
        listing_status: None,
        expertise: None,
        permissions: Some(aura_os_core::AgentPermissions::ceo_preset()),
        intent_classifier: canonical.intent_classifier.clone(),
    };
    match network.update_agent(&canonical.id, jwt, &req).await {
        Ok(_) => info!(
            agent_id = %canonical.id,
            "repaired CEO permissions on canonical network record"
        ),
        Err(error) => warn!(
            agent_id = %canonical.id,
            error = %error,
            "failed to repair CEO permissions on canonical network record; retry next setup"
        ),
    }
}

/// Idempotent CEO-agent bootstrap.
///
/// Looks up the caller's first org, scans its agents for anyone already
/// holding the full [`AgentPermissions::ceo_preset`] bundle (with a
/// name/role fallback — see [`looks_like_ceo`]), and either returns that
/// record or creates a new one seeded with the preset via the standard
/// `create_agent` network pipeline. If the scan finds multiple CEO
/// records (e.g. from prior bootstrap races or permission round-trip
/// bugs), the oldest is kept and the rest are deleted so the agents
/// list stays clean.
pub(crate) async fn setup_ceo_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<SetupResponse>> {
    if is_capture_access_token(&jwt) {
        return Ok(Json(SetupResponse {
            agent: demo_agent(),
            created: false,
        }));
    }

    let network = state.require_network_client()?;

    let net_agents = network.list_agents(&jwt).await.map_err(map_network_error)?;

    let (org_name, org_id) = match network.list_orgs(&jwt).await {
        Ok(orgs) => orgs
            .first()
            .map(|o| (o.name.clone(), o.id.clone()))
            .unwrap_or_else(|| ("My Organization".into(), "default".into())),
        Err(_) => ("My Organization".into(), "default".into()),
    };

    let outcome = dedupe_ceo_agents(network, &jwt, &net_agents).await;
    if let Some(canonical) = outcome.canonical {
        // Older aura-network deployments didn't persist the
        // `permissions` column for agents, leaving the canonical CEO
        // with an empty permissions bundle on read. That breaks
        // `is_ceo_preset()`-gated code paths (Permissions tab toggles,
        // `build_cross_agent_tools` manifest, etc.). Best-effort patch
        // the network copy so the fix sticks; the in-memory `Agent`
        // returned to the caller is further repaired by
        // `conversions::agent_from_network` so the UI is correct even
        // if the patch fails.
        ensure_canonical_ceo_permissions_persisted(network, &jwt, canonical).await;
        let mut agent = agent_from_network(canonical);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        if agent.icon.is_none() {
            if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                agent.icon = shadow.icon;
            }
        }
        // Stamp the canonical CEO `agent_id` into settings so the
        // read-time reconciler can still recognise this agent as the
        // CEO after the user renames it — see
        // `AgentService::reconcile_permissions_with_shadow`.
        state.agent_service.remember_ceo_agent_id(&agent.agent_id);
        let _ = state.agent_service.save_agent_shadow(&agent);
        ensure_agent_home_project_and_binding(&state, &jwt, &agent).await;
        return Ok(Json(SetupResponse {
            agent,
            created: false,
        }));
    }

    let template = aura_os_agent_tools::ceo::ceo_agent_template(&org_name, &org_id);

    let net_req = aura_os_network::CreateAgentRequest {
        name: template.name,
        role: Some(template.role),
        personality: Some(template.personality),
        system_prompt: Some(template.system_prompt),
        skills: None,
        icon: None,
        harness: None,
        machine_type: Some("local".to_string()),
        org_id: Some(org_id),
        tags: None,
        listing_status: None,
        expertise: None,
        permissions: template.permissions,
        intent_classifier: template.intent_classifier,
    };

    let net_agent = network
        .create_agent(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let mut agent = agent_from_network(&net_agent);
    let _ = state.agent_service.apply_runtime_config(&mut agent);
    // Stamp the freshly-created CEO `agent_id` into settings so the
    // read-time reconciler can still recognise this agent as the CEO
    // after the user renames it — see
    // `AgentService::reconcile_permissions_with_shadow`.
    state.agent_service.remember_ceo_agent_id(&agent.agent_id);
    let _ = state.agent_service.save_agent_shadow(&agent);

    let default_skills = [
        "orchestration",
        "project-management",
        "fleet-management",
        "cost-analysis",
    ];
    let agent_id_str = agent.agent_id.to_string();
    for skill in default_skills {
        state
            .harness_http
            .install_skill_for_agent(&agent_id_str, skill)
            .await;
    }

    info!(agent_id = %agent.agent_id, "CEO agent created");
    ensure_agent_home_project_and_binding(&state, &jwt, &agent).await;
    Ok(Json(SetupResponse {
        agent,
        created: true,
    }))
}

pub(crate) async fn list_orchestrations(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<AgentOrchestration>>> {
    let store = aura_os_agent_runtime::state::OrchestrationStore::new(state.store.clone());
    let orchestrations = store.list().map_err(ApiError::internal)?;
    Ok(Json(orchestrations))
}

pub(crate) async fn get_orchestration(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(orchestration_id): Path<String>,
) -> ApiResult<Json<AgentOrchestration>> {
    let id = uuid::Uuid::parse_str(&orchestration_id)
        .map_err(|_| ApiError::bad_request("invalid orchestration ID"))?;
    let store = aura_os_agent_runtime::state::OrchestrationStore::new(state.store.clone());
    let orch = store
        .get(&id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("orchestration not found"))?;
    Ok(Json(orch))
}

pub(crate) async fn list_pending_events(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
) -> ApiResult<Json<Vec<aura_os_agent_runtime::events::AgentEvent>>> {
    let events = state.agent_runtime.event_listener.peek_events().await;
    Ok(Json(events))
}

/// GET `/api/agent-bootstrap/harness/health` — report whether the configured
/// harness URL is reachable so the agent editor can show a Cloud
/// health pill. Purely advisory; never blocks chat.
///
/// Forwards the caller's JWT so the probed endpoint behaves the same way
/// it would during a real hand-off (this doubles as a JWT-forwarding
/// sanity check for the remote-harness flow).
pub(crate) async fn harness_health(
    State(_state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> Json<crate::harness_client::HarnessProbeResult> {
    let client = HarnessClient::from_env();
    Json(client.probe(Some(&jwt)).await)
}

/// POST `/api/agents/harness/cleanup` — one-shot dedupe of CEO bootstrap
/// agents. Keeps the oldest CEO record and deletes every other agent
/// matching [`looks_like_ceo`]. Never creates a new CEO, so calling this
/// on an account with zero CEO agents is a no-op (the caller can still
/// hit `/api/agents/harness/setup` afterwards to bootstrap one).
pub(crate) async fn cleanup_ceo_agents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<CleanupCeoResponse>> {
    if is_capture_access_token(&jwt) {
        return Ok(Json(CleanupCeoResponse {
            kept: Some(demo_agent().agent_id.to_string()),
            deleted: Vec::new(),
            failed: Vec::new(),
        }));
    }

    let network = state.require_network_client()?;
    let net_agents = network.list_agents(&jwt).await.map_err(map_network_error)?;
    let outcome = dedupe_ceo_agents(network, &jwt, &net_agents).await;
    Ok(Json(CleanupCeoResponse {
        kept: outcome.canonical.map(|a| a.id.clone()),
        deleted: outcome.deleted,
        failed: outcome.failed,
    }))
}
