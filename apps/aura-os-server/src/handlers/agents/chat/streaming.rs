//! SSE streaming plumbing for chat: harness → SSE bridge, response
//! header construction, attachment translation, and the
//! `open_harness_chat_stream` orchestrator that ties persistence,
//! session lookup, and the SSE response together.
//!
//! # Concurrency model and known caveats
//!
//! Since the parallel-session-chats change, two POSTs against the
//! same `(project, agent_instance)` pair with different `session_id`
//! values open two distinct `ChatSession` registry entries with
//! distinct `turn_slot` mutexes (see
//! [`aura_os_core::harness_agent_id`] for the partition string and
//! [`crate::state::ChatSessionKey`] for the registry key). Turns on
//! different storage sessions of the same instance therefore stream
//! truly concurrently — no serialization at the chat-session layer.
//!
//! What is **not** isolated per session today:
//!
//! * **Working directory / cwd**: a project's working directory is
//!   keyed at the project level, not the session level. Two
//!   concurrent destructive turns on the same instance can race on
//!   filesystem state (e.g. one turn renaming a file the other turn
//!   is reading).
//! * **Terminal PTY**: the long-lived PTY attached to a project's
//!   terminal tool is shared across sessions of that project. Two
//!   concurrent turns issuing terminal commands will interleave
//!   command output on the same PTY.
//! * **Destructive file / command tools**: `write_file`,
//!   `delete_file`, shell-exec, and similar are not session-scoped.
//!   Concurrent destructive turns can interleave in ways that are
//!   not deterministic and not safely undoable.
//!
//! For chat-only or read-only workloads (e.g. side conversations,
//! "ask about this code" sessions running alongside a long-running
//! coding turn) the shared workspace is harmless. For two
//! simultaneous *editing* turns on the same instance, callers should
//! expect interleaved writes today; per-session worktree isolation
//! is the planned follow-up.
//!
//! Cross-feature serialization (chat vs. dev loop / single-task /
//! Swarm-tools) is preserved by the automaton registry's busy-guard,
//! which keys on the bare `(template, instance)` partition. Chat
//! sessions intentionally stay outside that guard so concurrent
//! storage sessions on a single instance can stream in parallel.

use std::convert::Infallible;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aura_os_core::HarnessMode;
use aura_os_harness::{
    ErrorMsg, HarnessCommandSender, HarnessOutbound, MessageAttachment, SessionBridge,
    SessionBridgeStarted, SessionBridgeTurn, SessionConfig,
};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use futures_util::StreamExt as FuturesStreamExt;
use tokio::sync::{broadcast, Mutex};
use tracing::{debug, error, info, warn};

use crate::dto::ChatAttachmentDto;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::types::sse_response_headers;
use crate::stability_metrics::StabilityMetrics;
use crate::state::{AppState, ChatSession, ChatSessionKey};

use super::errors::{
    map_session_bridge_error, map_session_bridge_start_error, remap_harness_error_to_sse,
};
use super::event_bus::{publish_session_summary_updated_event, publish_user_message_event};
use super::persist::{persist_user_message, ChatPersistCtx, ForkInfo};
use super::persist_task::{spawn_chat_persist_task, ChatPersistTaskExtras};
use super::turn_slot::{
    acquire_turn_slot, spawn_turn_slot_release, spawn_turn_watchdog, TurnSlotGuard,
};
use super::types::{SseResponse, SseStream};
use crate::handlers::agents::session_identity::{
    validate_session_identity, SessionIdentityRequirements,
};

const LAGGED_PROGRESS_INTERVAL: Duration = Duration::from_secs(1);

/// Interval between synthetic `progress { stage: "heartbeat" }` SSE
/// frames emitted while the harness broadcast is silent.
///
/// Plumbs through to the frontend stuck-stream watchdog: every wire
/// event bumps `lastEventAt` on the Zustand stream store
/// (`interface/src/hooks/stream/store.ts`), and the watchdog
/// (`useStreamHealth`) flips `isStuck` true at `STUCK_THRESHOLD_MS`
/// (30s) and auto-aborts the turn at `FULLY_TIMED_OUT_MS` (60s).
/// Without these heartbeats, a tool-heavy chat turn that legitimately
/// pauses between a batch of `ToolResult` events and the model's
/// next `TextDelta` / `ThinkingDelta` (e.g. plan-mode translating
/// five `get_spec` results into a long German answer) leaves the SSE
/// wire silent for >60s and trips the watchdog even though the
/// upstream is healthy and progressing.
///
/// Sized comfortably under the 30s warn threshold so even a dropped
/// tick (network jitter, slow scheduler) lands the next heartbeat
/// before the watchdog flips. Mirrors the
/// `GENERATION_HEARTBEAT_INTERVAL` used by the image / video / 3D
/// generation handlers and the same client-side
/// `markStreamProgress` plumbing handles both.
pub(crate) const SSE_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

struct HarnessSseState {
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    done: bool,
    metrics: Option<Arc<StabilityMetrics>>,
    saw_content: bool,
    saw_terminal: bool,
    lagged_throttle: LaggedProgressThrottle,
}

impl HarnessSseState {
    fn new(
        rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
        metrics: Option<Arc<StabilityMetrics>>,
    ) -> Self {
        Self {
            rx,
            done: false,
            metrics,
            saw_content: false,
            saw_terminal: false,
            lagged_throttle: LaggedProgressThrottle::default(),
        }
    }
}

#[derive(Default)]
struct LaggedProgressThrottle {
    last_lagged_progress_at: Option<Instant>,
    pending_lagged_skipped: u64,
}

impl LaggedProgressThrottle {
    fn observe(&mut self, skipped: u64, now: Instant) -> Option<u64> {
        let should_emit = self
            .last_lagged_progress_at
            .map(|last| now.duration_since(last) >= LAGGED_PROGRESS_INTERVAL)
            .unwrap_or(true);

        if should_emit {
            let total = skipped.saturating_add(self.pending_lagged_skipped);
            self.pending_lagged_skipped = 0;
            self.last_lagged_progress_at = Some(now);
            Some(total)
        } else {
            self.pending_lagged_skipped = self.pending_lagged_skipped.saturating_add(skipped);
            None
        }
    }
}

fn is_terminal_harness_event(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
    )
}

fn is_content_bearing_harness_event(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::AssistantMessageStart(_)
            | HarnessOutbound::TextDelta(_)
            | HarnessOutbound::ThinkingDelta(_)
            | HarnessOutbound::ToolUseStart(_)
            | HarnessOutbound::ToolResult(_)
            | HarnessOutbound::ToolCallSnapshot(_)
            | HarnessOutbound::ToolApprovalPrompt(_)
            | HarnessOutbound::GenerationStart(_)
            | HarnessOutbound::GenerationProgress(_)
            | HarnessOutbound::GenerationPartialImage(_)
    )
}

