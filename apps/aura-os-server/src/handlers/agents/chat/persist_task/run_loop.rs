//! Per-turn drain loop: consume the harness outbound broadcast, fan each event into the right dispatch arm, fire the auto-fork bookkeeping on a clean terminal, and synthesise an `assistant_message_end` row if the broadcast closes before the harness produced one.

use aura_os_harness::HarnessOutbound;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use super::super::constants::ASSISTANT_TURN_PROGRESS_THROTTLE;
use super::super::cross_agent_reply::spawn_cross_agent_reply_callback;
use super::super::event_bus::{
    publish_assistant_message_end_event, publish_assistant_turn_progress_event,
};
use super::super::persist::ChatPersistCtx;
use super::super::persist_task_dispatch::{coerce_tool_use_input_to_object, handle_outbound};
use super::auto_fork::maybe_spawn_auto_fork_marker;
use super::persist_event::persist_event;
use super::scrub_tool_markup;
use super::state::{
    flush_text_segment, log_stream_summary, message_id_for_synth, message_id_str, PersistTaskState,
};
use super::ChatPersistTaskExtras;

/// Synthetic `tool_result` body injected when the user cancels (or the
/// broadcast closes) before the harness finished a tool call. Anthropic
/// rejects any `tool_use` without a paired `tool_result`, and a real
/// result body would be a lie — so we emit a structured marker the model
/// can recognise as "user stopped this tool call". Kept as a constant so
/// observability greps and any future model-side handling (e.g.
/// surfacing this to the UI) can pin on a stable string.
const CANCELLED_TOOL_RESULT_BODY: &str =
    "[cancelled by user before tool call completed; no result was produced]";

pub(super) async fn run_persist_loop(
    mut rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
    model: Option<String>,
    extras: ChatPersistTaskExtras,
) {
    // Phase 6 cross-agent observability breadcrumb. Phase 3 will read
    // `ctx.originating_agent_id` from inside this task to post B's
    // reply back into A's session on `AssistantMessageEnd`; logging
    // it on entry gives operators a single grep target
    // (`target = "aura::cross_agent"`) for tracing a `send_to_agent`
    // hop end-to-end across the harness ↔ os-server boundary.
    debug!(
        target: "aura::cross_agent",
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        originating_agent_id = ?ctx.originating_agent_id,
        "persist_task started"
    );
    let mut state = PersistTaskState::new();
    // Phase 5 observability: a turn is "completed_ok" only when the
    // persist task observes a clean `AssistantMessageEnd` AND no
    // `Error` event preceded it on this broadcast. An error before
    // end (or instead of end) flips this to false so the
    // `chat_turns_completed_ok` counter advances exactly once per
    // genuinely-clean turn.
    let mut saw_error = false;
    loop {
        match rx.recv().await {
            Ok(evt) => {
                state.seq += 1;
                // Phase 6 cross-agent observability breadcrumb. Pairs with
                // `aura::ws::publishing chat event` (event_bus.rs) so an
                // operator filtering on `aura::cross_agent` can see "did
                // the persist task even observe this harness event" right
                // alongside "did the WS broadcast fire". Variant kind is
                // a short string instead of `{:?}` so the log line stays
                // the same length regardless of payload size.
                debug!(
                    target: "aura::cross_agent",
                    session_id = %ctx.session_id,
                    event = harness_outbound_kind(&evt),
                    "persist_task observed harness event"
                );
                let produced_progress =
                    handle_outbound(&mut state, &ctx, &event_bus, &evt, model.as_deref()).await;
                if matches!(evt, HarnessOutbound::Error(_)) {
                    saw_error = true;
                }
                // Phase 3: peek at the terminal AssistantMessageEnd so
                // we can fire the auto-fork bookkeeping (summary +
                // `rolled_over` flag) into a detached task before this
                // loop breaks. We deliberately do NOT block the
                // turn-finalization sentinel on the summary call: the
                // user-visible turn completes on this session, only the
                // NEXT user send rolls over.
                if let HarnessOutbound::AssistantMessageEnd(end) = &evt {
                    maybe_spawn_auto_fork_marker(&ctx, end, &extras);
                    // Phase 5: clean terminal — only counts if no
                    // `Error` was observed earlier in the same turn.
                    if !saw_error {
                        if let Some(metrics) = extras.stability_metrics.as_ref() {
                            metrics.inc_chat_turns_completed_ok();
                        }
                        crate::usage_signals::emit_completed_turn_signal(
                            &ctx,
                            extras.usage_signal_context.as_ref(),
                            extras.mixpanel.as_ref(),
                            extras.billing_client.as_deref(),
                            &end.usage,
                            crate::usage_signals::CompletedTurnMetrics {
                                tool_use_count: state.tool_use_count,
                                files_changed_count: crate::usage_signals::count_files_changed(
                                    &end.files_changed,
                                ),
                            },
                        )
                        .await;
                        // Phase 3 cross-agent reply delivery. When this
                        // turn was opened by another agent's
                        // `send_to_agent` call (Phase 1: harness sets
                        // `originating_agent_id`; Phase 2: server
                        // threads it onto `ChatPersistCtx`), post B's
                        // accumulated reply back into A's session as
                        // a fresh `user_message` so A's LLM gets a
                        // turn to react. Skipped on `saw_error` so
                        // partial / failed turns don't leak garbage
                        // back into the originator's history. The
                        // cycle-depth guard inside the callback fires
                        // belt-and-suspenders alongside the
                        // single-hop `originating_agent_id: null`
                        // body field — see `cross_agent_reply.rs`.
                        // `state.full_text` is populated by the
                        // `text_delta` accumulator in
                        // `persist_task_dispatch::handle_text_delta`
                        // — by the time we observe
                        // `AssistantMessageEnd` it holds the full
                        // assistant reply for this turn.
                        if ctx.originating_agent_id.is_some() {
                            spawn_cross_agent_reply_callback(
                                &ctx,
                                state.full_text.clone(),
                                ctx.cross_agent_depth,
                                // Carry the model this turn ran on back
                                // into the originating agent's session so
                                // the reply leg never re-introduces the
                                // empty-model failure. Since the inbound
                                // A->B leg forwards the caller's model,
                                // this is the same model throughout the
                                // cross-agent thread.
                                model.clone(),
                                extras.http_client.clone(),
                            );
                        }
                    }
                }
                if matches!(
                    evt,
                    HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                ) {
                    break;
                }
                maybe_publish_progress(&mut state, &ctx, &event_bus, produced_progress);
            }
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!(
                    session_id = %ctx.session_id,
                    project_agent_id = %ctx.project_agent_id,
                    skipped = n,
                    "Chat persistence receiver lagged; continuing to drain so the assistant_message_end is not lost"
                );
                continue;
            }
        }
    }
    finalize_if_needed(&mut state, &ctx, &event_bus, model.as_deref()).await;
}

