use std::convert::Infallible;
use std::time::Duration;

use aura_os_core::HarnessMode;
use aura_os_harness::{
    HarnessCommandSender, HarnessInbound, HarnessOutbound, SessionConfig, SessionModelOverrides,
};
use aura_protocol::GenerationRequest;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use serde_json::json;
use serde_json::Map;
use tokio::sync::broadcast;
use tokio::time::Instant;
use tracing::{error, info, warn};

use aura_os_core::ZeroAuthSession;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::agents::chat::ChatPersistCtx;
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};
use crate::state::AppState;

use super::persist::{spawn_generation_persist_task, GenerationPersistMeta};
use super::sse::{SseResponse, SseStream, SSE_NO_BUFFERING_HEADERS};

const DEFAULT_GENERATION_EVENT_IDLE_TIMEOUT_SECS: u64 = 120;
const DEFAULT_GENERATION_MAX_RUNTIME_SECS: u64 = 600;

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
    let client = state
        .network_client
        .as_ref()
        .ok_or_else(|| ApiError::session_identity_missing("aura_org_id", "generation_session"))?;
    let orgs = client.list_orgs(jwt).await.map_err(map_network_error)?;
    orgs.into_iter()
        .next()
        .map(|org| org.id)
        .ok_or_else(|| ApiError::session_identity_missing("aura_org_id", "generation_session"))
}

/// Optional chat-history persistence wiring. When provided, a sibling
/// task subscribes to the harness session's outbound channel and writes
/// the turn's `user_message` + `assistant_message_end` rows into the
/// agent's chat session so image-mode results survive reload (see
/// [`super::persist`] for the rationale and shape).
pub(super) struct GenerationPersistArgs {
    pub(super) ctx: ChatPersistCtx,
    pub(super) meta: GenerationPersistMeta,
}

