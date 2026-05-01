use std::convert::Infallible;

use aura_os_core::HarnessMode;
use aura_os_harness::{HarnessInbound, HarnessOutbound, SessionConfig, SessionModelOverrides};
use aura_protocol::GenerationRequest;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use serde_json::json;
use tokio::sync::broadcast;
use tracing::{error, warn};

use aura_os_core::ZeroAuthSession;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};
use crate::state::AppState;

use super::sse::{SseResponse, SseStream, SSE_NO_BUFFERING_HEADERS};

/// Identity context callers must resolve before opening a
/// generation session.
///
/// Phase 5: previously the generation path opened a harness session
/// with only `token` and a synthetic `agent_id` set, which silently
/// dropped the `X-Aura-Org-Id` / `X-Aura-Session-Id` /
/// `X-Aura-User-Id` proxy headers. Eval bursts then bucketed as
/// anonymous IP-only traffic on aura-router and tripped the WAF
/// rule chat from the same account never reproduces. The route
/// handlers (`generate_image_stream` / `generate_3d_stream`) now
/// resolve this struct from the auth session + (optional)
/// project_id and pass it through so every generation session
/// carries the same identity headers chat does.
pub(super) struct GenerationIdentity {
    pub aura_org_id: String,
    pub aura_session_id: String,
    pub user_id: String,
}

/// Resolve the identity bundle for a generation request by:
///
/// 1. Pulling `user_id` from the auth session (always present).
/// 2. Generating a fresh `aura_session_id` per stream — generation
///    runs are stateless, so unlike chat / dev-loop there is no
///    persisted session id to reuse.
/// 3. Resolving `aura_org_id` from the explicit `project_id` when
///    the caller threaded one through (preferred path), falling
///    back to the user's first available org via the network
///    client. If neither is available the call surfaces a
///    structured 422 instead of opening a session that would later
///    trip the harness Tier 2 preflight.
pub(super) async fn resolve_generation_identity(
    state: &AppState,
    auth_session: &ZeroAuthSession,
    jwt: &str,
    project_id: Option<&str>,
) -> ApiResult<GenerationIdentity> {
    let aura_org_id = match project_id_to_org_id(state, project_id) {
        Some(org_id) => org_id,
        None => fallback_user_primary_org_id(state, jwt).await?,
    };
    Ok(GenerationIdentity {
        aura_org_id,
        aura_session_id: uuid::Uuid::new_v4().to_string(),
        user_id: auth_session.user_id.clone(),
    })
}

fn project_id_to_org_id(state: &AppState, project_id: Option<&str>) -> Option<String> {
    let project_id = project_id?;
    project_id
        .parse::<aura_os_core::ProjectId>()
        .ok()
        .and_then(|pid| state.project_service.get_project(&pid).ok())
        .map(|project| project.org_id.to_string())
}

async fn fallback_user_primary_org_id(state: &AppState, jwt: &str) -> ApiResult<String> {
    let client = state.network_client.as_ref().ok_or_else(|| {
        ApiError::session_identity_missing("aura_org_id", "generation_session")
    })?;
    let orgs = client.list_orgs(jwt).await.map_err(map_network_error)?;
    orgs.into_iter()
        .next()
        .map(|org| org.id)
        .ok_or_else(|| ApiError::session_identity_missing("aura_org_id", "generation_session"))
}

