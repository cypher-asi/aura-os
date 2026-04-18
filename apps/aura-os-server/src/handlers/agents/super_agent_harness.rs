//! Harness-hosted super-agent chat route.
//!
//! Phase 4 of the super-agent / harness unification plan wires the
//! [`HarnessSuperAgentDriver`](crate::HarnessSuperAgentDriver) from
//! phase 3 into the real chat surface. Every super-agent turn now
//! executes on an `aura-harness` node via
//! [`handle_super_agent_via_harness`] — persistence, cancellation,
//! and SSE framing are shared with the rest of the agent chat
//! pipeline.
//!
//! # Host-mode routing
//!
//! The dispatcher in [`super::chat::send_agent_event_stream`] calls
//! [`host_mode_for_agent`] to pick between [`HostMode::Harness`]
//! (default) and [`HostMode::InProcess`]. The in-process variant
//! exists only as a diagnostic: the legacy
//! `SuperAgentStream` path has been retired (Phase 6 final step), so
//! an agent that is still pinned with `host_mode:in_process` fails
//! loudly instead of silently running the retired loop.
//!
//! Opt-in tags (both honored during migration and by newly-created
//! agents):
//!
//! - `host_mode:harness` — route via the harness (default).
//! - `host_mode:in_process` — legacy pin, now returns an error.
//! - `AURA_SUPER_AGENT_HOST_MODE=harness` env — fleet-wide override,
//!   still honored for integration tests and staging.
//!
//! The harness side consumes the payload shipped by
//! [`aura_os_super_agent::harness_handoff::build_super_agent_session_init`]
//! and the `/api/super_agent/tools/:name` dispatcher in
//! [`crate::handlers::super_agent_tools`], so user-visible behavior
//! stays bit-compatible with what the in-process route produced
//! before retirement.

use std::sync::Arc;

use aura_os_core::Agent;
use aura_os_link::HarnessOutbound;
use aura_os_super_agent_profile::SuperAgentProfile;
use aura_protocol::{MessageAttachment as ProtocolAttachment, OutboundMessage, SessionInit};
use axum::response::sse::{KeepAlive, Sse};
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use crate::error::ApiResult;
use crate::harness_client::HarnessClient;
use crate::harness_super_agent_driver::{
    HarnessSuperAgentConfig, HarnessSuperAgentDriver, HarnessSuperAgentError,
};
use crate::state::{AppState, SuperAgentRun};

use super::chat::{
    persist_user_message, spawn_chat_persist_task, ChatPersistCtx, SseResponse, SseStream,
    SSE_NO_BUFFERING_HEADERS,
};

/// How a super-agent turn should be executed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostMode {
    /// Retired path: the legacy in-process `SuperAgentStream` loop
    /// was removed in Phase 6. This variant survives only so that an
    /// operator pin (`host_mode:in_process` tag) produces a clean
    /// diagnostic instead of silently falling back to the harness
    /// path, which would hide the misconfigured record.
    InProcess,
    /// Default path: delegate the loop to an `aura-harness` node and
    /// bridge events back through the shared `HarnessOutbound`
    /// broadcast.
    Harness,
}

/// Tag the client attaches to an agent record to opt it into the
/// harness-hosted chat route.
pub const HARNESS_HOST_TAG: &str = "host_mode:harness";

/// Env var that force-flips every super-agent turn to the harness
/// route. Intended for dev, staging, and integration tests — in prod
/// most operators should opt individual agents in via tags instead.
pub const HOST_MODE_ENV: &str = "AURA_SUPER_AGENT_HOST_MODE";

/// Decide which host runs this agent's turn. Agent-tag opt-in beats
/// env override beats the default (in-process).
#[must_use]
pub fn host_mode_for_agent(agent: &Agent) -> HostMode {
    if agent
        .tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case(HARNESS_HOST_TAG))
    {
        return HostMode::Harness;
    }
    match std::env::var(HOST_MODE_ENV) {
        Ok(v) if v.eq_ignore_ascii_case("harness") => HostMode::Harness,
        _ => HostMode::InProcess,
    }
}

