use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use tokio::time::timeout;

use aura_os_core::{Agent, AgentId};
use aura_os_harness::{
    CouncilMechanism, CouncilMemberConfig, HarnessInbound, HarnessOutbound, SessionConfig,
    SessionModelOverrides, SessionUsage, UserMessage,
};

use crate::dto::{AgentRuntimeTestResponse, CouncilRequestBody};
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};
use crate::state::{AppState, AuthJwt, AuthSession};

struct RuntimeOutcome {
    text: String,
    usage: SessionUsage,
}

const RUNTIME_TEST_TURN_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) async fn test_agent_runtime(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentRuntimeTestResponse>> {
    let agent = state
        .agent_service
        .get_agent_async("", &agent_id)
        .await
        .or_else(|_| state.agent_service.get_agent_local(&agent_id))
        .map_err(|e| ApiError::not_found(format!("agent not found: {e}")))?;

    if agent.adapter_type != "aura_harness" {
        return Err(ApiError::bad_request(format!(
            "adapter `{}` is no longer supported; only `aura_harness` agents can be tested",
            agent.adapter_type
        )));
    }

    let model = effective_model(&agent, None);

    let outcome =
        run_harness_test(&state, &agent, &jwt, &auth_session.user_id, model.clone()).await?;

    Ok(Json(AgentRuntimeTestResponse {
        ok: true,
        adapter_type: agent.adapter_type.clone(),
        environment: agent.environment.clone(),
        auth_source: agent.auth_source.clone(),
        provider: non_empty_string(&outcome.usage.provider),
        model: non_empty_string(&outcome.usage.model),
        integration_id: None,
        integration_name: None,
        message: outcome.text.trim().to_string(),
    }))
}

pub(crate) fn effective_model(agent: &Agent, override_model: Option<String>) -> Option<String> {
    override_model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            agent
                .default_model
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
}

/// Resolve an AURA Council request body into the per-member config the
/// harness needs to build wire [`aura_protocol::CouncilMember`]s.
///
/// Each member reuses the single-model resolution path: its requested
/// model id resolves against `default_model` exactly as
/// [`effective_model`] does (member id when non-blank, otherwise the
/// surface's default model — `agent.default_model` for the agent route,
/// `instance.default_model` for the project route) and its provider
/// overrides flow through [`session_model_overrides_with_cache`], with a
/// member-scoped cache key suffix so the council members don't clobber
/// each other's prompt cache. `members[0]` is the synthesizer.
///
/// Validation mirrors the single-model path: an empty `models` list is
/// a structured 400 (the same `bad_request` shape the route uses for an
/// invalid model); an unknown / blank member id falls back to
/// `default_model` exactly as the single-model path does.
pub(crate) fn resolve_council_members(
    default_model: Option<&str>,
    council: &CouncilRequestBody,
    cache_key: Option<&str>,
    retention: Option<&str>,
) -> ApiResult<Vec<CouncilMemberConfig>> {
    if council.models.is_empty() {
        return Err(ApiError::bad_request(
            "council.models must contain at least one model",
        ));
    }

    Ok(council
        .models
        .iter()
        .enumerate()
        .map(|(index, member)| {
            // Mirror `effective_model`: a non-blank member id wins,
            // otherwise fall back to the surface's default model.
            let model = if member.id.trim().is_empty() {
                default_model.map(ToString::to_string)
            } else {
                Some(member.id.clone())
            };
            // Suffix the shared cache key per member so each council
            // model keeps its own upstream prompt-cache prefix.
            let member_cache_key = cache_key.map(|key| format!("{key}:council:{index}"));
            let provider_overrides =
                session_model_overrides_with_cache(model.as_deref(), member_cache_key, retention);
            CouncilMemberConfig {
                model,
                reasoning_effort: member.reasoning_effort.clone(),
                provider_overrides,
            }
        })
        .collect())
}

/// Resolve the council combine mechanism from the chat client's wire
/// string. An absent / unknown / blank value resolves to
/// [`CouncilMechanism::Synthesize`] (the default, original behavior)
/// rather than failing the request, mirroring how `reasoning_effort`
/// falls back when the tier is unrecognized.
pub(crate) fn resolve_council_mechanism(council: &CouncilRequestBody) -> CouncilMechanism {
    council
        .mechanism
        .as_deref()
        .and_then(CouncilMechanism::from_wire)
        .unwrap_or_default()
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Build the per-session model overrides Aura OS sends to the harness.
///
/// LLM traffic always flows through aura-router with a per-request JWT;
/// there is no provider/routing toggle on the wire. Returns `None` when
/// no model is set, which tells the harness to use its env defaults
/// verbatim.
///
/// Stable cache key strategy: pass `Some(cache_key)` derived from the
/// agent / instance / session identity so OpenAI-family routing can pin
/// the prefix on the upstream provider. `retention` defaults to the
/// shorter in-memory TTL when `None`; pass `Some("24h")` for long-lived
/// project agents whose context survives idle gaps.
pub(crate) fn session_model_overrides_with_cache(
    model: Option<&str>,
    cache_key: Option<String>,
    retention: Option<&str>,
) -> Option<SessionModelOverrides> {
    let default_model = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    // The key is forwarded to the harness, which owns the single
    // length-clamp chokepoint (OpenAI's 64-char `prompt_cache_key`
    // limit) before the value reaches aura-router / OpenAI.
    let cache_key = cache_key
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let retention = retention
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if default_model.is_none() && cache_key.is_none() && retention.is_none() {
        return None;
    }
    Some(SessionModelOverrides {
        default_model,
        fallback_model: None,
        prompt_caching_enabled: Some(true),
        prompt_cache_key: cache_key,
        prompt_cache_retention: retention,
    })
}

/// Backwards-compatible shorthand used by call sites that don't yet
/// derive a stable cache key (test harness runtime, dev-loop bootstrap).
/// New chat surfaces should prefer `session_model_overrides_with_cache`.
pub(crate) fn session_model_overrides(model: Option<&str>) -> Option<SessionModelOverrides> {
    session_model_overrides_with_cache(model, None, None)
}

async fn run_harness_test(
    state: &AppState,
    agent: &Agent,
    jwt: &str,
    user_id: &str,
    model: Option<String>,
) -> ApiResult<RuntimeOutcome> {
    let config = runtime_session_config(agent, jwt, user_id, model);
    validate_session_identity(
        &config,
        SessionIdentityRequirements::CHAT,
        "runtime_request",
    )?;

    let session = state
        .harness_for(agent.harness_mode())
        .open_session(config)
        .await
        .map_err(|e| {
            // Phase 6: route through the shared `map_harness_error_to_api`
            // so upstream WS-slot exhaustion surfaces as the structured
            // 503 instead of a raw `bad_gateway`. Non-capacity transport
            // failures keep the original 502 mapping via the fallback.
            map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
                ApiError::bad_gateway(format!("opening harness session failed: {err}"))
            })
        })?;
    let mut rx = session.events_tx.subscribe();
    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
            content: "Reply with exactly `hello from aura` and stop.".to_string(),
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ApiError::bad_gateway(format!("sending harness message failed: {e}")))?;

    let turn = timeout(RUNTIME_TEST_TURN_TIMEOUT, async {
        let mut text = String::new();
        loop {
            match rx.recv().await {
                Ok(HarnessOutbound::TextDelta(delta)) => text.push_str(&delta.text),
                Ok(HarnessOutbound::AssistantMessageEnd(end)) => {
                    break Ok(RuntimeOutcome {
                        text,
                        usage: end.usage,
                    });
                }
                Ok(HarnessOutbound::Error(err)) => {
                    break Err(ApiError::bad_gateway(format!(
                        "harness runtime test failed ({}): {}",
                        err.code, err.message
                    )));
                }
                Ok(_) => {}
                Err(e) => break Err(ApiError::bad_gateway(format!("harness stream closed: {e}"))),
            }
        }
    })
    .await
    .map_err(|_| ApiError::bad_gateway("harness runtime test timed out"))??;

    let _ = state
        .harness_for(agent.harness_mode())
        .close_session(&session.session_id)
        .await;

    Ok(turn)
}