fn stream_truncated_error_event() -> Result<Event, Infallible> {
    let err = ErrorMsg {
        code: "stream_truncated".to_string(),
        message: "Agent stream ended before the turn completed. Retrying will recover the latest saved output from history.".to_string(),
        recoverable: true,
        support_id: None,
    };
    let normalized = HarnessOutbound::Error(remap_harness_error_to_sse(&err));
    super::super::super::sse::harness_event_to_sse(&normalized)
}

fn lagged_progress_event(skipped: u64) -> Result<Event, Infallible> {
    let payload = serde_json::json!({
        "type": "progress",
        "stage": "lagged",
        "skipped": skipped,
        "message": "Catching up...",
    });
    Ok(Event::default()
        .event("progress")
        .json_data(&payload)
        .unwrap_or_else(|_| {
            Event::default()
                .event("progress")
                .data("{\"type\":\"progress\",\"stage\":\"lagged\"}")
        }))
}

/// Synthetic `progress { stage: "heartbeat" }` SSE frame emitted when
/// the harness broadcast stays silent past
/// [`SSE_HEARTBEAT_INTERVAL`]. The client treats this stage as a
/// pure watchdog ack — see the `stage === "heartbeat"` branches in
/// `interface/src/hooks/use-chat-stream/build-stream-handler.ts` and
/// `interface/src/hooks/use-agent-chat-stream.ts`, which call
/// `markStreamProgress` without touching the visible progress label.
fn heartbeat_progress_event() -> Result<Event, Infallible> {
    let payload = serde_json::json!({
        "type": "progress",
        "stage": "heartbeat",
    });
    Ok(Event::default()
        .event("progress")
        .json_data(&payload)
        .unwrap_or_else(|_| {
            Event::default()
                .event("progress")
                .data("{\"type\":\"progress\",\"stage\":\"heartbeat\"}")
        }))
}

/// Bridge a harness broadcast receiver into the SSE wire format.
///
/// `metrics`, when `Some`, is bumped on the non-terminal `Lagged` arm
/// — Phase 5 wiring so the operator-visible `stream_lagged` counter
/// reflects every "consumer fell behind" event. Tests pass `None`
/// because the existing `harness_broadcast_to_sse_lagged_emits_*`
/// regressions only assert the SSE shape; the dedicated
/// `harness_broadcast_to_sse_lagged_increments_metric` test below
/// exercises the metrics path.
pub fn harness_broadcast_to_sse(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    metrics: Option<Arc<StabilityMetrics>>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    stream::unfold(HarnessSseState::new(rx, metrics), |mut state| async move {
        if state.done {
            return None;
        }

        loop {
            match tokio::time::timeout(SSE_HEARTBEAT_INTERVAL, state.rx.recv()).await {
                // Heartbeat path: no harness event arrived inside the
                // interval, so emit a synthetic `progress: heartbeat`
                // frame to keep the client's stuck-stream watchdog
                // clock from tripping on a turn that is genuinely
                // working but happens to be quiet on the wire (e.g.
                // model thinking between a batch of tool results and
                // the next text-delta). Don't touch `saw_content` /
                // `saw_terminal` / `done` — heartbeats are neither
                // content nor terminal events.
                Err(_elapsed) => {
                    return Some((heartbeat_progress_event(), state));
                }
                Ok(Ok(evt)) => {
                    let should_close = is_terminal_harness_event(&evt);
                    state.saw_content |= is_content_bearing_harness_event(&evt);
                    state.saw_terminal |= should_close;
                    state.done = should_close;
                    // Phase 3 of agent-stuck-and-reset: every SSE-bound
                    // error goes through `remap_harness_error_to_sse`,
                    // which (a) intercepts the harness "turn already in
                    // progress" error mid-stream and rewrites it to the
                    // structured `agent_busy` code, and (b) stamps every
                    // forwarded error — busy or not — with a fresh
                    // `support_id=<id>` suffix so users can paste the id
                    // back into feedback and support can grep server
                    // logs immediately. The error still closes the SSE
                    // stream — `should_close` above already covers
                    // `Error(_)` regardless of remap outcome.
                    let normalized = match evt {
                        HarnessOutbound::Error(err) => {
                            HarnessOutbound::Error(remap_harness_error_to_sse(&err))
                        }
                        other => other,
                    };
                    let event = super::super::super::sse::harness_event_to_sse(&normalized);
                    return Some((event, state));
                }
                // The harness broadcast channel evicted `n` events before we
                // could read them — typically because heavy text-delta + large
                // tool-result traffic outran the SSE writer.
                //
                // Phase 1.2 of the agent-stream reliability plan demotes this
                // from a terminal SSE `error` (which closed the stream and
                // showed the user a red banner) to a transient
                // `progress: lagged` hint. The parallel `chat_persist_task`
                // already drains through lag, so the post-stream history
                // refetch will repaint the full assistant turn from storage;
                // there is no reliability reason to kill the live stream.
                // Phase 4 throttles those hints to avoid adding excessive
                // writes while the SSE path is already backpressured.
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                    if let Some(m) = state.metrics.as_ref() {
                        m.inc_stream_lagged();
                    }
                    if let Some(skipped) = state.lagged_throttle.observe(n, Instant::now()) {
                        warn!(
                            skipped,
                            "harness_broadcast_to_sse: receiver lagged; emitting throttled progress:lagged and continuing"
                        );
                        return Some((lagged_progress_event(skipped), state));
                    }
                    warn!(
                        skipped = n,
                        pending_skipped = state.lagged_throttle.pending_lagged_skipped,
                        "harness_broadcast_to_sse: receiver lagged; suppressing throttled progress:lagged"
                    );
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                    if state.saw_content && !state.saw_terminal {
                        warn!(
                            "harness_broadcast_to_sse: broadcast closed after content without terminal event; emitting stream_truncated"
                        );
                        state.saw_terminal = true;
                        state.done = true;
                        return Some((stream_truncated_error_event(), state));
                    }
                    return None;
                }
            }
        }
    })
}

pub(super) fn dto_attachments_to_protocol(
    atts: &Option<Vec<ChatAttachmentDto>>,
) -> Option<Vec<MessageAttachment>> {
    atts.as_ref().and_then(|v| {
        if v.is_empty() {
            None
        } else {
            Some(
                v.iter()
                    .map(|a| MessageAttachment {
                        type_: a.type_.clone(),
                        media_type: a.media_type.clone(),
                        data: a.data.clone(),
                        name: a.name.clone(),
                        source_url: a.source_url.clone(),
                    })
                    .collect(),
            )
        }
    })
}