/// Parameters for [`handle_super_agent_via_harness`].
///
/// Grouped into a struct because the handler is a direct peer of
/// [`super::chat::send_agent_event_stream`] and callers already have
/// every piece of state handy — this avoids an 8-argument free
/// function.
pub struct HarnessSuperAgentTurn<'a> {
    pub state: &'a AppState,
    pub jwt: &'a str,
    pub agent: &'a Agent,
    pub org_name: &'a str,
    pub org_id: &'a str,
    pub user_content: String,
    pub attachments: Option<Vec<ProtocolAttachment>>,
    pub model_override: Option<String>,
    pub conversation_history: Option<Vec<aura_protocol::ConversationMessage>>,
    pub force_new_session: bool,
    pub persist_ctx: Option<ChatPersistCtx>,
    pub aura_session_id: Option<String>,
    pub profile: Arc<SuperAgentProfile>,
}

/// Execute a single super-agent turn on an aura-harness node and
/// return an SSE response streaming frames as they arrive.
///
/// The handler:
///
/// - wires persistence via [`spawn_chat_persist_task`] so the session
///   transcript is written to storage regardless of host,
/// - registers the run in `state.super_agent_runs` so a reset
///   (`cancel_super_agent_run`) can tear it down mid-flight,
/// - produces a `broadcast::Receiver<HarnessOutbound>` that
///   [`super::chat::harness_broadcast_to_sse`] can consume unchanged.
///
/// The harness records its own transcript in the kernel log, and on
/// cold start the caller reconstructs the LLM context from session
/// events — there is no in-process conversation cache (the legacy
/// `super_agent_messages` cache was removed with the in-process
/// path).
pub async fn handle_super_agent_via_harness(
    params: HarnessSuperAgentTurn<'_>,
) -> ApiResult<SseResponse> {
    let HarnessSuperAgentTurn {
        state,
        jwt,
        agent,
        org_name,
        org_id,
        user_content,
        attachments,
        model_override,
        conversation_history,
        force_new_session,
        persist_ctx,
        aura_session_id,
        profile,
    } = params;
    let agent_id = agent.agent_id;

    let session_key = format!("super_agent:{agent_id}");
    if force_new_session {
        cancel_existing_run(state, &session_key).await;
    }

    let (tx, _) = broadcast::channel::<HarnessOutbound>(256);
    let sse_rx = tx.subscribe();
    let persist_rx = persist_ctx.as_ref().map(|_| tx.subscribe());

    if let Some(ref pctx) = persist_ctx {
        persist_user_message(pctx, &user_content, &attachments_as_chat(&attachments));
    }

    let cancel_token = CancellationToken::new();
    let generation = register_run(state, &session_key, &cancel_token).await;

    let driver = build_driver(state, model_override);
    let init = build_session_init(
        &driver,
        &profile,
        org_name,
        org_id,
        jwt,
        model_for_init(agent),
        conversation_history,
        agent_id.to_string(),
        aura_session_id,
    );

    let wire_attachments = attachments.clone();
    let session = match driver
        .start_with_init(init, jwt, &user_content, wire_attachments)
        .await
    {
        Ok(s) => s,
        Err(err) => {
            forward_driver_error(&tx, err);
            unregister_run(state, &session_key, generation).await;
            let broadcast_stream = super::chat::harness_broadcast_to_sse(sse_rx);
            if let (Some(pctx), Some(prx)) = (persist_ctx, persist_rx) {
                spawn_chat_persist_task(prx, pctx);
            }
            let boxed: SseStream = Box::pin(broadcast_stream);
            return Ok((
                SSE_NO_BUFFERING_HEADERS,
                Sse::new(boxed).keep_alive(KeepAlive::default()),
            ));
        }
    };

    info!(
        %agent_id,
        session_id = %session.session_id,
        generation,
        "super agent: harness session started"
    );

    let runs_registry = state.super_agent_runs.clone();
    let cache_key = session_key.clone();
    let tx_forward = tx.clone();
    let run_cancel = cancel_token.clone();
    let join = tokio::spawn(async move {
        bridge_events_to_broadcast(session.events, tx_forward, run_cancel.clone()).await;
        let mut runs = runs_registry.lock().await;
        let is_current = runs
            .get(&cache_key)
            .map(|r| r.generation == generation)
            .unwrap_or(false);
        if is_current {
            runs.remove(&cache_key);
        }
    });

    // Stash the join handle so reset can abort the bridge even if it
    // is blocked in a recv (the driver's channel close on ws drop
    // would eventually unblock us anyway, but abort is faster).
    {
        let mut runs = state.super_agent_runs.lock().await;
        if let Some(run) = runs.get_mut(&session_key) {
            if run.generation == generation {
                run.join = Some(join);
            }
        }
    }

    if let (Some(pctx), Some(prx)) = (persist_ctx, persist_rx) {
        spawn_chat_persist_task(prx, pctx);
    }

    let broadcast_stream = super::chat::harness_broadcast_to_sse(sse_rx);
    let boxed: SseStream = Box::pin(broadcast_stream);
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

/// Forward every [`OutboundMessage`] from the driver's mpsc into the
/// shared broadcast channel that feeds both SSE and persistence.
///
/// Exits when the driver channel closes (websocket drop / harness end
/// of turn) or when `cancel` fires — whichever comes first. Cancel
/// drops the `HarnessSuperAgentSession` handle, which in turn closes
/// the underlying websocket; the driver's forwarding task then exits,
/// and receivers see `RecvError::Closed`.
async fn bridge_events_to_broadcast(
    mut events: mpsc::Receiver<OutboundMessage>,
    broadcast_tx: broadcast::Sender<HarnessOutbound>,
    cancel: CancellationToken,
) {
    loop {
        tokio::select! {
            biased;
            () = cancel.cancelled() => {
                debug!("harness super-agent bridge: cancelled, dropping session");
                break;
            }
            maybe = events.recv() => {
                let Some(evt) = maybe else {
                    debug!("harness super-agent bridge: driver channel closed");
                    break;
                };
                // Broadcast errors only happen when there are zero
                // receivers left; that means the SSE client went away
                // and persistence already finished, so dropping is
                // safe.
                if broadcast_tx.send(evt).is_err() {
                    debug!("harness super-agent bridge: no receivers, exiting");
                    break;
                }
            }
        }
    }
}

async fn cancel_existing_run(state: &AppState, session_key: &str) {
    let mut runs = state.super_agent_runs.lock().await;
    if let Some(existing) = runs.remove(session_key) {
        existing.cancel.cancel();
        if let Some(join) = existing.join {
            join.abort();
        }
    }
}

async fn register_run(
    state: &AppState,
    session_key: &str,
    cancel_token: &CancellationToken,
) -> u64 {
    let mut runs = state.super_agent_runs.lock().await;
    let next_gen = runs.get(session_key).map(|r| r.generation + 1).unwrap_or(1);
    if let Some(existing) = runs.insert(
        session_key.to_string(),
        SuperAgentRun {
            generation: next_gen,
            cancel: cancel_token.clone(),
            join: None,
        },
    ) {
        existing.cancel.cancel();
        if let Some(join) = existing.join {
            join.abort();
        }
    }
    next_gen
}

async fn unregister_run(state: &AppState, session_key: &str, generation: u64) {
    let mut runs = state.super_agent_runs.lock().await;
    if runs
        .get(session_key)
        .map(|r| r.generation == generation)
        .unwrap_or(false)
    {
        runs.remove(session_key);
    }
}

fn build_driver(
    _state: &AppState,
    model_override: Option<String>,
) -> HarnessSuperAgentDriver {
    let client = HarnessClient::from_env();
    let server_base = std::env::var("AURA_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:4001".to_string());
    let mut config = HarnessSuperAgentConfig::new(server_base);
    if let Some(m) = model_override {
        config = config.with_model(m);
    }
    HarnessSuperAgentDriver::new(client, config)
}

#[allow(clippy::too_many_arguments)]
fn build_session_init(
    driver: &HarnessSuperAgentDriver,
    profile: &SuperAgentProfile,
    org_name: &str,
    org_id: &str,
    jwt: &str,
    model: Option<String>,
    conversation_history: Option<Vec<aura_protocol::ConversationMessage>>,
    aura_agent_id: String,
    aura_session_id: Option<String>,
) -> SessionInit {
    let server_base = driver_server_base(driver);
    let mut init = aura_os_super_agent::harness_handoff::build_super_agent_session_init(
        profile,
        org_name,
        org_id,
        &server_base,
        jwt,
        model,
    );
    init.conversation_messages = conversation_history;
    init.aura_agent_id = Some(aura_agent_id);
    init.aura_session_id = aura_session_id;
    init
}

fn driver_server_base(_driver: &HarnessSuperAgentDriver) -> String {
    // The driver does not yet expose its config publicly; re-read
    // the same env fallback `build_driver` used so both stays in
    // sync. Swap for a `driver.server_base_url()` accessor when the
    // driver grows one.
    std::env::var("AURA_SERVER_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:4001".to_string())
}

fn model_for_init(_agent: &Agent) -> Option<String> {
    // Agent records do not currently carry a model override; defer to
    // whatever the harness picks. The handler accepts a caller-level
    // `model_override` via `HarnessSuperAgentTurn::model_override`
    // which is applied upstream in `build_driver`.
    None
}

fn forward_driver_error(tx: &broadcast::Sender<HarnessOutbound>, err: HarnessSuperAgentError) {
    use aura_protocol::ErrorMsg;
    warn!(error = %err, "super agent: harness driver failed to start");
    let msg = match err {
        HarnessSuperAgentError::InitRejected { code, message } => ErrorMsg {
            code,
            message,
            recoverable: false,
        },
        other => ErrorMsg {
            code: "harness_start_failed".into(),
            message: other.to_string(),
            recoverable: false,
        },
    };
    if let Err(send_err) = tx.send(HarnessOutbound::Error(msg)) {
        error!(error = ?send_err, "super agent: no subscribers to receive driver error");
    }
}

fn attachments_as_chat(
    protocol: &Option<Vec<ProtocolAttachment>>,
) -> Option<Vec<crate::dto::ChatAttachmentDto>> {
    protocol.as_ref().map(|atts| {
        atts.iter()
            .map(|a| crate::dto::ChatAttachmentDto {
                type_: a.type_.clone(),
                media_type: a.media_type.clone(),
                data: a.data.clone(),
                name: a.name.clone(),
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{Agent, AgentId};

    fn mk_agent(tags: &[&str]) -> Agent {
        let now = chrono::Utc::now();
        Agent {
            agent_id: AgentId::new(),
            user_id: String::new(),
            org_id: None,
            name: "test".into(),
            role: "super_agent".into(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: Vec::new(),
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: String::new(),
            auth_source: String::new(),
            integration_id: None,
            default_model: None,
            vm_id: None,
            network_agent_id: None,
            profile_id: None,
            tags: tags.iter().map(|s| (*s).to_string()).collect(),
            is_pinned: false,
            listing_status: Default::default(),
            expertise: Vec::new(),
            jobs: 0,
            revenue_usd: 0.0,
            reputation: 0.0,
            local_workspace_path: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn default_host_mode_is_in_process() {
        std::env::remove_var(HOST_MODE_ENV);
        let agent = mk_agent(&[]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::InProcess);
    }

    #[test]
    fn host_tag_opts_into_harness() {
        std::env::remove_var(HOST_MODE_ENV);
        let agent = mk_agent(&[HARNESS_HOST_TAG]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::Harness);
    }

    #[test]
    fn host_tag_is_case_insensitive() {
        std::env::remove_var(HOST_MODE_ENV);
        let agent = mk_agent(&["HOST_MODE:HARNESS"]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::Harness);
    }

    // Phase-6 routing parity: legacy super-agent record with the
    // Phase-4 `host_mode:harness` tag must flip to the harness route,
    // while one carrying the explicit `host_mode:in_process` operator
    // override must stay on the legacy path — even though both records
    // also carry the `super_agent` tag.
    #[test]
    fn phase6_harness_tag_wins_over_legacy_super_agent() {
        std::env::remove_var(HOST_MODE_ENV);
        let agent = mk_agent(&["super_agent", HARNESS_HOST_TAG]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::Harness);
    }

    #[test]
    fn phase6_in_process_pin_stays_on_legacy_path() {
        std::env::remove_var(HOST_MODE_ENV);
        let agent = mk_agent(&["super_agent", "host_mode:in_process"]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::InProcess);
    }

    // Env-var tests are racy under cargo test's thread pool because
    // `std::env::set_var` is process-global. We keep them serialized
    // by using a guard; if cargo ever starts running these in
    // parallel with other env-reading tests the guard will at least
    // scope the mutation.
    #[test]
    fn env_override_flips_to_harness() {
        let _guard = env_lock();
        std::env::set_var(HOST_MODE_ENV, "harness");
        let agent = mk_agent(&[]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::Harness);
        std::env::remove_var(HOST_MODE_ENV);
    }

    #[test]
    fn env_override_other_value_stays_in_process() {
        let _guard = env_lock();
        std::env::set_var(HOST_MODE_ENV, "cloud");
        let agent = mk_agent(&[]);
        assert_eq!(host_mode_for_agent(&agent), HostMode::InProcess);
        std::env::remove_var(HOST_MODE_ENV);
    }

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        use std::sync::{Mutex, OnceLock};
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|p| p.into_inner())
    }

    #[tokio::test]
    async fn bridge_forwards_events_until_channel_closes() {
        use aura_protocol::{AssistantMessageEnd, FilesChanged, SessionReady, SessionUsage};

        let (tx_mpsc, rx_mpsc) = mpsc::channel::<OutboundMessage>(4);
        let (tx_bcast, mut rx_bcast) = broadcast::channel::<HarnessOutbound>(16);
        let cancel = CancellationToken::new();

        let bridge = tokio::spawn(bridge_events_to_broadcast(rx_mpsc, tx_bcast, cancel));

        tx_mpsc
            .send(OutboundMessage::SessionReady(SessionReady {
                session_id: "s1".into(),
                tools: Vec::new(),
                skills: Vec::new(),
            }))
            .await
            .unwrap();
        tx_mpsc
            .send(OutboundMessage::AssistantMessageEnd(AssistantMessageEnd {
                message_id: "m1".into(),
                stop_reason: "end_turn".into(),
                usage: SessionUsage::default(),
                files_changed: FilesChanged::default(),
                originating_user_id: None,
            }))
            .await
            .unwrap();
        drop(tx_mpsc);

        bridge.await.unwrap();

        let first = rx_bcast.recv().await.unwrap();
        assert!(matches!(first, HarnessOutbound::SessionReady(_)));
        let second = rx_bcast.recv().await.unwrap();
        assert!(matches!(second, HarnessOutbound::AssistantMessageEnd(_)));
        // Channel should be closed now.
        assert!(rx_bcast.recv().await.is_err());
    }

    #[tokio::test]
    async fn bridge_exits_promptly_on_cancel() {
        use tokio::time::{timeout, Duration};

        let (tx_mpsc, rx_mpsc) = mpsc::channel::<OutboundMessage>(4);
        let (tx_bcast, _rx_bcast) = broadcast::channel::<HarnessOutbound>(16);
        let cancel = CancellationToken::new();
        let cancel_for_bridge = cancel.clone();

        let bridge = tokio::spawn(bridge_events_to_broadcast(
            rx_mpsc,
            tx_bcast,
            cancel_for_bridge,
        ));

        cancel.cancel();

        timeout(Duration::from_millis(500), bridge)
            .await
            .expect("bridge must exit on cancel")
            .unwrap();
        // Sender end still valid — we never dropped it — so without
        // cancel the bridge would hang on recv(). That we did exit
        // proves cancel is honored.
        drop(tx_mpsc);
    }
}
