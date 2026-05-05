use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::warn;

use aura_os_core::{Agent, AgentId};
use aura_os_network::{NetworkAgent, NetworkClient};

use crate::capture_auth::{demo_agent, demo_agent_id, is_capture_access_token};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions::agent_from_network;
use crate::handlers::agents::instances::{repair_agent_name_in_place, repair_agent_name_only};
use crate::state::{AppState, AuthJwt};

/// Response shape selector for `GET /api/agents`.
///
/// Defaults to `Full` so existing UI / integrator callers (sidebar,
/// AgentSelectorModal, ProjectAgentsView, etc.) keep getting the full
/// `Agent` payload they need for icons, prompts, and the editor.
///
/// `Slim` is the contract used by the aura-harness `list_agents` LLM
/// tool — see `AuraServerAgentHook::list_agents` in
/// `../aura-harness/crates/aura-runtime/src/session/cross_agent_hook.rs`.
/// It returns only `{agent_id, name, role}` per agent so the LLM tool
/// result stays well under the harness's 8 KB per-tool-result cap and
/// the chat-history `TOOL_BLOB_MAX_BYTES` replay cap (see
/// `crate::handlers::agents::chat::constants`). Without this, a fleet of
/// 14 agents with base64 WebP icons (~15–50 KB each) overflows mid-record
/// and the model can't read agent names past the first one or two.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentListView {
    #[default]
    Full,
    Slim,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ListAgentsQuery {
    /// When set, return the fleet for this organization (every member's
    /// agents, not just the caller's). Mirrors aura-network's
    /// `/api/agents?org_id=...` contract — the aura-network handler
    /// verifies membership before dropping the user_id filter, so
    /// passing an arbitrary org id safely 403s instead of leaking.
    pub org_id: Option<String>,
    /// Response shape; defaults to `Full`. See [`AgentListView`] for the
    /// rationale behind `view=slim`.
    #[serde(default)]
    pub view: Option<AgentListView>,
}

/// Slim wire shape for `GET /api/agents?view=slim`. See [`AgentListView`].
///
/// Field ordering and naming are part of the cross-repo contract with
/// `aura-harness` — keep this struct minimal so future field creep
/// doesn't silently re-bloat the LLM `list_agents` tool result. The
/// regression test below pins the JSON keys to exactly these three.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentSummary {
    pub agent_id: AgentId,
    pub name: String,
    pub role: String,
}

impl From<&Agent> for AgentSummary {
    fn from(agent: &Agent) -> Self {
        Self {
            agent_id: agent.agent_id,
            name: agent.name.clone(),
            role: agent.role.clone(),
        }
    }
}

fn to_summaries(agents: &[Agent]) -> Vec<AgentSummary> {
    agents.iter().map(AgentSummary::from).collect()
}

/// `GET /api/agents` — list agents visible to the caller.
///
/// Two shapes are supported via `?view=`:
/// * `view=full` (default): full `Vec<Agent>` for UI surfaces.
/// * `view=slim`: `Vec<AgentSummary>` (`{agent_id, name, role}`) for
///   the aura-harness `list_agents` LLM tool. See [`AgentListView`] for
///   the rationale and the cross-repo contract.
///
/// The slim path skips the per-agent shadow merge / permissions
/// reconciliation / runtime-config apply work, and the background
/// shadow flush, since none of those affect fields the slim shape
/// returns and the tool path is hot.
pub(crate) async fn list_agents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<ListAgentsQuery>,
) -> ApiResult<Response> {
    let view = query.view.unwrap_or_default();

    if is_capture_access_token(&jwt) {
        let demo = demo_agent();
        return Ok(match view {
            AgentListView::Slim => Json(vec![AgentSummary::from(&demo)]).into_response(),
            AgentListView::Full => Json(vec![demo]).into_response(),
        });
    }

    if let Some(ref client) = state.network_client {
        let net_agents = fetch_list_for_caller(client, &jwt, query.org_id.as_deref()).await?;
        return Ok(match view {
            AgentListView::Slim => {
                let summaries = project_listed_agents_slim(&net_agents);
                Json(summaries).into_response()
            }
            AgentListView::Full => {
                let agents = project_listed_agents(&state, &net_agents);
                spawn_shadow_flush(&state, &agents);
                Json(agents).into_response()
            }
        });
    }

    let mut agents = state
        .agent_service
        .list_agents()
        .map_err(|e| ApiError::internal(format!("listing agents: {e}")))?;
    for agent in agents.iter_mut() {
        repair_agent_name_in_place(&state.agent_service, agent);
    }
    Ok(match view {
        AgentListView::Slim => Json(to_summaries(&agents)).into_response(),
        AgentListView::Full => Json(agents).into_response(),
    })
}