/// Inputs to `open_harness_chat_stream`. Bundled so the function stays
/// inside the 5-parameter limit and call sites compose easily.
pub(super) struct OpenChatStreamArgs {
    pub(super) session_key: String,
    pub(super) harness_mode: HarnessMode,
    pub(super) session_config: SessionConfig,
    pub(super) user_content: String,
    pub(super) requested_model: Option<String>,
    pub(super) persist_ctx: Option<ChatPersistCtx>,
    pub(super) attachments: Option<Vec<ChatAttachmentDto>>,
    pub(super) commands: Option<Vec<String>>,
    /// Phase 3 auto-fork breadcrumb. When `Some`, the chat resolver
    /// just minted a fresh storage session because the prior one
    /// crossed `AURA_CHAT_AUTO_FORK_THRESHOLD`; `build_sse_stream`
    /// prepends a single `progress: forked_for_context` SSE event
    /// so the chat panel can swap `?session=<old>` → `?session=<new>`
    /// and surface a one-shot soft banner before the
    /// `connecting` / `queued` prefix.
    pub(super) fork_info: Option<ForkInfo>,
    /// `true` when this turn is being issued in plan mode
    /// (`action=generate_specs`). Causes the outbound user message to
    /// be wrapped with the plan-mode preamble for the harness wire
    /// payload (persistence still stores the raw `user_content`) and
    /// the `tool_hints` payload to be filled with the plan-mode tool
    /// surface so even a warm session that started in code mode sees
    /// plan-mode steering on this turn. See
    /// `crate::handlers::plan_mode` for the contract.
    pub(super) is_plan_mode: bool,
}

pub(super) fn tool_hints_from_commands(commands: Option<&[String]>) -> Option<Vec<String>> {
    let mut hints = Vec::new();
    for command in commands.unwrap_or(&[]) {
        let hint = match command.as_str() {
            "generate_image" => "generate_image",
            "generate_3d" | "generate_3d_model" => "generate_3d_model",
            _ => continue,
        };
        if !hints.iter().any(|existing| existing == hint) {
            hints.push(hint.to_string());
        }
    }
    (!hints.is_empty()).then_some(hints)
}

/// Build the final `tool_hints` payload for a chat turn. Merges the
/// command-derived hints with the plan-mode hints (when this is a
/// plan-mode turn) and dedupes so a caller that asked for a media
/// command on a plan-mode turn still sees both surfaces. Returns
/// `None` only when both inputs are empty so the on-wire payload stays
/// `Option<Vec<_>>` and clients without hints see the same shape as
/// before.
pub(super) fn build_turn_tool_hints(
    commands: Option<&[String]>,
    is_plan_mode: bool,
) -> Option<Vec<String>> {
    let command_hints = tool_hints_from_commands(commands).unwrap_or_default();
    let mut merged = command_hints;
    if is_plan_mode {
        for hint in crate::handlers::plan_mode::plan_mode_tool_hints() {
            if !merged.iter().any(|existing| existing == &hint) {
                merged.push(hint);
            }
        }
    }
    (!merged.is_empty()).then_some(merged)
}

pub(super) async fn open_harness_chat_stream(
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
    let persist_snapshot: Option<(String, String)> =
        Some((ctx.session_id.clone(), ctx.project_id.clone()));

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
    crate::error::ChatPersistErrorCtx {
        session_id: Some(ctx.session_id.clone()),
        project_id: Some(ctx.project_id.clone()),
        project_agent_id: Some(ctx.project_agent_id.clone()),
    }
}

/// Background task: title-generate a brand-new chat session from the
/// user's first message and push the result to the sidekick over the
/// WS event bus. Fire-and-forget — failures are logged but never
/// surfaced to the caller, since the lazy `useSessionSummaries`
/// backfill via the /summarize endpoint is still a fallback.
///
/// Two cheap guards before we spend a Haiku call:
/// 1. The session already has a non-empty `summary_of_previous_context`
///    (rollover seed from `aura_os_sessions::session_service` carries
///    prior context forward — don't clobber it with a title).
/// 2. There's more than one persisted `user_message` for the session
///    (we already persisted the inbound one above, so >1 means a
///    follow-up turn, not a fresh chat).
fn spawn_session_title_task(
    http: reqwest::Client,
    router_url: String,
    event_bus: broadcast::Sender<serde_json::Value>,
    ctx: ChatPersistCtx,
    user_content: String,
) {
    tokio::spawn(async move {
        let storage = ctx.storage.clone();

        // Guard 1: respect rolled-over summary from session_service.
        match storage.get_session(&ctx.session_id, &ctx.jwt).await {
            Ok(ss) => {
                if ss
                    .summary_of_previous_context
                    .as_deref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
                {
                    return;
                }
            }
            Err(e) => {
                warn!(session_id = %ctx.session_id, error = %e, "title task: get_session failed; skipping");
                return;
            }
        }

        // Guard 2: only fire on the first user_message for the session.
        // We just persisted the inbound message above, so a count of
        // exactly 1 means this is a fresh chat. >1 ⇒ follow-up turn.
        let user_message_count = match storage
            .list_events(&ctx.session_id, &ctx.jwt, None, None)
            .await
        {
            Ok(events) => events
                .iter()
                .filter(|e| e.event_type.as_deref() == Some("user_message"))
                .count(),
            Err(e) => {
                warn!(session_id = %ctx.session_id, error = %e, "title task: list_events failed; skipping");
                return;
            }
        };
        if user_message_count != 1 {
            return;
        }

        let result = crate::handlers::agents::sessions::generate_session_title(
            &storage,
            &http,
            &router_url,
            &ctx.jwt,
            &ctx.session_id,
            &ctx.project_id,
            // Mirror `generate_session_summary` / `summarize_session`:
            // attribute the title's tokens to the project-agent
            // binding (`project_agent_id`), which is what the chat
            // path itself stamps. `ctx.agent_id` is `None` for
            // project-scoped chat so it isn't a usable substitute.
            &ctx.project_agent_id,
            &user_content,
        )
        .await;

        match result {
            Ok(title) if !title.is_empty() => {
                publish_session_summary_updated_event(&event_bus, &ctx, &title);
                info!(session_id = %ctx.session_id, title_len = title.len(), "session title generated");
            }
            Ok(_) => {
                // Empty input or empty model output — nothing to publish.
            }
            Err(e) => {
                warn!(session_id = %ctx.session_id, error = %e, "title task: generation failed");
            }
        }
    });
}