pub(super) async fn open_generation_stream(
    state: AppState,
    jwt: String,
    request: GenerationRequest,
    identity: GenerationIdentity,
    persist: Option<GenerationPersistArgs>,
) -> ApiResult<SseResponse> {
    let generation_id = uuid::Uuid::new_v4().to_string();
    let harness_mode = HarnessMode::Local;
    let mode = request.mode.clone();
    let model = request.model.clone();
    let prompt_len = request.prompt.as_ref().map_or(0, |prompt| prompt.len());
    let image_count = request.images.as_ref().map_or(0, Vec::len);
    let has_project_id = request.project_id.is_some();
    let GenerationIdentity {
        aura_org_id,
        aura_session_id,
        user_id,
    } = identity;
    info!(
        generation_id = %generation_id,
        mode = %mode,
        model = ?model,
        prompt_len,
        image_count,
        has_project_id,
        harness_mode = ?harness_mode,
        "generation stream opening harness session"
    );
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
        error!(
            generation_id = %generation_id,
            mode = %mode,
            error = %err,
            "generation harness session failed to open"
        );
        // Route through the shared mapper so upstream WS-slot
        // exhaustion + harness-side identity preflight failures
        // surface as the same structured envelopes the rest of the
        // server uses, instead of a generic `bad_gateway`.
        map_harness_error_to_api(&err, state.harness_ws_slots, |e| {
            ApiError::bad_gateway(format!("opening harness generation session failed: {e}"))
        })
    })?;
    info!(
        generation_id = %generation_id,
        session_id = %session.session_id,
        mode = %mode,
        "generation harness session opened"
    );

    let rx = session.events_tx.subscribe();
    if let Some(persist) = persist {
        // Subscribe a *second* receiver before sending the
        // `GenerationRequest`, so the persist task and SSE adapter
        // both see the full event sequence (broadcast subscribers
        // miss any messages emitted before they joined).
        let persist_rx = session.events_tx.subscribe();
        spawn_generation_persist_task(
            persist_rx,
            persist.ctx,
            state.event_broadcast.clone(),
            persist.meta,
        );
    }
    session
        .commands_tx
        .try_send(HarnessInbound::GenerationRequest(request))
        .map_err(|err| {
            error!(
                generation_id = %generation_id,
                session_id = %session.session_id,
                mode = %mode,
                error = %err,
                "generation request failed to send to harness"
            );
            ApiError::bad_gateway(format!("sending harness generation request failed: {err}"))
        })?;
    info!(
        generation_id = %generation_id,
        session_id = %session.session_id,
        mode = %mode,
        "generation request sent to harness"
    );

    let stream = harness_generation_to_sse(
        state,
        harness_mode,
        session.session_id,
        generation_id,
        mode,
        generation_event_idle_timeout(),
        generation_max_runtime(),
        rx,
        session.commands_tx.clone(),
    );
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
    generation_id: String,
    mode: String,
    event_idle_timeout: Duration,
    max_runtime: Duration,
    rx: broadcast::Receiver<HarnessOutbound>,
    commands_tx: HarnessCommandSender,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    let now = Instant::now();
    stream::unfold(
        GenerationStreamState {
            state,
            rx,
            done: false,
            session_id,
            generation_id,
            mode,
            event_idle_timeout,
            max_runtime,
            started_at: now,
            last_generation_event_at: now,
            saw_generation_event: false,
            _commands_tx: commands_tx,
        },
        move |mut stream_state| async move {
            let GenerationStreamState {
                state,
                rx,
                done,
                session_id,
                generation_id,
                mode,
                event_idle_timeout,
                max_runtime,
                started_at,
                last_generation_event_at,
                saw_generation_event,
                _commands_tx,
            } = &mut stream_state;
            if *done {
                return None;
            }

            loop {
                let elapsed = started_at.elapsed();
                if elapsed >= *max_runtime {
                    let event = generation_timeout_event(
                        "GENERATION_TIMEOUT",
                        "Image generation timed out before completing. Try again in a moment.",
                    );
                    error!(
                        generation_id = %generation_id,
                        session_id = %session_id,
                        mode = %mode,
                        elapsed_ms = elapsed.as_millis(),
                        "generation stream reached max runtime"
                    );
                    close_generation_session(state.clone(), harness_mode, session_id.clone());
                    stream_state.done = true;
                    return Some((Ok(event), stream_state));
                }

                let idle_elapsed = last_generation_event_at.elapsed();
                if idle_elapsed >= *event_idle_timeout {
                    let event = generation_timeout_event(
                        "GENERATION_NO_EVENTS",
                        if *saw_generation_event {
                            "Image generation stopped sending progress before completing. Try again in a moment."
                        } else {
                            "Image generation did not start. Try again in a moment."
                        },
                    );
                    error!(
                        generation_id = %generation_id,
                        session_id = %session_id,
                        mode = %mode,
                        idle_ms = idle_elapsed.as_millis(),
                        elapsed_ms = elapsed.as_millis(),
                        saw_generation_event = *saw_generation_event,
                        "generation stream watchdog fired"
                    );
                    close_generation_session(state.clone(), harness_mode, session_id.clone());
                    stream_state.done = true;
                    return Some((Ok(event), stream_state));
                }

                let max_remaining = *max_runtime - elapsed;
                let idle_remaining = *event_idle_timeout - idle_elapsed;
                let wait_for = max_remaining.min(idle_remaining);

                match tokio::time::timeout(wait_for, rx.recv()).await {
                    Err(_) => {
                        continue;
                    }
                    Ok(Ok(evt)) => {
                        if let Some(event_name) = generation_event_name(&evt) {
                            let terminal = generation_event_is_terminal(&evt);
                            if terminal {
                                info!(
                                    generation_id = %generation_id,
                                    session_id = %session_id,
                                    mode = %mode,
                                    event = event_name,
                                    elapsed_ms = started_at.elapsed().as_millis(),
                                    "generation stream terminal event received"
                                );
                            } else if !*saw_generation_event {
                                info!(
                                    generation_id = %generation_id,
                                    session_id = %session_id,
                                    mode = %mode,
                                    event = event_name,
                                    elapsed_ms = started_at.elapsed().as_millis(),
                                    "generation stream first event received"
                                );
                            }
                            *last_generation_event_at = Instant::now();
                            *saw_generation_event = true;
                        }
                        if let Some((event, terminal)) =
                            generation_event_to_sse(evt, generation_id, session_id, mode)
                        {
                            if terminal {
                                close_generation_session(
                                    state.clone(),
                                    harness_mode,
                                    session_id.clone(),
                                );
                            }
                            stream_state.done = terminal;
                            return Some((Ok(event), stream_state));
                        }
                    }
                    Ok(Err(broadcast::error::RecvError::Lagged(n))) => {
                        warn!(
                            generation_id = %generation_id,
                            session_id = %session_id,
                            mode = %mode,
                            dropped = n,
                            "generation harness stream lagged"
                        );
                        let event = Event::default()
                            .event("generation_error")
                            .json_data(json!({
                                "code": "STREAM_LAGGED",
                                "message": format!("Generation stream lagged and dropped {n} event(s)"),
                            }))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        close_generation_session(state.clone(), harness_mode, session_id.clone());
                        stream_state.done = true;
                        return Some((Ok(event), stream_state));
                    }
                    Ok(Err(broadcast::error::RecvError::Closed)) => {
                        warn!(
                            generation_id = %generation_id,
                            session_id = %session_id,
                            mode = %mode,
                            elapsed_ms = started_at.elapsed().as_millis(),
                            "generation harness stream closed before terminal generation event"
                        );
                        let event = Event::default()
                            .event("done")
                            .json_data(json!({}))
                            .unwrap_or_else(|_| Event::default().data("{}"));
                        close_generation_session(state.clone(), harness_mode, session_id.clone());
                        stream_state.done = true;
                        return Some((Ok(event), stream_state));
                    }
                }
            }
        },
    )
}