fn maybe_publish_progress(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    produced_progress: bool,
) {
    // Throttled live-progress heartbeat. The client uses this signal
    // (carried over the WS event bus) to refetch the chat history and
    // pick up the in-flight reconstructed assistant turn — supporting
    // mid-turn page refreshes without losing chat / sidekick state. We
    // deliberately do not ship token-level deltas here; the periodic
    // refetch is enough because `events_to_session_history` already
    // rebuilds the partial turn from the persisted delta rows.
    // `assistant_message_end` continues to be the authoritative
    // finalization signal.
    if !produced_progress {
        return;
    }
    let now = std::time::Instant::now();
    let should_publish = match state.last_progress_at {
        None => true,
        Some(prev) => now.saturating_duration_since(prev) >= ASSISTANT_TURN_PROGRESS_THROTTLE,
    };
    if should_publish && !state.message_id.is_empty() {
        publish_assistant_turn_progress_event(event_bus, ctx, &state.message_id);
        state.last_progress_at = Some(now);
    }
}

/// Safety net: the broadcast channel closed before the harness emitted
/// `assistant_message_end` (e.g. the stream task panicked, the client
/// disconnected mid-turn, or a provider-side hard error). Synthesize a
/// terminating event from whatever we have accumulated so the LLM can
/// see at least a partial record of this turn on the next reopen.
///
/// Pre-persist sweep: any `tool_use` block that never paired with a
/// `tool_result` (the cancel-mid-tool-call shape that produces the
/// Anthropic 400 `tool_use.input: Input should be an object`) gets
/// normalised to an object input AND followed by a synthetic
/// `tool_result` event so the next replay carries a self-consistent
/// turn. Without this both rules can fail simultaneously: the
/// in-memory tool_use carries `Null` input AND the persisted history
/// has a dangling tool_use with no result.
async fn finalize_if_needed(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    model: Option<&str>,
) {
    if state.end_persisted {
        return;
    }
    if state.full_text.is_empty()
        && state.content_blocks.is_empty()
        && state.thinking_buf.is_empty()
    {
        return;
    }
    flush_text_segment(state);
    let orphan_tool_uses = normalize_and_collect_orphan_tool_uses(&mut state.content_blocks);
    let (full_text, _) = scrub_tool_markup(&state.full_text);
    let end_payload = json!({
        "message_id": message_id_for_synth(state),
        "text": full_text,
        "thinking": if state.thinking_buf.is_empty() {
            Value::Null
        } else {
            Value::String(state.thinking_buf.clone())
        },
        "content_blocks": &state.content_blocks,
        "usage": Value::Null,
        "files_changed": {
            "created": [],
            "modified": [],
            "deleted": [],
        },
        "stop_reason": "aborted",
        "seq": state.seq + 1,
        "synthesized": true,
    });
    if persist_event(ctx, "assistant_message_end", end_payload).await {
        state.persisted_events += 1;
        state.end_persisted = true;
        publish_assistant_message_end_event(event_bus, ctx, message_id_str(state));
        log_stream_summary(state, ctx, model, "aborted", true, "broadcast_closed");
    }
    persist_synthetic_tool_results_for_orphans(state, ctx, &orphan_tool_uses).await;
    warn!(
        session_id = %ctx.session_id,
        persisted_events = state.persisted_events,
        content_blocks = state.content_blocks.len(),
        orphan_tool_uses = orphan_tool_uses.len(),
        "Synthesized assistant_message_end after broadcast channel closed early"
    );
}