/// Result of `get_or_create_delegated_chat_session`: a freshly opened
/// or reused chat session with its turn-slot guard already held by
/// the orchestrator.
pub(super) struct SessionForTurn {
    /// `true` when we cold-started the harness session in this call.
    /// Preserves the existing `progress: connecting` SSE prefix
    /// behaviour for first-turn UX.
    pub(super) is_new: bool,
    /// `true` when the per-partition turn slot was held when this
    /// call entered, i.e. the user message had to wait for the
    /// previous turn to terminate. Drives the new
    /// `progress: queued` SSE prefix.
    pub(super) was_queued: bool,
    /// SSE-bound receiver. The harness fan-out broadcast is wired
    /// here; the orchestrator resubscribes to feed the persist task
    /// and the turn-slot release sentinel.
    pub(super) rx: broadcast::Receiver<HarnessOutbound>,
    /// Sender paired with `rx`, used to broadcast synthetic terminal
    /// errors when the remote runtime goes silent while SSE keep-alives
    /// keep the HTTP connection open.
    pub(super) events_tx: broadcast::Sender<HarnessOutbound>,
    /// Held for the entire lifetime of this user turn; handed to a
    /// sentinel task that watches the broadcast for the terminal
    /// event and drops the guard there.
    pub(super) slot_guard: TurnSlotGuard,
}

fn build_sse_stream(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    is_new: bool,
    was_queued: bool,
    fork_info: Option<ForkInfo>,
    metrics: Option<Arc<StabilityMetrics>>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    let mut prefix: Vec<Result<Event, Infallible>> = Vec::new();
    // Phase 3 auto-fork: emit the `forked_for_context` event FIRST so
    // the chat panel can swap `?session=<old>` → `?session=<new>` and
    // mount its one-shot soft banner before `connecting` / `queued`
    // arrive. Older clients that don't recognise the stage gracefully
    // ignore the event (the progress dispatcher is a switch on
    // `stage` strings).
    if let Some(fork) = fork_info {
        if let Ok(forked_event) = Event::default()
            .event("progress")
            .json_data(serde_json::json!({
                "type": "progress",
                "stage": "forked_for_context",
                "previous_session_id": fork.previous_session_id,
                "new_session_id": fork.new_session_id,
                "message": "Continued from previous chat — context was filling up",
            }))
        {
            prefix.push(Ok(forked_event));
        }
    }
    if is_new {
        if let Ok(progress_event) = Event::default()
            .event("progress")
            .json_data(serde_json::json!({"type":"progress","stage":"connecting"}))
        {
            prefix.push(Ok(progress_event));
        }
    }
    if was_queued {
        // Surface the "your message is waiting behind the previous
        // turn" hint as a structured SSE progress event so the UI
        // can render distinct copy from `connecting`. Phase 4 wires
        // this into the chat composer; until then the event is a
        // no-op for older clients that ignore unknown progress
        // stages.
        if let Ok(progress_event) =
            Event::default()
                .event("progress")
                .json_data(serde_json::json!({
                    "type":"progress",
                    "stage":"queued",
                    "message":"Queued behind current turn",
                }))
        {
            prefix.push(Ok(progress_event));
        }
    }
    let broadcast_stream = harness_broadcast_to_sse(rx, metrics);
    FuturesStreamExt::chain(stream::iter(prefix), broadcast_stream)
}

async fn get_or_create_delegated_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    requested_model: Option<String>,
    turn: SessionBridgeTurn,
) -> ApiResult<SessionForTurn> {
    if let Some(reused) = try_reuse_session(state, key, &requested_model).await {
        return reuse_with_turn_slot(
            reused,
            turn,
            state.harness_ws_slots,
            Arc::clone(&state.stability_metrics),
        )
        .await;
    }

    let harness = state.harness_for(harness_mode);
    let session_agent_id = session_config.agent_id.clone();
    let session_template_agent_id = session_config.template_agent_id.clone();
    let t0 = std::time::Instant::now();
    tracing::info!(
        session_key = %key,
        harness_mode = ?harness_mode,
        "chat cold-open begin"
    );
    let open_fut = SessionBridge::open_and_send_user_message(harness, session_config, turn);
    let started = match tokio::time::timeout(std::time::Duration::from_secs(60), open_fut).await {
        Ok(result) => result.map_err(map_session_bridge_start_error(
            key,
            harness_mode,
            state.harness_ws_slots,
        ))?,
        Err(_elapsed) => {
            tracing::error!(
                elapsed_ms = t0.elapsed().as_millis() as u64,
                session_key = %key,
                "chat cold-open TIMEOUT — open_session hung past 60s"
            );
            return Err(ApiError::bad_gateway(
                "Harness did not open the session within 60s. Please retry or restart the harness.",
            ));
        }
    };
    tracing::info!(
        elapsed_ms = t0.elapsed().as_millis() as u64,
        session_key = %key,
        "chat cold-open complete"
    );
    insert_delegated_chat_session(
        state,
        key,
        requested_model,
        session_agent_id,
        session_template_agent_id,
        started,
    )
    .await
}

/// Handles the cloned turn-slot from an alive registry entry —
/// acquires the per-partition mutex (waiting if another turn is
/// in flight), maps queue-full to `ApiError::agent_busy`, and only
/// then forwards the user message into the harness mpsc. Sending
/// AFTER the slot is held is what prevents the upstream
/// `turn_in_progress` race.
async fn reuse_with_turn_slot(
    reused: ReusedSessionHandles,
    turn: SessionBridgeTurn,
    ws_slots_cap: usize,
    metrics: Arc<StabilityMetrics>,
) -> ApiResult<SessionForTurn> {
    let acquired = acquire_turn_slot(reused.turn_slot, reused.turn_pending_count)
        .await
        .map_err(|_| {
            metrics.inc_agent_busy_queue_full();
            ApiError::agent_busy(
                "Agent is busy: another turn is already running and one is queued.",
                None,
            )
        })?;
    SessionBridge::send_user_message(&reused.commands_tx, turn)
        .map_err(|err| map_session_bridge_error(err, ws_slots_cap))?;
    Ok(SessionForTurn {
        is_new: false,
        was_queued: acquired.queued,
        rx: reused.rx,
        events_tx: reused.events_tx,
        slot_guard: acquired.guard,
    })
}

