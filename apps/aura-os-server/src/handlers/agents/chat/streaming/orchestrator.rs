//! `open_harness_chat_stream` orchestrator: ties persistence, session
//! lookup, the SSE response builder, the turn-slot release sentinel,
//! and the SSE drop guard together so the chat handler can return a
//! single `SseResponse` future.

use std::sync::Arc;

use aura_os_core::HarnessMode;
use aura_os_harness::{
    CouncilPresentation, ErrorMsg, HarnessOutbound, SessionBridgeTurn, SessionConfig,
};
use axum::response::sse::{KeepAlive, Sse};
use tokio::sync::broadcast;
use tracing::{debug, error, warn};

use crate::dto::ChatAttachmentDto;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::types::sse_response_headers;
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};
use crate::live_streams::{StreamKind, StreamScope};
use crate::state::AppState;

use super::super::event_bus::publish_user_message_event;
use super::super::maybe_spawn_subagent_capture;
use super::super::persist::{persist_user_message, ChatPersistCtx, ForkInfo};
use super::super::persist_task::{spawn_chat_persist_task, ChatPersistTaskExtras};
use super::super::turn_slot::{spawn_turn_slot_release, spawn_turn_watchdog};
use super::super::types::{SseResponse, SseStream};

use super::attachments::dto_attachments_to_protocol;
use super::prefix::build_sse_stream;
use super::session::{
    apply_council_presentation_to_event, get_or_create_delegated_chat_session, SessionForTurn,
};
use super::title::spawn_session_title_task;
use super::tool_hints::build_turn_tool_hints;

/// Inputs to `open_harness_chat_stream`. Bundled so the function stays
/// inside the 5-parameter limit and call sites compose easily.
pub(in super::super) struct OpenChatStreamArgs {
    pub(in super::super) session_key: String,
    pub(in super::super) harness_mode: HarnessMode,
    pub(in super::super) session_config: SessionConfig,
    pub(in super::super) user_content: String,
    pub(in super::super) requested_model: Option<String>,
    pub(in super::super) persist_ctx: Option<ChatPersistCtx>,
    pub(in super::super) attachments: Option<Vec<ChatAttachmentDto>>,
    pub(in super::super) commands: Option<Vec<String>>,
    /// Phase 3 auto-fork breadcrumb. When `Some`, the chat resolver
    /// just minted a fresh storage session because the prior one
    /// crossed `AURA_CHAT_AUTO_FORK_THRESHOLD`; `build_sse_stream`
    /// prepends a single `progress: forked_for_context` SSE event
    /// so the chat panel can swap `?session=<old>` → `?session=<new>`
    /// and surface a one-shot soft banner before the
    /// `connecting` / `queued` prefix.
    pub(in super::super) fork_info: Option<ForkInfo>,
    /// `true` when this turn is being issued in plan mode
    /// (`action=generate_specs`). Causes the outbound user message to
    /// be wrapped with the plan-mode preamble for the harness wire
    /// payload (persistence still stores the raw `user_content`) and
    /// the `tool_hints` payload to be filled with the plan-mode tool
    /// surface so even a warm session that started in code mode sees
    /// plan-mode steering on this turn. See
    /// `crate::handlers::plan_mode` for the contract.
    pub(in super::super) is_plan_mode: bool,
    /// Trusted per-turn context derived from structured request fields.
    /// Persisted chat history keeps the user's raw message; only the harness
    /// sees this wrapper so warm sessions receive fresh delegation intent.
    pub(in super::super) turn_context: Option<String>,
    /// Observe-only usage signal context. Route handlers populate
    /// request-time facts; this orchestrator corrects
    /// `is_new_session` after the session resolver returns the actual
    /// cold-vs-warm outcome.
    pub(in super::super) usage_signal_context: Option<crate::usage_signals::UsageSignalContext>,
}