fn runtime_session_config(
    agent: &Agent,
    jwt: &str,
    user_id: &str,
    model: Option<String>,
) -> SessionConfig {
    SessionConfig {
        agent_system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(aura_os_core::harness_agent_id(&agent.agent_id, None, None)),
        template_agent_id: Some(agent.agent_id.to_string()),
        agent_name: Some(agent.name.clone()),
        model: model.clone(),
        token: Some(jwt.to_string()),
        aura_org_id: agent.org_id.as_ref().map(ToString::to_string),
        aura_session_id: Some(uuid::Uuid::new_v4().to_string()),
        user_id: Some(user_id.to_string()),
        provider_overrides: session_model_overrides(model.as_deref()),
        agent_permissions: (&agent.permissions).into(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{
        listing_status::AgentListingStatus, AgentPermissions, AgentScope, Capability, OrgId,
    };
    use aura_protocol::CapabilityWire;
    use chrono::Utc;

    #[test]
    fn session_model_overrides_populates_default_model() {
        let overrides = session_model_overrides(Some("claude-sonnet-4"))
            .expect("model present should produce overrides");
        assert_eq!(overrides.default_model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(overrides.prompt_caching_enabled, Some(true));
        assert!(overrides.prompt_cache_key.is_none());
        assert!(overrides.prompt_cache_retention.is_none());
    }

    #[test]
    fn session_model_overrides_returns_none_for_blank_model() {
        assert!(session_model_overrides(None).is_none());
        assert!(session_model_overrides(Some("")).is_none());
        assert!(session_model_overrides(Some("   ")).is_none());
    }

    #[test]
    fn session_model_overrides_with_cache_populates_key_and_retention() {
        let overrides = session_model_overrides_with_cache(
            Some("aura-gpt-4.1"),
            Some("agent:abc-123".into()),
            Some("24h"),
        )
        .expect("model + key should produce overrides");
        assert_eq!(overrides.prompt_cache_key.as_deref(), Some("agent:abc-123"));
        assert_eq!(overrides.prompt_cache_retention.as_deref(), Some("24h"));
    }

    #[test]
    fn session_model_overrides_with_cache_returns_none_when_all_blank() {
        assert!(session_model_overrides_with_cache(None, None, None).is_none());
        assert!(
            session_model_overrides_with_cache(Some(""), Some("  ".into()), Some("")).is_none()
        );
    }

    #[test]
    fn runtime_session_config_forwards_agent_permissions() {
        let agent = test_agent_with_permissions(AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::InvokeProcess],
            ..Default::default()
        });

        let config = runtime_session_config(&agent, "jwt", "user-1", Some("aura-gpt-5-5".into()));

        assert_eq!(config.agent_permissions.capabilities.len(), 1);
        assert!(matches!(
            config.agent_permissions.capabilities[0],
            CapabilityWire::InvokeProcess
        ));
        assert!(!config
            .agent_permissions
            .capabilities
            .iter()
            .any(|capability| matches!(capability, CapabilityWire::Unknown)));
    }

    #[test]
    fn runtime_test_turn_timeout_allows_cold_model_responses() {
        assert_eq!(RUNTIME_TEST_TURN_TIMEOUT.as_secs(), 120);
    }

    fn council_body(mechanism: Option<&str>) -> CouncilRequestBody {
        CouncilRequestBody {
            models: Vec::new(),
            mechanism: mechanism.map(ToString::to_string),
        }
    }

    #[test]
    fn resolve_council_mechanism_parses_each_variant() {
        assert_eq!(
            resolve_council_mechanism(&council_body(Some("synthesize"))),
            CouncilMechanism::Synthesize
        );
        assert_eq!(
            resolve_council_mechanism(&council_body(Some("contrast"))),
            CouncilMechanism::Contrast
        );
        assert_eq!(
            resolve_council_mechanism(&council_body(Some("side_by_side"))),
            CouncilMechanism::SideBySide
        );
    }

    #[test]
    fn resolve_council_mechanism_defaults_when_absent_or_unknown() {
        assert_eq!(
            resolve_council_mechanism(&council_body(None)),
            CouncilMechanism::Synthesize
        );
        assert_eq!(
            resolve_council_mechanism(&council_body(Some("bogus"))),
            CouncilMechanism::Synthesize
        );
        assert_eq!(
            resolve_council_mechanism(&council_body(Some(""))),
            CouncilMechanism::Synthesize
        );
    }

    #[test]
    fn council_request_body_deserializes_with_and_without_mechanism() {
        let with: CouncilRequestBody =
            serde_json::from_str(r#"{"models":[{"id":"m"}],"mechanism":"contrast"}"#)
                .expect("deserialize council body with mechanism");
        assert_eq!(with.mechanism.as_deref(), Some("contrast"));

        let without: CouncilRequestBody =
            serde_json::from_str(r#"{"models":[{"id":"m"}]}"#).expect("deserialize legacy body");
        assert!(without.mechanism.is_none());
    }

    #[test]
    fn session_model_overrides_with_cache_forwards_key_verbatim() {
        // aura-os no longer clamps; it forwards the raw semantic key and
        // the harness owns the single length-clamp chokepoint.
        let long = format!("agent:{}", "z".repeat(200));
        let overrides = session_model_overrides_with_cache(
            Some("aura-gpt-5-5"),
            Some(long.clone()),
            Some("24h"),
        )
        .expect("model + key should produce overrides");
        assert_eq!(overrides.prompt_cache_key.as_deref(), Some(long.as_str()));
    }

    fn test_agent_with_permissions(permissions: AgentPermissions) -> Agent {
        let now = Utc::now();
        Agent {
            agent_id: AgentId::new(),
            user_id: "user-1".into(),
            org_id: Some(OrgId::new()),
            name: "Status Probe".into(),
            role: "status-probe".into(),
            personality: "Deterministic".into(),
            system_prompt: "Reply exactly as requested.".into(),
            skills: vec![],
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: "local_host".into(),
            auth_source: "aura_managed".into(),
            integration_id: None,
            default_model: None,
            vm_id: None,
            wallet_address: None,
            network_agent_id: None,
            profile_id: None,
            tags: vec![],
            is_pinned: false,
            listing_status: AgentListingStatus::Closed,
            expertise: vec![],
            jobs: 0,
            revenue_usd: 0.0,
            reputation: 0.0,
            local_workspace_path: None,
            permissions,
            intent_classifier: None,
            created_at: now,
            updated_at: now,
        }
    }
}