/// Identifier for a `tool_use` block that needs a synthetic
/// `tool_result` to keep the assistant turn self-consistent on replay.
/// Carrying the `name` along with the id mirrors what the harness emits
/// on a real `tool_result`, so observers downstream can't distinguish a
/// cancelled-call shape by anything other than the body text and the
/// `cancelled: true` marker.
struct OrphanToolUse {
    id: String,
    name: String,
}

/// Walk the in-memory content blocks once and (1) coerce every
/// `tool_use.input` that isn't already an object — defending against
/// the cancel-mid-stream `Null` placeholder seeded by
/// `handle_tool_use_start` and any partial-string snapshot that never
/// completed — and (2) collect the ids of `tool_use` blocks with no
/// matching `tool_result` so the caller can emit synthetic results.
fn normalize_and_collect_orphan_tool_uses(content_blocks: &mut [Value]) -> Vec<OrphanToolUse> {
    use std::collections::HashSet;

    let resulted_ids: HashSet<String> = content_blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
        .filter_map(|b| {
            b.get("tool_use_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect();

    let mut orphans: Vec<OrphanToolUse> = Vec::new();
    for block in content_blocks.iter_mut() {
        if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
            continue;
        }
        let id = block
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let name = block
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let current = block.get("input").cloned().unwrap_or(Value::Null);
        if !current.is_object() {
            block["input"] = coerce_tool_use_input_to_object(&id, &name, &current);
        }
        if !id.is_empty() && !resulted_ids.contains(&id) {
            orphans.push(OrphanToolUse { id, name });
        }
    }
    orphans
}

/// Persist a synthetic `tool_result` row for each orphaned tool_use the
/// finalize sweep collected. We persist these *after*
/// `assistant_message_end` so they round-trip into the next user-role
/// message via `compaction.rs::session_events_to_agent_history`'s
/// pending-tool-results staging — exactly the same path real tool
/// results take. Using the same persisted shape (`tool_result` event)
/// means existing dedupe / dangling-strip / API-edge defences also
/// apply to the synthetic rows for free.
async fn persist_synthetic_tool_results_for_orphans(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    orphans: &[OrphanToolUse],
) {
    for orphan in orphans {
        let payload = json!({
            "message_id": message_id_for_synth(state),
            "tool_use_id": &orphan.id,
            "name": &orphan.name,
            "result": CANCELLED_TOOL_RESULT_BODY,
            "is_error": true,
            "seq": state.seq + 1,
            "synthesized": true,
            "cancelled": true,
        });
        state.seq += 1;
        if persist_event(ctx, "tool_result", payload).await {
            state.persisted_events += 1;
        }
        state.content_blocks.push(json!({
            "type": "tool_result",
            "tool_use_id": &orphan.id,
            "content": CANCELLED_TOOL_RESULT_BODY,
            "is_error": true,
        }));
    }
}

/// Phase 6 cross-agent tracing helper. Maps a [`HarnessOutbound`]
/// variant onto a short, stable string so the
/// `aura::cross_agent::"persist_task observed harness event"` log
/// line is greppable without dragging the full event body into the
/// trace output. Keep these strings stable — they are part of the
/// (informal) operator-facing diagnostic surface.
fn harness_outbound_kind(evt: &HarnessOutbound) -> &'static str {
    match evt {
        HarnessOutbound::SessionReady(_) => "session_ready",
        HarnessOutbound::AssistantMessageStart(_) => "assistant_message_start",
        HarnessOutbound::TextDelta(_) => "text_delta",
        HarnessOutbound::ThinkingDelta(_) => "thinking_delta",
        HarnessOutbound::ToolUseStart(_) => "tool_use_start",
        HarnessOutbound::ToolCallSnapshot(_) => "tool_call_snapshot",
        HarnessOutbound::ToolResult(_) => "tool_result",
        HarnessOutbound::ToolApprovalPrompt(_) => "tool_approval_prompt",
        HarnessOutbound::AssistantMessageEnd(_) => "assistant_message_end",
        HarnessOutbound::Error(_) => "error",
        HarnessOutbound::Progress(_) => "progress",
        HarnessOutbound::GenerationStart(_) => "generation_start",
        HarnessOutbound::GenerationProgress(_) => "generation_progress",
        HarnessOutbound::GenerationPartialImage(_) => "generation_partial_image",
        HarnessOutbound::GenerationCompleted(_) => "generation_completed",
        HarnessOutbound::GenerationError(_) => "generation_error",
        HarnessOutbound::SubagentSpawned(_) => "subagent_spawned",
        HarnessOutbound::SubagentStatus(_) => "subagent_status",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use aura_os_harness::{AssistantMessageEnd, FilesChanged, HarnessOutbound, SessionUsage};
    use axum::{
        extract::{Path, State},
        response::IntoResponse,
        routing::post,
        Json, Router,
    };
    use tokio::net::TcpListener;

    #[test]
    fn normalize_and_collect_orphan_tool_uses_coerces_null_input_and_collects_id() {
        // Cancel-mid-tool-call shape: tool_use_start arrived (seeded
        // {} pre-fix would have been Null) but the broadcast closed
        // before any snapshot or tool_result. Sweep must coerce the
        // input AND report this id as needing a synthetic tool_result.
        let mut blocks = vec![json!({
            "type": "tool_use",
            "id": "toolu_orphan",
            "name": "create_spec",
            "input": Value::Null,
        })];

        let orphans = normalize_and_collect_orphan_tool_uses(&mut blocks);

        assert_eq!(blocks[0]["input"], json!({}), "null input must be healed");
        assert_eq!(orphans.len(), 1, "unpaired tool_use must be collected");
        assert_eq!(orphans[0].id, "toolu_orphan");
        assert_eq!(orphans[0].name, "create_spec");
    }

    #[test]
    fn normalize_and_collect_orphan_tool_uses_skips_paired_blocks() {
        // tool_use that already has a matching tool_result in the
        // same content_blocks — no synthetic result needed. Input
        // normalisation still runs (defense in depth).
        let mut blocks = vec![
            json!({
                "type": "tool_use",
                "id": "toolu_paired",
                "name": "list_files",
                "input": Value::Null,
            }),
            json!({
                "type": "tool_result",
                "tool_use_id": "toolu_paired",
                "content": "real result",
                "is_error": false,
            }),
        ];

        let orphans = normalize_and_collect_orphan_tool_uses(&mut blocks);

        assert_eq!(blocks[0]["input"], json!({}));
        assert!(
            orphans.is_empty(),
            "tool_use with matching tool_result must not be flagged as orphan"
        );
    }

    #[test]
    fn normalize_and_collect_orphan_tool_uses_handles_mixed_orphan_and_paired() {
        // Realistic parallel-tool-call cancel: one of three tool_uses
        // produced its tool_result before Stop landed; the other two
        // are orphans. Sweep must collect exactly the unpaired ids
        // and heal everyone's input.
        let mut blocks = vec![
            json!({"type": "tool_use", "id": "A", "name": "create_spec", "input": Value::Null}),
            json!({"type": "tool_use", "id": "B", "name": "create_spec", "input": Value::Null}),
            json!({"type": "tool_use", "id": "C", "name": "create_spec", "input": Value::Null}),
            json!({"type": "tool_result", "tool_use_id": "B", "content": "ok", "is_error": false}),
        ];

        let orphans = normalize_and_collect_orphan_tool_uses(&mut blocks);

        let orphan_ids: Vec<String> = orphans.iter().map(|o| o.id.clone()).collect();
        assert_eq!(orphan_ids, vec!["A".to_string(), "C".to_string()]);
        for block in blocks.iter().take(3) {
            assert_eq!(block["input"], json!({}));
        }
    }

    #[test]
    fn normalize_and_collect_orphan_tool_uses_leaves_object_input_untouched() {
        let real_input = json!({"title": "Phase 06"});
        let mut blocks = vec![json!({
            "type": "tool_use",
            "id": "toolu_real",
            "name": "create_spec",
            "input": real_input.clone(),
        })];

        let orphans = normalize_and_collect_orphan_tool_uses(&mut blocks);

        assert_eq!(blocks[0]["input"], real_input);
        assert_eq!(orphans.len(), 1, "still orphan because no tool_result");
    }

    #[test]
    fn normalize_and_collect_orphan_tool_uses_coerces_string_input_to_marker_object() {
        // Mid-stream string snapshot trapped at finalize time. Sweep
        // routes through `coerce_tool_use_input_to_object`, which
        // returns `{}` for partial JSON.
        let mut blocks = vec![json!({
            "type": "tool_use",
            "id": "toolu_partial",
            "name": "create_spec",
            "input": Value::String(r#"{"title":"Phas"#.to_string()),
        })];

        let orphans = normalize_and_collect_orphan_tool_uses(&mut blocks);

        assert!(blocks[0]["input"].is_object(), "string must be coerced");
        assert_eq!(blocks[0]["input"], json!({}));
        assert_eq!(orphans.len(), 1);
    }

    #[tokio::test]
    async fn clean_assistant_end_persists_usage_signal_event() {
        type Requests = Arc<Mutex<Vec<aura_os_storage::CreateSessionEventRequest>>>;

        async fn create_event(
            Path(session_id): Path<String>,
            State(requests): State<Requests>,
            Json(req): Json<aura_os_storage::CreateSessionEventRequest>,
        ) -> axum::response::Response {
            requests.lock().expect("requests lock").push(req.clone());
            Json(aura_os_storage::StorageSessionEvent {
                id: format!("evt-{session_id}"),
                session_id: req.session_id,
                user_id: req.user_id,
                agent_id: req.agent_id,
                sender: req.sender,
                project_id: req.project_id,
                org_id: req.org_id,
                event_type: Some(req.event_type),
                content: req.content,
                created_at: Some("2026-06-22T00:00:00Z".to_string()),
            })
            .into_response()
        }

        let requests: Requests = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .route("/api/sessions/:session_id/events", post(create_event))
            .with_state(requests.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        let base_url = format!("http://{addr}");
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(&base_url)),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "project-agent-test".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };

        let signal_ctx = crate::usage_signals::UsageSignalContext {
            user_id: "user-test".to_string(),
            turn_started_at: std::time::Instant::now(),
            route_kind: crate::usage_signals::TurnRouteKind::BareAgent,
            binding_source: crate::usage_signals::AgentBindingSource::AutoHome,
            account_age_days: Some(0),
            is_zero_pro: Some(false),
            is_access_granted: Some(false),
            local_project_count: Some(1),
            same_org_project_count: Some(1),
            has_project_context: true,
            has_user_project_instance: false,
            is_auto_home_only: true,
            is_plan_mode: false,
            is_cross_agent: false,
            is_council: false,
            is_new_session: true,
            attachment_count: 0,
            installed_tool_count: 0,
            installed_integration_count: 0,
            client_ip_hash: Some("run-loop-usage-signal-test-ip".to_string()),
        };
        let usage = SessionUsage {
            input_tokens: 3_500,
            output_tokens: 1_200,
            ..Default::default()
        };

        let (tx, rx) = broadcast::channel(4);
        let (event_bus, _) = broadcast::channel(4);
        tx.send(HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "end_turn".to_string(),
            usage,
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        }))
        .expect("send terminal event");

        run_persist_loop(
            rx,
            ctx,
            event_bus,
            Some("claude-test".to_string()),
            ChatPersistTaskExtras {
                http_client: reqwest::Client::new(),
                router_url: "http://localhost:9999".to_string(),
                auto_fork_threshold: 0.8,
                stability_metrics: None,
                usage_signal_context: Some(signal_ctx),
                mixpanel: None,
                billing_client: None,
            },
        )
        .await;

        let seen = requests.lock().expect("requests lock");
        let event_types: Vec<&str> = seen.iter().map(|req| req.event_type.as_str()).collect();
        assert_eq!(
            event_types,
            vec!["assistant_message_end", "turn_usage_signal"]
        );
        let signal_payload = seen[1].content.as_ref().expect("signal payload");
        assert_eq!(signal_payload["risk_bucket"], "high");
        assert_eq!(signal_payload["usage_shape"], "generic_agent_chat");
        assert_eq!(signal_payload["quota_review_candidate"], true);
        assert_eq!(signal_payload["route_kind"], "bare_agent");
        assert_eq!(signal_payload["binding_source"], "auto_home");
    }
}