struct GenerationStreamState {
    state: AppState,
    rx: broadcast::Receiver<HarnessOutbound>,
    done: bool,
    session_id: String,
    generation_id: String,
    mode: String,
    event_idle_timeout: Duration,
    max_runtime: Duration,
    started_at: Instant,
    last_generation_event_at: Instant,
    saw_generation_event: bool,
    _commands_tx: HarnessCommandSender,
}

fn close_generation_session(state: AppState, harness_mode: HarnessMode, session_id: String) {
    tokio::spawn(async move {
        let _ = state
            .harness_for(harness_mode)
            .close_session(&session_id)
            .await;
    });
}

fn generation_event_to_sse(
    evt: HarnessOutbound,
    generation_id: &str,
    session_id: &str,
    mode: &str,
) -> Option<(Event, bool)> {
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
            let payload = normalize_generation_completed_payload(completed.mode, completed.payload);
            Some((
                Event::default()
                    .event("generation_completed")
                    .json_data(&payload)
                    .unwrap_or_else(|_| Event::default().data("{}")),
                true,
            ))
        }
        HarnessOutbound::GenerationError(err) => {
            error!(
                generation_id,
                session_id,
                mode,
                code = %err.code,
                message = %err.message,
                "generation harness emitted terminal generation error"
            );
            Some((
                Event::default()
                    .event("generation_error")
                    .json_data(&err)
                    .unwrap_or_else(|_| Event::default().data("{}")),
                true,
            ))
        }
        HarnessOutbound::Error(err) => {
            error!(
                generation_id,
                session_id,
                mode,
                code = %err.code,
                message = %err.message,
                recoverable = err.recoverable,
                "generation harness emitted terminal upstream error"
            );
            Some((
                Event::default()
                    .event("error")
                    .json_data(json!({
                        "code": err.code,
                        "message": format!("Aura proxy upstream provider error: {}", err.message),
                        "recoverable": err.recoverable,
                    }))
                    .unwrap_or_else(|_| Event::default().data("{}")),
                true,
            ))
        }
        _ => None,
    }
}

fn generation_event_name(evt: &HarnessOutbound) -> Option<&'static str> {
    match evt {
        HarnessOutbound::GenerationStart(_) => Some("generation_start"),
        HarnessOutbound::GenerationProgress(_) => Some("generation_progress"),
        HarnessOutbound::GenerationPartialImage(_) => Some("generation_partial_image"),
        HarnessOutbound::GenerationCompleted(_) => Some("generation_completed"),
        HarnessOutbound::GenerationError(_) => Some("generation_error"),
        HarnessOutbound::Error(_) => Some("error"),
        _ => None,
    }
}

fn generation_event_is_terminal(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::GenerationCompleted(_)
            | HarnessOutbound::GenerationError(_)
            | HarnessOutbound::Error(_)
    )
}

fn generation_timeout_event(code: &'static str, message: &'static str) -> Event {
    Event::default()
        .event("generation_error")
        .json_data(json!({
            "code": code,
            "message": message,
        }))
        .unwrap_or_else(|_| Event::default().data("{}"))
}

fn generation_event_idle_timeout() -> Duration {
    env_duration_secs(
        "AURA_GENERATION_EVENT_IDLE_TIMEOUT_SECS",
        DEFAULT_GENERATION_EVENT_IDLE_TIMEOUT_SECS,
    )
}

fn generation_max_runtime() -> Duration {
    env_duration_secs(
        "AURA_GENERATION_MAX_RUNTIME_SECS",
        DEFAULT_GENERATION_MAX_RUNTIME_SECS,
    )
}

fn env_duration_secs(key: &str, default_secs: u64) -> Duration {
    let secs = std::env::var(key)
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|secs| *secs > 0)
        .unwrap_or(default_secs);
    Duration::from_secs(secs)
}