pub(super) async fn open_generation_stream(
    state: AppState,
    jwt: String,
    request: GenerationRequest,
    identity: GenerationIdentity,
) -> ApiResult<SseResponse> {
    let harness_mode = HarnessMode::Local;
    let GenerationIdentity {
        aura_org_id,
        aura_session_id,
        user_id,
    } = identity;
    let session_config = SessionConfig {
        agent_id: Some(format!("generation-{}", uuid::Uuid::new_v4().as_simple())),
        agent_name: Some("Generation".to_string()),
        token: Some(jwt),
        user_id: Some(user_id),
        project_id: request.project_id.clone(),
        aura_org_id: Some(aura_org_id),
        aura_session_id: Some(aura_session_id),
        provider_overrides: Some(SessionModelOverrides {
            default_model: request.model.clone(),
            fallback_model: None,
            prompt_caching_enabled: Some(true),
        }),
        ..Default::default()
    };

    // Tier 1 fail-fast: same contract as chat / dev-loop, with the
    // caveat that generation sessions intentionally use a synthetic
    // agent_id (they aren't tied to an agent template) so the
    // requirements skip `template_agent_id` but still require
    // *some* agent identity via `require_any_agent_identity`.
    validate_session_identity(
        &session_config,
        SessionIdentityRequirements::GENERATION,
        "generation_session",
    )?;

    let harness = state.harness_for(harness_mode);
    let session = harness.open_session(session_config).await.map_err(|err| {
        error!(error = %err, "generation harness session failed to open");
        // Route through the shared mapper so upstream WS-slot
        // exhaustion + harness-side identity preflight failures
        // surface as the same structured envelopes the rest of the
        // server uses, instead of a generic `bad_gateway`.
        map_harness_error_to_api(&err, state.harness_ws_slots, |e| {
            ApiError::bad_gateway(format!("opening harness generation session failed: {e}"))
        })
    })?;

    let rx = session.events_tx.subscribe();
    session
        .commands_tx
        .try_send(HarnessInbound::GenerationRequest(request))
        .map_err(|err| {
            error!(error = %err, "generation request failed to send to harness");
            ApiError::bad_gateway(format!("sending harness generation request failed: {err}"))
        })?;

    let stream = harness_generation_to_sse(state, harness_mode, session.session_id, rx);
    let boxed: SseStream = Box::pin(stream);
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

fn harness_generation_to_sse(
    state: AppState,
    harness_mode: HarnessMode,
    session_id: String,
    rx: broadcast::Receiver<HarnessOutbound>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    stream::unfold(
        (state, rx, false, session_id),
        move |(state, mut rx, done, session_id)| async move {
            if done {
                return None;
            }

            loop {
                match rx.recv().await {
                    Ok(evt) => {
                        if let Some((event, terminal)) = generation_event_to_sse(evt) {
                            if terminal {
                                close_generation_session(
                                    state.clone(),
                                    harness_mode,
                                    session_id.clone(),
                                );
                            }
                            return Some((Ok(event), (state, rx, terminal, session_id)));
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(dropped = n, "generation harness stream lagged");
                        let event = Event::default()
                            .event("generation_error")
                            .json_data(json!({
                                "code": "STREAM_LAGGED",
                                "message": format!("Generation stream lagged and dropped {n} event(s)"),
                            }))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        close_generation_session(state.clone(), harness_mode, session_id.clone());
                        return Some((Ok(event), (state, rx, true, session_id)));
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        let event = Event::default()
                            .event("done")
                            .json_data(json!({}))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        close_generation_session(state.clone(), harness_mode, session_id.clone());
                        return Some((Ok(event), (state, rx, true, session_id)));
                    }
                }
            }
        },
    )
}

fn close_generation_session(state: AppState, harness_mode: HarnessMode, session_id: String) {
    tokio::spawn(async move {
        let _ = state
            .harness_for(harness_mode)
            .close_session(&session_id)
            .await;
    });
}

fn generation_event_to_sse(evt: HarnessOutbound) -> Option<(Event, bool)> {
    match evt {
        HarnessOutbound::GenerationStart(start) => Some((
            Event::default()
                .event("generation_start")
                .json_data(json!({ "mode": start.mode }))
                .unwrap_or_else(|_| Event::default().data("{}")),
            false,
        )),
        HarnessOutbound::GenerationProgress(progress) => Some((
            Event::default()
                .event("generation_progress")
                .json_data(&progress)
                .unwrap_or_else(|_| Event::default().data("{}")),
            false,
        )),
        HarnessOutbound::GenerationPartialImage(partial) => Some((
            Event::default()
                .event("generation_partial_image")
                .json_data(&partial)
                .unwrap_or_else(|_| Event::default().data("{}")),
            false,
        )),
        HarnessOutbound::GenerationCompleted(completed) => {
            let mut payload = completed.payload;
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("mode".to_string(), json!(completed.mode));
            } else {
                payload = json!({
                    "mode": completed.mode,
                    "payload": payload,
                });
            }
            Some((
                Event::default()
                    .event("generation_completed")
                    .json_data(&payload)
                    .unwrap_or_else(|_| Event::default().data("{}")),
                true,
            ))
        }
        HarnessOutbound::GenerationError(err) => Some((
            Event::default()
                .event("generation_error")
                .json_data(&err)
                .unwrap_or_else(|_| Event::default().data("{}")),
            true,
        )),
        HarnessOutbound::Error(err) => Some((
            Event::default()
                .event("error")
                .json_data(json!({
                    "code": err.code,
                    "message": format!("Aura proxy upstream provider error: {}", err.message),
                    "recoverable": err.recoverable,
                }))
                .unwrap_or_else(|_| Event::default().data("{}")),
            true,
        )),
        _ => None,
    }
}