/// Cloned handles needed by `reuse_with_turn_slot` — taken while
/// holding the registry mutex briefly, then released so the slot
/// `await` does not block other partitions.
struct ReusedSessionHandles {
    rx: broadcast::Receiver<HarnessOutbound>,
    events_tx: broadcast::Sender<HarnessOutbound>,
    commands_tx: HarnessCommandSender,
    turn_slot: Arc<Mutex<()>>,
    turn_pending_count: Arc<AtomicUsize>,
}

async fn try_reuse_session(
    state: &AppState,
    key: &str,
    requested_model: &Option<String>,
) -> Option<ReusedSessionHandles> {
    // Phase 4: the registry is now keyed on `(session_key, model)`,
    // so two clients on the same partition picking different models
    // each get their own entry and never evict each other. The
    // `model_changed(...)` helper that used to wipe the resident
    // session whenever the requested model drifted is gone — its
    // job is taken over by the composite key lookup.
    let composite_key = ChatSessionKey::new(key, requested_model.clone());
    let entry = state.chat_sessions.get(&composite_key)?;
    if !entry.is_alive() {
        // Drop the `Ref` BEFORE removing the same key: DashMap shard
        // locks are non-reentrant, and remove() would deadlock if a
        // read guard for the same shard is still alive on this task.
        drop(entry);
        state.chat_sessions.remove(&composite_key);
        return None;
    }
    let handles = ReusedSessionHandles {
        rx: entry.events_tx.subscribe(),
        events_tx: entry.events_tx.clone(),
        commands_tx: entry.commands_tx.clone(),
        turn_slot: Arc::clone(&entry.turn_slot),
        turn_pending_count: Arc::clone(&entry.turn_pending_count),
    };
    // Drop the read `Ref` before the caller `await`s on the
    // turn-slot mutex — holding it across `.await` would block any
    // other partition that hashes onto the same DashMap shard.
    drop(entry);
    Some(handles)
}

