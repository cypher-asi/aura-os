//! `open_harness_chat_stream` orchestrator: ties persistence, session
//! lookup, the SSE response builder, the turn-slot release sentinel,
//! and the SSE drop guard together so the chat handler can return a
//! single `SseResponse` future.

use std::sync::Arc;

use aura_os_core::HarnessMode;
use aura_os_harness::{HarnessCommandSender, SessionBridgeTurn, SessionConfig};
use axum::response::sse::{KeepAlive, Sse};
use tokio::sync::oneshot;
use tracing::{debug, error};

use crate::dto::ChatAttachmentDto;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::types::sse_response_headers;
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};
use crate::state::AppState;

use super::super::event_bus::publish_user_message_event;
use super::super::persist::{persist_user_message, ChatPersistCtx, ForkInfo};
use super::super::persist_task::{spawn_chat_persist_task, ChatPersistTaskExtras};
use super::super::turn_slot::{spawn_turn_slot_release, spawn_turn_watchdog};
use super::super::types::{SseResponse, SseStream};

use super::attachments::dto_attachments_to_protocol;
use super::drop_guard::SseDropGuardStream;
use super::prefix::build_sse_stream;
use super::session::{get_or_create_delegated_chat_session, SessionForTurn};
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
}

pub(in super::super) async fn open_harness_chat_stream(
    state: &AppState,
    args: OpenChatStreamArgs,
) -> ApiResult<SseResponse> {
    let OpenChatStreamArgs {
        session_key,
        harness_mode,
        session_config,
        user_content,
        requested_model,
        persist_ctx,
        attachments,
        commands,
        fork_info,
        is_plan_mode,
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
    let harness_content = if is_plan_mode {
        crate::handlers::plan_mode::wrap_user_content_for_plan_mode(&user_content)
    } else {
        user_content
    };
    let turn = SessionBridgeTurn {
        content: harness_content,
        tool_hints: build_turn_tool_hints(commands.as_deref(), is_plan_mode),
        attachments: dto_attachments_to_protocol(&attachments),
    };
    let persist_model = requested_model
        .clone()
        .or_else(|| session_config.model.clone());
    let SessionForTurn {
        is_new,
        was_queued,
        rx,
        events_tx,
        slot_guard,
        commands_tx,
    } = get_or_create_delegated_chat_session(
        state,
        &session_key,
        harness_mode,
        session_config,
        requested_model,
        turn,
    )
    .await?;

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

    // Phase 7 Stop / refresh cleanup: pair the slot-release sentinel
    // with a oneshot that the SSE drop guard fires when axum drops
    // the response body (Stop's `AbortController.abort()` or a
    // browser refresh both close the HTTP connection, which drops
    // the boxed SSE stream). Without this hook the slot stays held
    // until a terminal harness event arrives, which on a long-running
    // plan-mode turn full of `Progress` heartbeats could be never —
    // and the next user send blocks on `acquire_turn_slot` until the
    // 90s SSE idle timeout fires `SSEIdleTimeoutError` on the client.
    let (early_release_tx, early_release_rx) = oneshot::channel::<HarnessCommandSender>();
    spawn_turn_slot_release(slot_guard, release_rx, early_release_rx);
    let drop_guard_session_key = session_key.clone();
    let drop_guard_commands_tx = commands_tx.clone();

    let stream = build_sse_stream(
        rx,
        is_new,
        was_queued,
        fork_info,
        Some(Arc::clone(&state.stability_metrics)),
    );

    // Wrap the SSE stream so that whenever axum drops the response
    // (normal turn-end OR client disconnect), we surface the disconnect
    // to the slot-release sentinel exactly once. The `biased` arm in
    // `spawn_turn_slot_release` makes the terminal-event branch win
    // for normal turn-ends, so the only behaviour change here is that
    // a mid-turn drop now triggers `HarnessInbound::Cancel` + immediate
    // slot release instead of leaking the guard.
    //
    // The closure is `FnOnce` and captures `early_release_tx` and
    // `drop_guard_commands_tx` by move; `SseDropGuardStream` calls
    // it at most once via `Option::take()` in its `Drop` impl, so the
    // `oneshot::Sender::send` consume-by-value contract is honoured.
    let stream_with_drop_guard = SseDropGuardStream::new(stream, move || {
        // `oneshot::Sender::send` consumes the sender; on success the
        // sentinel forwards Cancel and releases the slot. On failure
        // (sentinel already returned because a terminal event arrived
        // first) the receiver is gone and we don't need to do anything
        // — the slot has already been released by the happy path.
        if early_release_tx.send(drop_guard_commands_tx).is_err() {
            debug!(
                session_key = %drop_guard_session_key,
                "SSE drop guard: slot-release sentinel already finished — happy-path completion, no cancel needed"
            );
        } else {
            debug!(
                session_key = %drop_guard_session_key,
                "SSE drop guard: client disconnected before terminal event — forwarded Cancel and released slot"
            );
        }
    });

    let boxed: SseStream = Box::pin(stream_with_drop_guard);

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