pub(super) fn normalize_generation_completed_payload(
    mode: String,
    payload: serde_json::Value,
) -> serde_json::Value {
    let mut payload = match payload {
        serde_json::Value::Object(obj) => serde_json::Value::Object(obj),
        other => {
            return json!({
                "mode": mode,
                "payload": other,
            });
        }
    };

    if let Some(obj) = payload.as_object_mut() {
        obj.insert("mode".to_string(), json!(mode));

        let nested_payload = obj
            .get("payload")
            .and_then(|value| value.as_object())
            .cloned();

        if !obj.contains_key("imageUrl") {
            if let Some(value) = string_field(
                obj,
                nested_payload.as_ref(),
                &["imageUrl", "image_url", "assetUrl", "asset_url", "url"],
            ) {
                obj.insert("imageUrl".to_string(), json!(value));
            }
        }
        if !obj.contains_key("originalUrl") {
            if let Some(value) = string_field(
                obj,
                nested_payload.as_ref(),
                &["originalUrl", "original_url"],
            ) {
                obj.insert("originalUrl".to_string(), json!(value));
            }
        }
        if !obj.contains_key("artifactId") {
            if let Some(value) = string_field(
                obj,
                nested_payload.as_ref(),
                &["artifactId", "artifact_id", "id"],
            ) {
                obj.insert("artifactId".to_string(), json!(value));
            }
        }
    }

    payload
}

fn string_field(
    obj: &Map<String, serde_json::Value>,
    nested_obj: Option<&Map<String, serde_json::Value>>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| obj.get(*key).and_then(|value| value.as_str()))
        .or_else(|| {
            nested_obj.and_then(|nested| {
                keys.iter()
                    .find_map(|key| nested.get(*key).and_then(|value| value.as_str()))
            })
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_protocol::{
        ErrorMsg, GenerationCompleted, GenerationErrorMsg, GenerationProgressMsg, GenerationStart,
    };

    #[test]
    fn normalize_generation_payload_aliases_artifact_fields() {
        let payload = normalize_generation_completed_payload(
            "image".to_string(),
            json!({
                "assetUrl": "https://cdn.example.com/image.png",
                "original_url": "https://cdn.example.com/original.png",
                "artifact_id": "artifact-1",
            }),
        );

        assert_eq!(payload["mode"], "image");
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/image.png");
        assert_eq!(
            payload["originalUrl"],
            "https://cdn.example.com/original.png"
        );
        assert_eq!(payload["artifactId"], "artifact-1");
    }

    #[test]
    fn normalize_generation_payload_aliases_nested_payload_fields() {
        let payload = normalize_generation_completed_payload(
            "image".to_string(),
            json!({
                "payload": {
                    "asset_url": "https://cdn.example.com/nested.png",
                    "artifact_id": "artifact-2"
                }
            }),
        );

        assert_eq!(payload["mode"], "image");
        assert_eq!(payload["imageUrl"], "https://cdn.example.com/nested.png");
        assert_eq!(payload["artifactId"], "artifact-2");
    }

    #[test]
    fn generation_event_classification_marks_terminal_events() {
        let start = HarnessOutbound::GenerationStart(GenerationStart {
            mode: "image".to_string(),
        });
        assert_eq!(generation_event_name(&start), Some("generation_start"));
        assert!(!generation_event_is_terminal(&start));

        let progress = HarnessOutbound::GenerationProgress(GenerationProgressMsg {
            percent: 25.0,
            message: "rendering".to_string(),
        });
        assert_eq!(
            generation_event_name(&progress),
            Some("generation_progress")
        );
        assert!(!generation_event_is_terminal(&progress));

        let completed = HarnessOutbound::GenerationCompleted(GenerationCompleted {
            mode: "image".to_string(),
            payload: json!({ "imageUrl": "https://cdn.example.com/image.png" }),
        });
        assert_eq!(
            generation_event_name(&completed),
            Some("generation_completed")
        );
        assert!(generation_event_is_terminal(&completed));

        let generation_error = HarnessOutbound::GenerationError(GenerationErrorMsg {
            code: "GENERATION_FAILED".to_string(),
            message: "model unavailable".to_string(),
        });
        assert_eq!(
            generation_event_name(&generation_error),
            Some("generation_error")
        );
        assert!(generation_event_is_terminal(&generation_error));

        let upstream_error = HarnessOutbound::Error(ErrorMsg {
            code: "provider_error".to_string(),
            message: "upstream failed".to_string(),
            recoverable: false,
        });
        assert_eq!(generation_event_name(&upstream_error), Some("error"));
        assert!(generation_event_is_terminal(&upstream_error));
    }
}
