use std::convert::Infallible;

use aura_os_core::HarnessMode;
use aura_os_harness::{HarnessInbound, HarnessOutbound, SessionConfig, SessionModelOverrides};
use aura_protocol::GenerationRequest;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use serde_json::json;
use tokio::sync::broadcast;
use tracing::{error, warn};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::sse::{SseResponse, SseStream, SSE_NO_BUFFERING_HEADERS};

pub(super) async fn open_generation_stream(
    state: AppState,
    jwt: String,
    request: GenerationRequest,
) -> ApiResult<SseResponse> {
    let harness_mode = HarnessMode::Local;
    let session_config = SessionConfig {
        agent_id: Some(format!("generation-{}", uuid::Uuid::new_v4().as_simple())),
        agent_name: Some("Generation".to_string()),
        token: Some(jwt),
        project_id: request.project_id.clone(),
        provider_overrides: Some(SessionModelOverrides {
            default_model: request.model.clone(),
            fallback_model: None,
            prompt_caching_enabled: Some(true),
        }),
        ..Default::default()
    };

    let harness = state.harness_for(harness_mode);
    let session = harness.open_session(session_config).await.map_err(|err| {
        error!(error = %err, "generation harness session failed to open");
        ApiError::bad_gateway(format!("opening harness generation session failed: {err}"))
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