async fn insert_delegated_chat_session(
    state: &AppState,
    key: &str,
    requested_model: Option<String>,
    session_agent_id: Option<String>,
    session_template_agent_id: Option<String>,
    started: SessionBridgeStarted,
) -> ApiResult<SessionForTurn> {
    // Build the per-partition turn slot up front and acquire it BEFORE
    // exposing the new session through the registry. The first user
    // message is already in flight via `open_and_send_user_message`,
    // so no other call can collide with us here — but a second
    // back-to-back send arriving the moment we publish the entry
    // MUST observe the slot as held, otherwise it would race the
    // first turn and trigger the upstream `turn_in_progress` error.
    let turn_slot = Arc::new(Mutex::new(()));
    let turn_pending_count = Arc::new(AtomicUsize::new(0));
    let acquired = acquire_turn_slot(Arc::clone(&turn_slot), Arc::clone(&turn_pending_count))
        .await
        .map_err(|_| {
            ApiError::internal("turn slot rejected fresh acquire — should be unreachable")
        })?;

    let rx = started.events_rx;
    let events_tx = started.session.events_tx.clone();
    let composite_key = ChatSessionKey::new(key, requested_model.clone());
    state.chat_sessions.insert(
        composite_key,
        ChatSession {
            session_id: started.session.session_id,
            commands_tx: started.session.commands_tx,
            events_tx: started.session.events_tx,
            model: requested_model,
            agent_id: session_agent_id,
            template_agent_id: session_template_agent_id,
            turn_slot,
            turn_pending_count,
        },
    );
    Ok(SessionForTurn {
        is_new: true,
        was_queued: false,
        rx,
        events_tx,
        slot_guard: acquired.guard,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use aura_os_harness::{
        AssistantMessageEnd, ErrorMsg, FilesChanged, HarnessOutbound, SessionUsage, TextDelta,
    };
    use futures_util::StreamExt;
    use tokio::sync::{broadcast, Mutex};

    use super::super::persist::ForkInfo;
    use super::super::turn_slot::acquire_turn_slot;
    use super::{
        build_sse_stream, build_turn_tool_hints, harness_broadcast_to_sse,
        tool_hints_from_commands, LaggedProgressThrottle, LAGGED_PROGRESS_INTERVAL,
        SSE_HEARTBEAT_INTERVAL,
    };

    fn end_event() -> HarnessOutbound {
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".into(),
            stop_reason: "stop".into(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        })
    }

    fn text_delta(text: &str) -> HarnessOutbound {
        HarnessOutbound::TextDelta(TextDelta {
            text: text.to_string(),
        })
    }

    fn dump(event: &axum::response::sse::Event) -> String {
        // Event has a derived Debug impl that reveals the underlying
        // BytesMut buffer (the raw `event: ...\ndata: ...\n` SSE wire
        // bytes), which is the only way to inspect a constructed Event
        // without going through the IntoResponse path.
        format!("{:?}", event)
    }

    #[test]
    fn tool_hints_from_commands_maps_generation_commands() {
        let commands = vec![
            "generate_image".to_string(),
            "generate_3d".to_string(),
            "unknown".to_string(),
        ];

        assert_eq!(
            tool_hints_from_commands(Some(&commands)),
            Some(vec![
                "generate_image".to_string(),
                "generate_3d_model".to_string(),
            ]),
        );
    }

    #[test]
    fn tool_hints_from_commands_dedupes_and_ignores_unknowns() {
        let commands = vec![
            "generate_image".to_string(),
            "generate_image".to_string(),
            "not_a_tool".to_string(),
        ];

        assert_eq!(
            tool_hints_from_commands(Some(&commands)),
            Some(vec!["generate_image".to_string()]),
        );
        assert_eq!(tool_hints_from_commands(None), None);
    }

    #[test]
    fn build_turn_tool_hints_code_mode_passes_through_command_hints() {
        let commands = vec!["generate_image".to_string()];
        let hints = build_turn_tool_hints(Some(&commands), /* is_plan_mode */ false)
            .expect("hints derived from command");
        assert_eq!(hints, vec!["generate_image".to_string()]);
        assert!(build_turn_tool_hints(None, false).is_none());
    }

    #[test]
    fn build_turn_tool_hints_plan_mode_adds_plan_mode_surface() {
        let hints = build_turn_tool_hints(None, /* is_plan_mode */ true)
            .expect("plan mode must populate hints even without commands");
        assert!(
            hints.iter().any(|h| h == "create_spec"),
            "plan-mode hints must include `create_spec`, got {hints:?}",
        );
        assert!(
            hints.iter().any(|h| h == "read_file"),
            "plan-mode hints must include `read_file`, got {hints:?}",
        );
        assert!(
            hints.iter().all(|h| h != "write_file"),
            "plan-mode hints must NEVER list a code-writing tool, got {hints:?}",
        );
    }

    #[test]
    fn build_turn_tool_hints_plan_mode_merges_and_dedupes_with_commands() {
        // A user that picks plan mode and ALSO attaches a `/image`
        // slash command must end up with both surfaces in the
        // outbound `tool_hints` so the harness sees the user's
        // explicit intent without losing the plan-mode steering. The
        // dedupe guard fires on tool names common to both lists
        // (today only the plan-mode read/spec tools — no overlap
        // with the media commands, but the test pins the contract).
        let commands = vec!["generate_image".to_string()];
        let hints = build_turn_tool_hints(Some(&commands), /* is_plan_mode */ true)
            .expect("merged hints");
        assert!(
            hints.iter().any(|h| h == "generate_image"),
            "merged hints must keep the command-derived entry, got {hints:?}",
        );
        assert!(
            hints.iter().any(|h| h == "create_spec"),
            "merged hints must include the plan-mode entries, got {hints:?}",
        );
        let mut seen = std::collections::BTreeSet::new();
        for hint in &hints {
            assert!(
                seen.insert(hint.clone()),
                "build_turn_tool_hints must dedupe; saw `{hint}` twice in {hints:?}",
            );
        }
    }

    #[tokio::test]
    async fn build_sse_stream_prepends_queued_progress_when_was_queued() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("hello")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx, /* is_new */ false, /* was_queued */ true, /* fork_info */ None,
            /* metrics */ None,
        );
        tokio::pin!(stream);
        let first = stream
            .next()
            .await
            .expect("queued prefix event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            body.contains("queued"),
            "first event must be the queued progress event, got: {body}"
        );
        assert!(
            body.contains("Queued behind current turn"),
            "queued event must include the human-readable hint, got: {body}"
        );
        // The prepended queued event must come BEFORE any forwarded
        // text delta — that's the whole UX contract for Phase 3.
        let second = stream
            .next()
            .await
            .expect("forwarded text delta")
            .expect("second item is Ok");
        assert!(
            dump(&second).contains("hello"),
            "second event must be the broadcast text delta"
        );
    }

    #[tokio::test]
    async fn build_sse_stream_omits_queued_progress_when_not_queued() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("hello")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx, /* is_new */ false, /* was_queued */ false, /* fork_info */ None,
            /* metrics */ None,
        );
        tokio::pin!(stream);
        let first = stream
            .next()
            .await
            .expect("first event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            !body.contains("queued"),
            "no prefix event must precede the broadcast when was_queued=false, got: {body}"
        );
    }

    /// Phase 3 auto-fork guard: when `fork_info` is set, the stream
    /// must lead with the `progress: forked_for_context` event
    /// (carrying both the previous and new session ids) BEFORE any
    /// other prefix or broadcast event so the chat panel can swap
    /// `?session=` and surface the soft banner before the assistant
    /// turn starts streaming.
    #[tokio::test]
    async fn build_sse_stream_prepends_forked_for_context_when_fork_info_set() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("after-fork")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx,
            /* is_new */ true,
            /* was_queued */ false,
            Some(ForkInfo {
                previous_session_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
                new_session_id: "00000000-0000-0000-0000-000000000bbb".to_string(),
            }),
            /* metrics */ None,
        );
        tokio::pin!(stream);

        let first = dump(
            &stream
                .next()
                .await
                .expect("forked progress event")
                .expect("ok"),
        );
        assert!(
            first.contains("forked_for_context"),
            "first event must be the forked_for_context progress event, got: {first}"
        );
        assert!(
            first.contains("00000000-0000-0000-0000-000000000aaa"),
            "forked event must carry the previous session id, got: {first}"
        );
        assert!(
            first.contains("00000000-0000-0000-0000-000000000bbb"),
            "forked event must carry the new session id, got: {first}"
        );

        let second = dump(
            &stream
                .next()
                .await
                .expect("connecting event after fork")
                .expect("ok"),
        );
        assert!(
            second.contains("connecting"),
            "connecting prefix must follow the forked_for_context event, got: {second}"
        );
    }

    #[tokio::test]
    async fn build_sse_stream_emits_both_connecting_and_queued_when_set() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx, /* is_new */ true, /* was_queued */ true, /* fork_info */ None,
            /* metrics */ None,
        );
        tokio::pin!(stream);
        let first = dump(&stream.next().await.expect("connecting event").expect("ok"));
        let second = dump(&stream.next().await.expect("queued event").expect("ok"));
        assert!(
            first.contains("connecting"),
            "is_new must emit `connecting` before `queued`, got: {first}"
        );
        assert!(
            second.contains("queued"),
            "queued event must follow the connecting event, got: {second}"
        );
    }

    /// End-to-end-ish guard for the queued-turn UX: two back-to-back
    /// acquirers on the same partition slot, with the second one's
    /// SSE stream built using its `was_queued` flag. The first
    /// acquirer holds the slot; the second is unblocked only after
    /// the first releases. The second must observe `queued = true`
    /// AND its build_sse_stream output must lead with the queued
    /// progress event before the first text delta arrives.
    #[tokio::test]
    async fn back_to_back_partition_sends_queue_with_progress_event() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));

        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire");
        assert!(!first.queued, "first acquire on a fresh slot is not queued");

        let slot_2 = Arc::clone(&slot);
        let counter_2 = Arc::clone(&counter);
        let second_handle = tokio::spawn(async move { acquire_turn_slot(slot_2, counter_2).await });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !second_handle.is_finished(),
            "second send must wait while the first holds the slot",
        );
        assert_eq!(
            counter.load(Ordering::Acquire),
            2,
            "both acquirers must be counted while the second is queued",
        );

        drop(first.guard);

        let second = tokio::time::timeout(Duration::from_millis(200), second_handle)
            .await
            .expect("second acquire timed out")
            .expect("join handle")
            .expect("second acquire");
        assert!(
            second.queued,
            "second back-to-back send must observe queued = true",
        );

        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("second-turn")).expect("seed delta");
        tx.send(end_event()).expect("seed end");
        drop(tx);

        let stream = build_sse_stream(rx, /* is_new */ false, second.queued, None, None);
        tokio::pin!(stream);
        let first_evt = dump(
            &stream
                .next()
                .await
                .expect("queued prefix event")
                .expect("ok"),
        );
        let next_evt = dump(
            &stream
                .next()
                .await
                .expect("forwarded text delta")
                .expect("ok"),
        );
        assert!(
            first_evt.contains("queued"),
            "queued progress event must precede the forwarded text delta",
        );
        assert!(
            next_evt.contains("second-turn"),
            "forwarded broadcast event must follow the queued prefix",
        );

        drop(second.guard);
        assert_eq!(
            counter.load(Ordering::Acquire),
            0,
            "both guards dropped should leave the counter at zero",
        );
    }

    /// Phase 1.2 regression guard: a `broadcast::RecvError::Lagged`
    /// observed by `harness_broadcast_to_sse` must NOT close the SSE
    /// stream — it must emit a synthetic `progress: lagged` event and
    /// keep reading subsequent broadcast events. The previous
    /// terminal `error: stream_lagged` killed the live turn whenever
    /// a slow consumer fell behind; now backpressure is a transient
    /// hint and the assistant turn streams to completion.
    #[tokio::test]
    async fn harness_broadcast_to_sse_lagged_emits_progress_and_keeps_streaming() {
        // Capacity 2: send three text deltas before reading so the
        // receiver lags by at least one event on its next recv. After
        // the synthetic progress event, the bridge must forward the
        // remaining events that survived eviction (e.g. the most
        // recent text delta and the terminal end).
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(2);
        tx.send(text_delta("first")).expect("seed first delta");
        tx.send(text_delta("second")).expect("seed second delta");
        tx.send(text_delta("third")).expect("seed third delta");
        tx.send(end_event()).expect("seed end");
        drop(tx);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);

        let first = tokio::time::timeout(Duration::from_millis(200), stream.next())
            .await
            .expect("lagged progress event in time")
            .expect("first event")
            .expect("ok");
        let first_body = dump(&first);
        assert!(
            first_body.contains("event: progress"),
            "first event must be a progress SSE event, got: {first_body}"
        );
        assert!(
            first_body.contains("lagged"),
            "first event must carry the lagged stage, got: {first_body}"
        );
        assert!(
            !first_body.contains("event: error"),
            "lagged path must NOT surface an error SSE event, got: {first_body}"
        );

        // The stream must NOT terminate after a lagged event. Drain a
        // few more items and ensure at least one is a forwarded
        // broadcast event (text_delta with a payload). The end event
        // terminates the stream cleanly via `should_close=true`.
        let mut saw_post_lag_forward = false;
        let mut saw_terminal = false;
        for _ in 0..3 {
            let next = match tokio::time::timeout(Duration::from_millis(200), stream.next()).await {
                Ok(Some(Ok(evt))) => evt,
                Ok(Some(Err(_))) | Ok(None) => break,
                Err(_) => break,
            };
            let body = dump(&next);
            if body.contains("event: text_delta") {
                saw_post_lag_forward = true;
            }
            if body.contains("event: assistant_message_end") {
                saw_terminal = true;
                break;
            }
        }
        assert!(
            saw_post_lag_forward,
            "stream must forward a subsequent text_delta after the lagged progress event"
        );
        assert!(
            saw_terminal,
            "stream must still reach the terminal assistant_message_end event"
        );
    }

    #[tokio::test]
    async fn harness_broadcast_to_sse_closed_after_content_emits_stream_truncated() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("partial")).expect("seed text delta");
        drop(tx);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);

        let first = tokio::time::timeout(Duration::from_millis(200), stream.next())
            .await
            .expect("forwarded text in time")
            .expect("first event")
            .expect("ok");
        assert!(
            dump(&first).contains("partial"),
            "first event must forward the content before synthetic terminal"
        );

        let second = tokio::time::timeout(Duration::from_millis(200), stream.next())
            .await
            .expect("synthetic error in time")
            .expect("second event")
            .expect("ok");
        let body = dump(&second);
        assert!(
            body.contains("event: error"),
            "closed-after-content must emit an error SSE event, got: {body}"
        );
        assert!(
            body.contains("stream_truncated"),
            "synthetic error must carry stream_truncated code, got: {body}"
        );
        assert!(
            body.contains("recoverable"),
            "synthetic error must preserve recoverable payload shape, got: {body}"
        );

        let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
        assert!(
            matches!(next, Ok(None)),
            "stream must close after synthetic stream_truncated event, got: {next:?}"
        );
    }

    #[tokio::test]
    async fn harness_broadcast_to_sse_closed_before_content_emits_nothing() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        drop(tx);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);

        let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
        assert!(
            matches!(next, Ok(None)),
            "closed before content must remain silent, got: {next:?}"
        );
    }

    #[tokio::test]
    async fn harness_broadcast_to_sse_closed_after_terminal_does_not_emit_stream_truncated() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("complete")).expect("seed text delta");
        tx.send(end_event()).expect("seed end");
        drop(tx);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);

        let first = stream
            .next()
            .await
            .expect("text delta")
            .expect("first item is Ok");
        assert!(
            dump(&first).contains("complete"),
            "first event must forward content"
        );

        let second = stream
            .next()
            .await
            .expect("terminal end")
            .expect("second item is Ok");
        let terminal = dump(&second);
        assert!(
            terminal.contains("assistant_message_end"),
            "second event must be the real terminal, got: {terminal}"
        );
        assert!(
            !terminal.contains("stream_truncated"),
            "real terminal must not be replaced by synthetic error, got: {terminal}"
        );

        let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
        assert!(
            matches!(next, Ok(None)),
            "stream must close cleanly after real terminal, got: {next:?}"
        );
    }

    /// Stuck-stream fix: while the harness broadcast is silent —
    /// e.g. a plan-mode chat turn between a batch of `ToolResult`
    /// events and the model's next `TextDelta` — the SSE bridge
    /// must synthesize `progress { stage: "heartbeat" }` frames at
    /// least every [`SSE_HEARTBEAT_INTERVAL`] so the frontend's
    /// stuck-stream watchdog (`STUCK_THRESHOLD_MS = 30s` /
    /// `FULLY_TIMED_OUT_MS = 60s` in
    /// `interface/src/hooks/stream/use-stream-health.ts`) sees
    /// forward motion. Driven on paused tokio time so the assertion
    /// is deterministic and the test stays sub-millisecond.
    #[tokio::test(start_paused = true)]
    async fn harness_broadcast_to_sse_emits_heartbeat_when_broadcast_is_silent() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);

        // Cross the heartbeat boundary by advancing virtual time.
        // tokio::time::advance fires expired timers before yielding,
        // so the next stream poll sees the timeout already elapsed.
        tokio::time::advance(SSE_HEARTBEAT_INTERVAL + Duration::from_millis(100)).await;

        let first = stream
            .next()
            .await
            .expect("heartbeat event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            body.contains("event: progress"),
            "first event must be a progress SSE event, got: {body}",
        );
        assert!(
            body.contains("heartbeat"),
            "first event must carry stage=heartbeat, got: {body}",
        );

        // After the heartbeat the stream must still be alive and
        // forward a real event the moment one lands. Send a text
        // delta on the broadcast and confirm it surfaces without
        // another heartbeat-interval wait.
        tx.send(text_delta("after-heartbeat"))
            .expect("seed text delta");
        let next = stream
            .next()
            .await
            .expect("forwarded text delta")
            .expect("ok");
        assert!(
            dump(&next).contains("after-heartbeat"),
            "post-heartbeat broadcast must still reach the SSE stream",
        );

        // And a terminal event closes the stream cleanly — heartbeats
        // never mark the unfold state `done`, so the terminal path
        // still runs unchanged.
        tx.send(end_event()).expect("seed terminal end");
        let terminal = stream
            .next()
            .await
            .expect("terminal end")
            .expect("ok");
        assert!(
            dump(&terminal).contains("assistant_message_end"),
            "terminal event must follow without being shadowed by a heartbeat",
        );

        let after_terminal = stream.next().await;
        assert!(
            after_terminal.is_none(),
            "stream must close after the terminal event, got: {after_terminal:?}",
        );
    }

    /// Heartbeat path must NOT fire when real broadcast events keep
    /// arriving inside the interval. Drives a steady text-delta
    /// cadence at half the heartbeat interval for three intervals'
    /// worth of wall-clock time and asserts every emitted SSE event
    /// is a real `text_delta` — no heartbeat frames slipped in.
    #[tokio::test(start_paused = true)]
    async fn harness_broadcast_to_sse_skips_heartbeat_while_events_flow() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(64);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);

        let cadence = SSE_HEARTBEAT_INTERVAL / 2;
        let bursts = 3usize;
        for i in 0..bursts {
            tx.send(text_delta(&format!("tick-{i}")))
                .expect("seed delta");
            let event = stream
                .next()
                .await
                .expect("forwarded delta")
                .expect("ok");
            let body = dump(&event);
            assert!(
                body.contains(&format!("tick-{i}")),
                "delta `tick-{i}` must surface as the next event, got: {body}",
            );
            assert!(
                !body.contains("heartbeat"),
                "no heartbeat must slip in while broadcast traffic flows, got: {body}",
            );
            tokio::time::advance(cadence).await;
        }

        tx.send(end_event()).expect("seed terminal");
        let terminal = stream
            .next()
            .await
            .expect("terminal")
            .expect("ok");
        assert!(
            dump(&terminal).contains("assistant_message_end"),
            "terminal event must close out the stream"
        );
    }

    #[test]
    fn lagged_progress_throttle_suppresses_within_interval_and_accumulates() {
        let mut throttle = LaggedProgressThrottle::default();
        let start = Instant::now();

        assert_eq!(
            throttle.observe(2, start),
            Some(2),
            "first lagged observation should emit immediately"
        );
        assert_eq!(
            throttle.observe(3, start + Duration::from_millis(250)),
            None,
            "second lagged observation inside the throttle interval should suppress"
        );
        assert_eq!(
            throttle.observe(5, start + Duration::from_millis(500)),
            None,
            "additional lagged observations inside the interval should suppress"
        );
        assert_eq!(
            throttle.observe(7, start + LAGGED_PROGRESS_INTERVAL),
            Some(15),
            "next emitted progress should include accumulated skipped counts"
        );
    }

    /// Phase 5 wiring guard: the new non-terminal `Lagged` arm of
    /// `harness_broadcast_to_sse` must bump
    /// [`crate::stability_metrics::StabilityMetrics::inc_stream_lagged`]
    /// every time it synthesizes a `progress: lagged` event. Mirrors
    /// the existing `harness_broadcast_to_sse_lagged_emits_progress_*`
    /// regression but additionally pins the metrics-side wiring so a
    /// future refactor can't silently regress to "log + emit but
    /// counter never moves".
    #[tokio::test]
    async fn harness_broadcast_to_sse_lagged_increments_metric() {
        use crate::stability_metrics::StabilityMetrics;
        use std::sync::Arc as StdArc;

        let metrics = StdArc::new(StabilityMetrics::new());
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(2);
        tx.send(text_delta("first")).expect("seed first delta");
        tx.send(text_delta("second")).expect("seed second delta");
        tx.send(text_delta("third")).expect("seed third delta");
        tx.send(end_event()).expect("seed end");
        drop(tx);

        let stream = harness_broadcast_to_sse(rx, Some(StdArc::clone(&metrics)));
        tokio::pin!(stream);
        // Drain to completion so the Lagged arm is definitely hit.
        while tokio::time::timeout(Duration::from_millis(200), stream.next())
            .await
            .ok()
            .flatten()
            .is_some()
        {}

        let snapshot = metrics.snapshot();
        assert!(
            snapshot.stream_lagged >= 1,
            "Lagged arm must bump stream_lagged at least once, got snapshot={snapshot:?}"
        );
    }

    /// Phase-5 regression guard for the in-stream busy remap.
    ///
    /// `harness_broadcast_to_sse` must intercept any
    /// `HarnessOutbound::Error { code: "turn_in_progress", … }` it
    /// observes mid-stream and surface a clean `agent_busy` SSE
    /// `error` event, so the frontend never has to string-match the
    /// raw harness wording. Phase 2 added the
    /// `remap_harness_error_to_sse` helper and the in-bridge call
    /// site; this test pins the end-to-end behavior of the bridge
    /// itself: feed a raw `turn_in_progress` error in, get a
    /// canonical `agent_busy` event out and the stream closes.
    #[tokio::test]
    async fn harness_turn_in_progress_remapped_to_agent_busy_sse_event() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(HarnessOutbound::Error(ErrorMsg {
            code: "turn_in_progress".into(),
            message: "A turn is currently in progress; send cancel first".into(),
            recoverable: true,
            support_id: None,
        }))
        .expect("seed turn_in_progress error");
        drop(tx);

        let stream = harness_broadcast_to_sse(rx, None);
        tokio::pin!(stream);
        let first = tokio::time::timeout(Duration::from_secs(1), stream.next())
            .await
            .expect("event in time")
            .expect("first event")
            .expect("ok");
        let body = dump(&first);
        assert!(
            body.contains("agent_busy"),
            "remapped event must surface the structured `agent_busy` code, got: {body}"
        );
        assert!(
            !body
                .to_ascii_lowercase()
                .contains("turn is currently in progress")
                && !body.contains("turn_in_progress"),
            "remapped event must NOT leak the raw harness wording, got: {body}"
        );

        let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
        assert!(
            matches!(next, Ok(None)),
            "stream must close after the remapped error event, got: {next:?}"
        );
    }
}