pub(in super::super) async fn open_harness_chat_stream(
    state: &AppState,
    args: OpenChatStreamArgs,
) -> ApiResult<SseResponse> {
    let OpenChatStreamArgs {
        session_key,
        harness_mode,
        mut session_config,
        user_content,
        requested_model,
        persist_ctx,
        attachments,
        commands,
        fork_info,
        is_plan_mode,
        turn_context,
        mut usage_signal_context,
    } = args;

    // Guiding invariant: no silent success. If the inbound user message
    // cannot be persisted for ANY reason, we must return a non-2xx to the
    // caller, we must NOT forward the turn to the harness, and we must
    // NOT open an SSE body. The CEO's `send_to_agent` tool relied on the
    // previous soft-success behavior to report `persisted: true` for
    // writes that silently vanished — see the structured
    // `chat_persist_failed` / `chat_persist_unavailable` shapes in
    // `error.rs` for what callers now see on failure.
    //
    // This MUST run before `validate_session_identity`: the missing
    // `aura_session_id` in `SessionConfig` is sourced from `persist_ctx`,
    // so a None `persist_ctx` would otherwise be flagged by the Tier-1
    // preflight as a generic `missing_aura_session_id` (422) instead of
    // the documented, more specific `chat_persist_unavailable` (424) that
    // `send_to_agent` consumers parse and act on.
    let ctx = require_persist_ctx(&session_key, persist_ctx)?;
    let err_ctx = persist_error_ctx(&ctx);

    // Phase 5 observability: bump the lifecycle counter at the
    // `accept-the-turn` boundary, after `require_persist_ctx`
    // (anything that fails the preflight is NOT a turn) and BEFORE
    // any harness IO. Pairs with `chat_turns_completed_ok` in the
    // persist task — the gap is the operator-visible "failed turns"
    // signal.
    state.stability_metrics.inc_chat_turns_started();

    // Tier 1 fail-fast: refuse to open a chat session that would be
    // missing one of the required X-Aura-* identity headers on the
    // outbound /v1/messages call. Without this, the harness would
    // silently drop the header and the request would surface later
    // as a Cloudflare 403 / generic 5xx with no actionable signal.
    // See `crate::handlers::agents::session_identity` for the
    // contract.
    validate_session_identity(
        &session_config,
        SessionIdentityRequirements::CHAT,
        "chat_session",
    )?;

    // Persist the user turn BEFORE starting the harness session. If
    // storage rejects the write we must not charge the caller credits
    // for a turn that would never make it into the target agent's chat
    // history, and we must not leave an orphaned harness turn mid-flight.
    let persisted_user_evt = persist_user_message(&ctx, &user_content, &attachments)
        .await
        .map_err(|e| crate::error::map_chat_persist_storage_error(e, err_ctx.clone()))?;

    // Snapshot the persistence identifiers so we can advertise them in
    // SSE response headers for callers (e.g. the CEO's `send_to_agent`)
    // that want to locate the saved turn without draining the stream.
    // The wire shape is `(session_id, project_id)` strings — stringify
    // the typed `SessionId` here so `sse_response_headers` keeps its
    // `&str` interface unchanged.
    let persist_snapshot: Option<(String, String)> =
        Some((ctx.session_id.to_string(), ctx.project_id.clone()));

    // Snapshot the user content for the on-send title generator before
    // it gets moved into `SessionBridgeTurn`. The title task only fires
    // for brand-new sessions (see `spawn_session_title_task`); cheap
    // enough to clone unconditionally.
    let title_user_content = user_content.clone();

    // Persist the user's raw content above; the harness, however,
    // sees a plan-mode-wrapped variant when this is a plan-mode turn
    // so the model is reminded of the rules even on a warm session
    // that originally cold-started in code mode. A subsequent
    // code-mode turn on the same session sends the unwrapped content
    // and the model has no on-wire reason to assume plan-mode is
    // still in effect.
    // AURA Council parent runs derive their query from the request's
    // `conversation_messages` (the harness council orchestrator calls
    // `latest_user_query` over them) rather than from an out-of-band
    // `UserMessage`. The new turn is only persisted later (below) and is
    // never sent to the council parent run (see `streaming::session`),
    // so append it to the history here — otherwise the orchestrator fans
    // members out over a stale / empty query.
    let plan_content = if is_plan_mode {
        crate::handlers::plan_mode::wrap_user_content_for_plan_mode(&user_content)
    } else {
        user_content.clone()
    };
    let harness_content = match turn_context {
        Some(context) if !context.trim().is_empty() => {
            format!("{context}\n\n---\n\n{plan_content}")
        }
        _ => plan_content,
    };

    if session_config.council.is_some() {
        let mut messages = session_config
            .conversation_messages
            .take()
            .unwrap_or_default();
        messages.push(aura_os_harness::ConversationMessage {
            role: "user".to_string(),
            content: harness_content.clone(),
        });
        session_config.conversation_messages = Some(messages);
    }

    let turn = SessionBridgeTurn {
        content: harness_content,
        tool_hints: build_turn_tool_hints(commands.as_deref(), is_plan_mode),
        attachments: dto_attachments_to_protocol(&attachments),
    };
    let persist_model = requested_model
        .clone()
        .or_else(|| session_config.model.clone());

    // Snapshot the scope fields for the reattachable live stream
    // BEFORE `session_config` is moved into the session resolver below.
    // `user_id` is authz-load-bearing (a missing user_id makes the
    // stream world-visible in `streams::authorize`), and it is reliably
    // set on `SessionConfig` at both chat routes.
    let scope_user_id = session_config.user_id.clone();
    let scope_project_id = session_config.project_id.clone();

    let SessionForTurn {
        is_new,
        was_queued,
        rx,
        slot_guard,
        commands_tx,
        pending_events,
        council_presentation,
    } = get_or_create_delegated_chat_session(
        state,
        &session_key,
        harness_mode,
        session_config,
        requested_model,
        turn,
    )
    .await?;
    if let Some(signal_ctx) = usage_signal_context.as_mut() {
        signal_ctx.is_new_session = is_new;
    }

    let PresentedTurnStream {
        rx,
        events_tx,
        relay,
    } = present_turn_stream(rx, pending_events, council_presentation);

    // Register this turn as a reattachable live stream so a
    // reconnecting / reloading UI can rejoin the in-flight delta stream
    // by `session_id` via `GET /api/streams/active` + `GET
    // /api/streams/:id`. We subscribe a FRESH receiver from `events_tx`
    // (NOT `rx`, which feeds the SSE body / persist / release / watchdog
    // fan-out) so the registry observes the same turn without stealing
    // frames. The turn slot serializes turns on this reused `events_tx`,
    // so the forwarder captures exactly one turn and terminates at its
    // `assistant_message_end`. Plan-mode spec-gen issued over chat is
    // registered as `ChatTurn` too — that is intended.
    //
    // `agent_instance_id` is the 2nd `::`-separated segment of the
    // session key (`template::instance::session`, see
    // `aura_os_core::harness_id`); `None` when the key has no second
    // segment (bare-template agent routes).
    let live_scope = StreamScope {
        user_id: scope_user_id,
        project_id: scope_project_id.or_else(|| Some(ctx.project_id.clone())),
        agent_instance_id: session_key.split("::").nth(1).map(str::to_string),
        session_id: Some(ctx.session_id.to_string()),
        parent_tool_use_id: None,
        child_run_id: None,
    };
    let _live = state.live_streams.register_receiver(
        StreamKind::ChatTurn,
        live_scope,
        events_tx.subscribe(),
        Some(commands_tx.clone()),
    );

    let persist_rx = rx.resubscribe();
    let release_rx = rx.resubscribe();
    let watchdog_rx = rx.resubscribe();

    // Fan out the now-persisted user turn onto the local WebSocket event
    // bus so the UI can live-refresh the target agent's chat panel when
    // another agent (e.g. the CEO) writes into its history. See
    // `useChatHistorySync` for the consumer.
    //
    // Phase 6 cross-agent tracing breadcrumb. This is the hand-off
    // point from "HTTP handler accepted the user turn" to "WS publisher
    // tells live UIs to refetch". An operator chasing a missing
    // live-update can grep `aura::cross_agent` to confirm we made it
    // here, then `aura::ws` to confirm `publish_chat_event` enqueued a
    // payload — see `event_bus.rs` doc header for the full chain.
    debug!(
        target: "aura::cross_agent",
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        agent_id = ?ctx.agent_id,
        originating_agent_id = ?ctx.originating_agent_id,
        "user_message persisted; publishing ws event"
    );
    publish_user_message_event(&state.event_broadcast, &ctx, persisted_user_evt.id.as_str());

    // Kick off ChatGPT-style title generation in parallel with the
    // assistant turn. Only runs for brand-new sessions (see the
    // first-user-message + empty-summary guards inside the spawn);
    // when it does run, the title lands in the sidekick over the WS
    // event bus before the assistant finishes streaming.
    spawn_session_title_task(
        state.http_client.clone(),
        state.router_url.clone(),
        state.event_broadcast.clone(),
        ctx.clone(),
        title_user_content,
    );

    // Capture any subagents this turn spawns into their own durable
    // sessions so a subagent thread persists and reloads like a normal
    // chat (see `subagent_capture`). Subscribes its own receiver to
    // `events_tx`, so it never steals frames from the persist / SSE
    // fan-out. Runs before `ctx` is moved into the persist task.
    maybe_spawn_subagent_capture(state, &ctx, &events_tx, persist_model.clone());

    // Every downstream receiver is attached now. Start the relay only at
    // this point so initialization frames and any council output emitted
    // immediately after `SessionReady` cannot outrun SSE, persistence,
    // watchdog, subagent capture, or the resumable live-stream registry.
    spawn_turn_stream_relay(relay, events_tx.clone(), session_key.clone());

    spawn_chat_persist_task(
        persist_rx,
        ctx,
        state.event_broadcast.clone(),
        persist_model,
        ChatPersistTaskExtras {
            http_client: state.http_client.clone(),
            router_url: state.router_url.clone(),
            auto_fork_threshold: state.chat_auto_fork_threshold,
            stability_metrics: Some(Arc::clone(&state.stability_metrics)),
            usage_signal_context,
            mixpanel: state.mixpanel.clone(),
            billing_client: Some(Arc::clone(&state.billing_client)),
        },
    );

    // Hand the turn-slot guard to a sentinel that releases it on the
    // harness's terminal event for this turn. Without this, the guard
    // would drop as soon as `open_harness_chat_stream` returns and a
    // back-to-back send would race the WS writer just like before
    // Phase 3.
    spawn_turn_watchdog(
        events_tx,
        watchdog_rx,
        state.turn_first_event_timeout,
        state.turn_max_idle_timeout,
        Arc::clone(&state.stability_metrics),
    );

    // Intelligent-reconnect behaviour change: the slot-release sentinel
    // now releases the turn slot SOLELY on the harness's terminal event
    // for this turn. A PASSIVE SSE disconnect (the UI closed the
    // response body on a browser refresh / network drop) no longer
    // cancels the turn or early-releases the slot, because the reused
    // harness turn keeps running and is registered as a reattachable
    // live stream (see `register_receiver` above) that the reconnecting
    // UI can rejoin. There is therefore no SSE drop guard here anymore.
    //
    // Safety for turn-slot accounting:
    // - `spawn_turn_watchdog` bounds a stalled turn by emitting a
    //   synthetic terminal event on first-event / idle timeout, which
    //   the sentinel observes — so the slot can never leak even if the
    //   harness goes silent after a disconnect.
    // - Explicit Stop (`POST .../cancel-turn`, `setup/cancel.rs`)
    //   forwards `HarnessInbound::Cancel` and evicts the warm session
    //   independently of the SSE body, so the harness emits a terminal
    //   event that releases the slot promptly. That path is unchanged.
    spawn_turn_slot_release(slot_guard, release_rx);

    let stream = build_sse_stream(
        rx,
        is_new,
        was_queued,
        fork_info,
        Some(Arc::clone(&state.stability_metrics)),
    );

    let boxed: SseStream = Box::pin(stream);

    Ok((
        sse_response_headers(persist_snapshot.as_ref()),
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

fn require_persist_ctx(
    session_key: &str,
    persist_ctx: Option<ChatPersistCtx>,
) -> ApiResult<ChatPersistCtx> {
    match persist_ctx {
        Some(ctx) => Ok(ctx),
        None => {
            error!(
                session_key,
                "chat stream rejected: persistence context unavailable (no project binding / storage down)"
            );
            Err(ApiError::chat_persist_unavailable(
                "Chat persistence unavailable: target agent is not bound to any project in storage, or storage is not configured. Call assign_agent_to_project before retrying.",
                crate::error::ChatPersistErrorCtx::default(),
            ))
        }
    }
}

fn persist_error_ctx(ctx: &ChatPersistCtx) -> crate::error::ChatPersistErrorCtx {
    // Stringify the typed `SessionId` at this error-payload boundary
    // — `ChatPersistErrorCtx` keeps `Option<String>` because it gets
    // serialised straight into the JSON error body that the CEO's
    // `send_to_agent` tool parses.
    crate::error::ChatPersistErrorCtx {
        session_id: Some(ctx.session_id.to_string()),
        project_id: Some(ctx.project_id.clone()),
        project_agent_id: Some(ctx.project_agent_id.clone()),
    }
}

struct PresentedTurnStream {
    rx: broadcast::Receiver<HarnessOutbound>,
    events_tx: broadcast::Sender<HarnessOutbound>,
    relay: TurnStreamRelay,
}

struct TurnStreamRelay {
    source_rx: broadcast::Receiver<HarnessOutbound>,
    pending_events: Vec<HarnessOutbound>,
    presentation: Option<CouncilPresentation>,
}

fn present_turn_stream(
    source_rx: broadcast::Receiver<HarnessOutbound>,
    pending_events: Vec<HarnessOutbound>,
    presentation: Option<CouncilPresentation>,
) -> PresentedTurnStream {
    let (presented_tx, presented_rx) =
        broadcast::channel(aura_os_harness::ws_bridge_config::read_broadcast_capacity_from_env());

    PresentedTurnStream {
        rx: presented_rx,
        events_tx: presented_tx,
        relay: TurnStreamRelay {
            source_rx,
            pending_events,
            presentation,
        },
    }
}

fn spawn_turn_stream_relay(
    relay: TurnStreamRelay,
    presented_tx: broadcast::Sender<HarnessOutbound>,
    session_key: String,
) {
    tokio::spawn(async move {
        let TurnStreamRelay {
            mut source_rx,
            pending_events,
            presentation,
        } = relay;

        let had_pending_events = !pending_events.is_empty();
        if had_pending_events {
            debug!(
                target: "aura::council",
                count = pending_events.len(),
                %session_key,
                "replaying captured harness initialization frames onto turn broadcast"
            );
        }
        for evt in pending_events {
            let terminal = is_terminal_turn_event(&evt);
            let _ = presented_tx.send(evt);
            if terminal {
                return;
            }
        }
        // Let the already-subscribed consumers drain the identity-first
        // initialization batch before forwarding any replay-on-attach burst
        // that accumulated immediately after readiness.
        if had_pending_events {
            tokio::task::yield_now().await;
        }

        loop {
            match source_rx.recv().await {
                Ok(evt) => {
                    let evt = apply_council_presentation_to_event(evt, presentation);
                    let terminal = is_terminal_turn_event(&evt);
                    let _ = presented_tx.send(evt);
                    if terminal {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        target: "aura::chat",
                        skipped,
                        %session_key,
                        "turn stream relay lagged; surfacing terminal integrity error"
                    );
                    let _ = presented_tx.send(HarnessOutbound::Error(ErrorMsg {
                        code: "harness_event_stream_lagged".to_string(),
                        message: format!(
                            "Harness event stream lost {skipped} event(s) before they could be delivered"
                        ),
                        recoverable: true,
                        support_id: None,
                    }));
                    break;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn is_terminal_turn_event(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
    )
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use aura_os_harness::SubagentSpawned;

    use super::*;

    fn council_spawn(subagent_type: &str) -> HarnessOutbound {
        HarnessOutbound::SubagentSpawned(SubagentSpawned {
            child_run_id: "child-1".to_string(),
            parent_tool_use_id: Some("council-parent".to_string()),
            subagent_type: subagent_type.to_string(),
            prompt: "check the answer".to_string(),
            model: Some("model-a".to_string()),
            council_index: Some(0),
            council_mechanism: Some("synthesize".to_string()),
        })
    }

    #[tokio::test]
    async fn present_turn_stream_relabels_live_second_opinion_spawns() {
        let (raw_tx, raw_rx) = broadcast::channel(8);
        let PresentedTurnStream {
            mut rx,
            events_tx: presented_tx,
            relay,
        } = present_turn_stream(raw_rx, Vec::new(), Some(CouncilPresentation::SecondOpinion));

        spawn_turn_stream_relay(relay, presented_tx, "test-session".to_string());
        raw_tx
            .send(council_spawn("general_purpose"))
            .expect("send raw spawn");

        let evt = tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("presentation event")
            .expect("receive presentation event");
        match evt {
            HarnessOutbound::SubagentSpawned(spawned) => {
                assert_eq!(spawned.subagent_type, "second-opinion");
                assert_eq!(spawned.council_index, Some(0));
            }
            other => panic!("expected subagent spawn, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn turn_stream_replays_identity_before_immediate_post_ready_output() {
        let (raw_tx, raw_rx) = broadcast::channel(8);
        raw_tx
            .send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
                text: "immediate-post-ready".to_string(),
            }))
            .expect("prime post-ready output");
        let ready = HarnessOutbound::SessionReady(aura_os_harness::SessionReady {
            session_id: "session-early".to_string(),
            tools: Vec::new(),
            skills: Vec::new(),
        });
        let PresentedTurnStream {
            mut rx,
            events_tx,
            relay,
        } = present_turn_stream(raw_rx, vec![ready], None);

        spawn_turn_stream_relay(relay, events_tx, "test-session".to_string());

        assert!(matches!(
            rx.recv().await.expect("session ready"),
            HarnessOutbound::SessionReady(_)
        ));
        assert!(matches!(
            rx.recv().await.expect("post-ready output"),
            HarnessOutbound::TextDelta(ref delta) if delta.text == "immediate-post-ready"
        ));
    }

    #[tokio::test]
    async fn turn_stream_surfaces_source_lag_as_terminal_error() {
        let (raw_tx, raw_rx) = broadcast::channel(1);
        raw_tx
            .send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
                text: "overwritten".to_string(),
            }))
            .unwrap();
        raw_tx
            .send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
                text: "latest".to_string(),
            }))
            .unwrap();
        let PresentedTurnStream {
            mut rx,
            events_tx,
            relay,
        } = present_turn_stream(raw_rx, Vec::new(), None);

        spawn_turn_stream_relay(relay, events_tx, "test-session".to_string());

        assert!(matches!(
            rx.recv().await.expect("integrity error"),
            HarnessOutbound::Error(ref error) if error.code == "harness_event_stream_lagged"
        ));
    }
}