/// Fetch the network-side agent list for the caller. When `org_id` is
/// provided we issue the org-scoped and user-scoped calls concurrently and
/// merge by `agent_id` so legacy NULL-org rows still surface in the sidebar.
/// The org-scoped entry wins on conflict to keep fleet-membership metadata
/// (e.g. teammate user_ids) intact.
async fn fetch_list_for_caller(
    client: &NetworkClient,
    jwt: &str,
    org_id: Option<&str>,
) -> ApiResult<Vec<NetworkAgent>> {
    let scoped_org = org_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let Some(org_id) = scoped_org else {
        return client.list_agents(jwt).await.map_err(map_network_error);
    };

    let org_scoped = client.list_agents_by_org(&org_id, jwt);
    let user_scoped = client.list_agents(jwt);
    let (org_agents, user_agents) = tokio::join!(org_scoped, user_scoped);
    let org_agents = org_agents.map_err(map_network_error)?;
    // The user-scoped call is a best-effort backstop for legacy NULL-org
    // agents; if it fails (e.g. transient aura-network blip), fall back to
    // the org view alone rather than failing the whole sidebar refresh.
    let user_agents = match user_agents {
        Ok(list) => list,
        Err(err) => {
            warn!(
                error = %err,
                "list_agents: user-scoped backstop failed; returning org-scoped result only"
            );
            Vec::new()
        }
    };

    let mut merged: Vec<NetworkAgent> = Vec::with_capacity(org_agents.len() + user_agents.len());
    let mut seen = std::collections::HashSet::with_capacity(org_agents.len() + user_agents.len());
    for na in org_agents.into_iter().chain(user_agents.into_iter()) {
        if seen.insert(na.id.clone()) {
            merged.push(na);
        }
    }
    Ok(merged)
}

/// Slim projection used only when `view=slim`. Skips the icon shadow
/// merge, runtime-config apply, and permissions reconciliation that
/// `project_listed_agents` performs for the full payload — none of
/// those affect `{agent_id, name, role}`. Name repair still runs so
/// the LLM sees the same friendly name as the UI for placeholder
/// rows.
fn project_listed_agents_slim(net_agents: &[NetworkAgent]) -> Vec<AgentSummary> {
    net_agents
        .iter()
        .map(|na| {
            let mut agent = agent_from_network(na);
            repair_agent_name_only(&mut agent);
            AgentSummary::from(&agent)
        })
        .collect()
}

fn project_listed_agents(state: &AppState, net_agents: &[NetworkAgent]) -> Vec<Agent> {
    net_agents
        .iter()
        .map(|na| {
            let mut agent = agent_from_network(na);
            let _ = state.agent_service.apply_runtime_config(&mut agent);
            if agent.icon.is_none() {
                if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                    agent.icon = shadow.icon;
                }
            }
            // Read-time reconciliation: aura-network's list response
            // historically drops the `permissions` column for non-CEO
            // agents, which meant every app-boot sidebar refresh
            // clobbered the shadow (and the UI toggles) with the
            // empty default. Mirrors the PUT-side defensive
            // reconciliation — see
            // `AgentService::reconcile_permissions_with_shadow` for
            // the full rationale.
            state
                .agent_service
                .reconcile_permissions_with_shadow(&mut agent);
            // Repair blank names in-memory so the "New Agent" placeholder
            // (and the UI renames that key off it) cascade to both
            // library and project listings. Persistence happens in the
            // batched background flush below.
            repair_agent_name_only(&mut agent);
            agent
        })
        .collect()
}

fn spawn_shadow_flush(state: &AppState, agents: &[Agent]) {
    // Flush shadow changes as a SINGLE batched write on a blocking
    // thread so the response isn't gated on N full `settings.json`
    // rewrites (see `AgentService::save_agent_shadows_if_changed`).
    // The shadow is a cache — failures are logged but don't fail the
    // request, matching the prior `let _ = save_agent_shadow(..)`
    // semantics.
    let service = state.agent_service.clone();
    let snapshot = agents.to_vec();
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&Agent> = snapshot.iter().collect();
        match service.save_agent_shadows_if_changed(&refs) {
            Ok(n) if n > 0 => tracing::debug!(
                changed = n,
                total = refs.len(),
                "list_agents: persisted shadow diffs"
            ),
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "list_agents: shadow flush failed"),
        }
    });
}

pub(crate) async fn get_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Agent>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(demo_agent()));
    }

    if let Some(ref client) = state.network_client {
        let net_agent = client
            .get_agent(&agent_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
        let mut agent = agent_from_network(&net_agent);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        if agent.icon.is_none() {
            if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                agent.icon = shadow.icon;
            }
        }
        // Read-time permissions reconciliation — see
        // `AgentService::reconcile_permissions_with_shadow`. Must run
        // before `save_agent_shadow` so an empty network response
        // never overwrites the last-known-good toggles on disk.
        state
            .agent_service
            .reconcile_permissions_with_shadow(&mut agent);
        repair_agent_name_in_place(&state.agent_service, &mut agent);
        let _ = state.agent_service.save_agent_shadow(&agent);
        return Ok(Json(agent));
    }

    let mut agent = state
        .agent_service
        .get_agent_local(&agent_id)
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(format!("fetching agent: {e}")),
        })?;
    repair_agent_name_in_place(&state.agent_service, &mut agent);
    Ok(Json(agent))
}

#[cfg(test)]
mod tests {
    //! Pin the slim wire shape and the `view=` query parsing so the
    //! cross-repo contract with `aura-harness`'s `list_agents` LLM tool
    //! cannot silently regress. Field creep on `AgentSummary` is what
    //! re-bloats the tool result and overflows the 8 KB harness cap;
    //! catching it here is cheaper than another round of "stop the
    //! list_agents truncation" patches.
    use super::*;
    use aura_os_core::AgentId;
    use serde_json::Value;

    fn sample_summary() -> AgentSummary {
        AgentSummary {
            agent_id: AgentId::new(),
            name: "Spok".into(),
            role: "Science Officer".into(),
        }
    }

    #[test]
    fn slim_summary_serializes_only_id_name_role() {
        let serialized = serde_json::to_value(sample_summary()).expect("serialize");
        let Value::Object(map) = serialized else {
            panic!("expected object, got {serialized:?}");
        };
        let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(
            keys,
            vec!["agent_id", "name", "role"],
            "AgentSummary must stay {{agent_id, name, role}} — adding fields here re-bloats the harness `list_agents` tool result"
        );
    }

    #[test]
    fn slim_summary_excludes_heavy_fields() {
        let serialized = serde_json::to_string(&sample_summary()).expect("serialize");
        for forbidden in [
            "icon",
            "system_prompt",
            "personality",
            "permissions",
            "skills",
            "expertise",
            "intent_classifier",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "AgentSummary must not contain `{forbidden}` (would re-bloat list_agents): {serialized}"
            );
        }
    }

    /// Parse a query string the same way the running handler does.
    /// `axum::extract::Query` round-trips via `serde_urlencoded` which
    /// is the wire format for HTTP query strings.
    async fn parse_query(qs: &str) -> Result<ListAgentsQuery, axum::extract::rejection::QueryRejection> {
        use axum::extract::Query;
        use axum::http::Request;
        let uri = format!("http://example/?{qs}");
        let req = Request::builder().uri(uri).body(()).unwrap();
        let (parts, _) = req.into_parts();
        Query::<ListAgentsQuery>::try_from_uri(&parts.uri).map(|q| q.0)
    }

    #[tokio::test]
    async fn view_query_parses_slim_and_full() {
        let slim = parse_query("view=slim").await.expect("parse view=slim");
        assert_eq!(slim.view, Some(AgentListView::Slim));

        let full = parse_query("view=full").await.expect("parse view=full");
        assert_eq!(full.view, Some(AgentListView::Full));

        let missing = parse_query("").await.expect("parse empty");
        assert_eq!(missing.view, None);
        assert_eq!(
            missing.view.unwrap_or_default(),
            AgentListView::Full,
            "absent `view=` must default to Full so existing UI callers keep their payload"
        );
    }

    #[tokio::test]
    async fn view_query_rejects_unknown_value() {
        let result = parse_query("view=tiny").await;
        assert!(
            result.is_err(),
            "unknown `view` value must error rather than silently fall back to Full — got {result:?}"
        );
    }

    #[tokio::test]
    async fn view_query_combines_with_org_id() {
        let parsed = parse_query("view=slim&org_id=org-1")
            .await
            .expect("parse view=slim&org_id=org-1");
        assert_eq!(parsed.view, Some(AgentListView::Slim));
        assert_eq!(parsed.org_id.as_deref(), Some("org-1"));
    }
}
