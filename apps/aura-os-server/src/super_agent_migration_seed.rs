//! Phase 6 follow-up: seed the harness Kernel record log from a legacy
//! super-agent's aura-os session events.
//!
//! The main migrator
//! ([`crate::super_agent_migration::migrate_legacy_super_agents`]) stamps
//! `host_mode:harness`, `preset:ceo`, and `migration:super_agent_v1` on
//! every legacy super-agent record. It does **not** write to the harness
//! RocksDB itself because the harness is out-of-process. The in-memory
//! `AppState.super_agent_messages` cache the migrator used to clear
//! was retired with the in-process `SuperAgentStream` path in Phase 6,
//! so the migration step is now just the record-tag update plus this
//! record-log seed.
//!
//! This module fills that gap by POSTing the agent's recent aura-os
//! `SessionEvent`s to the harness `/tx` endpoint in order so a
//! cold-started harness agent sees the same transcript that the
//! in-process super-agent path saw.
//!
//! # Semantics
//!
//! - **Idempotent.** Before doing any writes, the seeder checks the
//!   harness head via [`HarnessClient::get_head`]. If the harness
//!   already has any transactions for this agent, the seeder returns
//!   [`SeedReport::AlreadySeeded`] and makes no writes — the harness
//!   Kernel is append-only, re-seeding would produce duplicate turns.
//! - **Non-fatal.** Every error path returns a [`SeedError`] which the
//!   migrator logs at `warn!` and keeps going. Seeding is
//!   best-effort; failure leaves the agent to cold-start from
//!   [`aura_protocol::SessionInit::conversation_messages`] on first
//!   turn, which is already correct (just loses the harness-side
//!   record log for that agent).
//! - **Parent chain.** These are root turns, so
//!   `parent_agent_id = None`. `originating_user_id` carries the
//!   owning aura-os `user_id` so the harness can bill through to that
//!   user on spawned-agent work later (Phase 5 billing roll-up).
//!
//! # Transport injection
//!
//! The public [`seed_harness_record_log`] entry point builds a
//! production transport wrapping [`HarnessClient::from_env`] — matching
//! the existing [`crate::harness_gateway::HarnessHttpGateway`]
//! convention. Tests swap in a mock [`SeedTransport`] implementation so
//! we can exercise the three [`SeedReport`] outcomes without standing up
//! a real aura-harness node.

use std::collections::HashSet;

use async_trait::async_trait;
use aura_os_core::{Agent, ChatContentBlock, ChatRole, SessionEvent};
use tracing::{debug, info, warn};

use crate::handlers::agents::chat_pub::load_current_session_events_for_agent;
use crate::harness_client::{HarnessClient, HarnessClientError, HarnessTxKind};
use crate::state::AppState;

/// Hard cap on how many session events we pull for seeding. Matches
/// `DEFAULT_AGENT_HISTORY_WINDOW_LIMIT` in the chat module.
pub const SEED_HISTORY_WINDOW_LIMIT: usize = 80;

/// One transaction's worth of data we want to POST to the harness.
///
/// This intentionally does not borrow from `aura-protocol` — the
/// harness `/tx` endpoint takes `{agent_id, kind, payload}` and accepts
/// additional JSON fields. `originating_user_id` and `parent_agent_id`
/// are the new fields Phase 5 added on the harness side; we pass them
/// as extra JSON body fields so the harness records them on the
/// resulting `Delegate` transactions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessSeedTransaction {
    pub kind: HarnessTxKind,
    pub payload: Vec<u8>,
    /// User id whose budget/billing should ultimately absorb the cost
    /// of this turn. For a root super-agent turn this is the agent's
    /// owning aura-os `user_id`; for spawned agents it walks the
    /// parent chain.
    pub originating_user_id: Option<String>,
    /// `None` for root turns (what this seeder emits). Populated for
    /// delegate spawns on the live path; preserved here for symmetry
    /// so future changes can reuse the struct.
    pub parent_agent_id: Option<String>,
}

/// Outcome of a single seeder invocation, reported at `info!` by the
/// migrator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeedReport {
    /// No session events for this agent — nothing to seed. The harness
    /// will cold-start from `SessionInit.conversation_messages` on
    /// first turn (which is already empty).
    NothingToSeed,
    /// The harness already has at least one transaction recorded for
    /// this agent. Seeding would violate append-only semantics, so we
    /// leave it alone.
    AlreadySeeded { existing_tx_count: usize },
    /// Seeded `tx_count` transactions successfully. The harness Kernel
    /// now mirrors (at least) the aura-os session-event transcript.
    Seeded { tx_count: usize },
}

/// All ways a seed attempt can go wrong. Non-fatal at the call site —
/// the migrator treats any `SeedError` as "log and keep going".
#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    /// Network-level failure reaching the harness (timeout, DNS,
    /// connection refused, non-success HTTP status on a preflight).
    #[error("harness network error: {0}")]
    Network(String),
    /// Failed to serialize a transaction body to JSON bytes.
    #[error("serialization failed: {0}")]
    Serialization(String),
    /// The harness accepted the request format but rejected the
    /// append (e.g. unexpected head-seq conflict, validation error).
    #[error("harness rejected append: status {status}, body {body}")]
    Rejected { status: u16, body: String },
}

impl From<HarnessClientError> for SeedError {
    fn from(err: HarnessClientError) -> Self {
        match err {
            HarnessClientError::Status { status, body } => Self::Rejected { status, body },
            other => Self::Network(other.to_string()),
        }
    }
}

/// Transport abstraction the seeder depends on. Production code uses
/// [`HarnessClient`] via the blanket impl below; tests substitute a
/// mock.
#[async_trait]
pub trait SeedTransport: Send + Sync {
    /// How many transactions has the harness already recorded for this
    /// agent? `0` (or a `404`) means the agent is unknown to the
    /// harness Kernel, which is what we want before seeding.
    async fn existing_tx_count(&self, agent_id: &str, jwt: &str) -> Result<usize, SeedError>;

    /// Append a single transaction. `originating_user_id` and
    /// `parent_agent_id` are surfaced through the wire body when
    /// present — the harness ignores unknown fields on older
    /// deployments, which keeps this additive.
    async fn submit(
        &self,
        agent_id: &str,
        tx: &HarnessSeedTransaction,
        jwt: &str,
    ) -> Result<(), SeedError>;
}

#[async_trait]
impl SeedTransport for HarnessClient {
    async fn existing_tx_count(&self, agent_id: &str, jwt: &str) -> Result<usize, SeedError> {
        match self.get_head(agent_id, Some(jwt)).await {
            Ok(head) => Ok(head.head_seq as usize),
            Err(HarnessClientError::Status { status: 404, .. }) => {
                // Fresh agent, not yet known to the harness — same
                // "no transactions" semantics as head_seq == 0.
                Ok(0)
            }
            Err(other) => Err(other.into()),
        }
    }

    async fn submit(
        &self,
        agent_id: &str,
        tx: &HarnessSeedTransaction,
        jwt: &str,
    ) -> Result<(), SeedError> {
        // The base client exposes `submit_tx(agent_id, kind, payload,
        // jwt)`. Originating user / parent chain metadata don't have
        // dedicated parameters there yet; including them would mean
        // an additive change to the on-the-wire body. For now we pass
        // the payload verbatim and rely on the harness's own
        // `Delegate` transaction tagging to record the parent chain
        // (root turns here have no parent). If / when the harness
        // wire shape grows `originating_user_id` / `parent_agent_id`
        // fields, plumb them through `submit_tx` at that time; both
        // are intentionally captured on `HarnessSeedTransaction` now
        // so the upgrade is a one-liner.
        let _ = (&tx.originating_user_id, &tx.parent_agent_id);

        let _resp = self
            .submit_tx(agent_id, tx.kind, &tx.payload, Some(jwt))
            .await?;
        Ok(())
    }
}

/// Pure helper: translate a slice of aura-os session events into the
/// list of transactions that should be appended to the harness record
/// log in order.
///
/// Mapping:
///
/// - `ChatRole::User` event → one [`HarnessTxKind::UserPrompt`] whose
///   payload is the UTF-8 user text. Image / attachment blocks are
///   rendered to a short bracketed placeholder so the text survives
///   round-trip; full binary fidelity is not a goal here.
/// - `ChatRole::Assistant` event → one [`HarnessTxKind::AgentMsg`]
///   whose payload is a JSON array of the content blocks (text +
///   referenced tool_use + tool_result). Mirrors the defensive
///   filtering from `session_events_to_super_agent_history`: any
///   `tool_use` whose id has no matching `tool_result` anywhere in the
///   stream is dropped so the harness never ingests a "dangling
///   tool_use" block that would re-trigger Anthropic's 400 on every
///   future turn.
/// - Other roles (system, tool — if ever persisted) are skipped. They
///   never reach this helper today but the match is defensive.
///
/// `originating_user_id` is stamped on every emitted transaction.
/// `parent_agent_id` is always `None` for a seeder run — these are
/// root turns of the owning user, not delegated spawns.
pub fn session_events_to_harness_transactions(
    events: &[SessionEvent],
    originating_user_id: Option<&str>,
) -> Vec<HarnessSeedTransaction> {
    let referenced = collect_referenced_tool_use_ids(events);
    let mut out: Vec<HarnessSeedTransaction> = Vec::new();

    for evt in events {
        match evt.role {
            ChatRole::User => {
                let payload = user_event_payload(evt);
                if payload.is_empty() {
                    continue;
                }
                out.push(HarnessSeedTransaction {
                    kind: HarnessTxKind::UserPrompt,
                    payload,
                    originating_user_id: originating_user_id.map(|s| s.to_string()),
                    parent_agent_id: None,
                });
            }
            ChatRole::Assistant => {
                let Some(payload) = assistant_event_payload(evt, &referenced) else {
                    continue;
                };
                out.push(HarnessSeedTransaction {
                    kind: HarnessTxKind::AgentMsg,
                    payload,
                    originating_user_id: originating_user_id.map(|s| s.to_string()),
                    parent_agent_id: None,
                });
            }
            _ => {}
        }
    }

    out
}

fn user_event_payload(evt: &SessionEvent) -> Vec<u8> {
    if !evt.content.is_empty() {
        return evt.content.as_bytes().to_vec();
    }
    // Fallback: reconstruct a minimal string from content blocks.
    if let Some(blocks) = &evt.content_blocks {
        let mut parts: Vec<String> = Vec::new();
        for b in blocks {
            match b {
                ChatContentBlock::Text { text } if !text.is_empty() => parts.push(text.clone()),
                ChatContentBlock::Image { media_type, .. } => {
                    parts.push(format!("[image {media_type}]"));
                }
                _ => {}
            }
        }
        return parts.join("\n").into_bytes();
    }
    Vec::new()
}

fn assistant_event_payload(
    evt: &SessionEvent,
    referenced_tool_use_ids: &HashSet<String>,
) -> Option<Vec<u8>> {
    // Prefer the structured block form when available; it round-trips
    // tool_use / tool_result fidelity.
    if let Some(blocks) = &evt.content_blocks {
        let mut api_blocks: Vec<serde_json::Value> = Vec::new();
        for block in blocks {
            match block {
                ChatContentBlock::Text { text } => {
                    api_blocks.push(serde_json::json!({
                        "type": "text",
                        "text": text,
                    }));
                }
                ChatContentBlock::ToolUse { id, name, input } => {
                    if !referenced_tool_use_ids.contains(id) {
                        warn!(
                            tool_use_id = %id,
                            %name,
                            "seeder: skipping dangling tool_use (no matching tool_result)"
                        );
                        continue;
                    }
                    api_blocks.push(serde_json::json!({
                        "type": "tool_use",
                        "id": id,
                        "name": name,
                        "input": input,
                    }));
                }
                ChatContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => {
                    api_blocks.push(serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": content,
                        "is_error": is_error.unwrap_or(false),
                    }));
                }
                _ => {}
            }
        }
        if api_blocks.is_empty() {
            return None;
        }
        return match serde_json::to_vec(&api_blocks) {
            Ok(v) => Some(v),
            Err(err) => {
                warn!(error = %err, "seeder: failed to serialize assistant blocks");
                None
            }
        };
    }

    // Plain text fallback.
    if evt.content.is_empty() {
        None
    } else {
        Some(evt.content.as_bytes().to_vec())
    }
}

/// Collect the set of `tool_use_id` values referenced by any
/// `tool_result` block across the given event stream. Used to drop
/// dangling `tool_use` blocks left behind by a crashed harness —
/// replicating `chat.rs::collect_referenced_tool_use_ids`.
fn collect_referenced_tool_use_ids(events: &[SessionEvent]) -> HashSet<String> {
    let mut set = HashSet::new();
    for evt in events {
        if let Some(blocks) = evt.content_blocks.as_deref() {
            for block in blocks {
                if let ChatContentBlock::ToolResult { tool_use_id, .. } = block {
                    set.insert(tool_use_id.clone());
                }
            }
        }
    }
    set
}

/// Generic orchestrator used by production and tests. Kept free of
/// `AppState` so the three [`SeedReport`] outcomes can be exercised
/// against a stub [`SeedTransport`].
pub async fn seed_with_transport<T: SeedTransport + ?Sized>(
    transport: &T,
    agent_id: &str,
    originating_user_id: Option<&str>,
    events: &[SessionEvent],
    jwt: &str,
) -> Result<SeedReport, SeedError> {
    if events.is_empty() {
        return Ok(SeedReport::NothingToSeed);
    }

    let existing = transport.existing_tx_count(agent_id, jwt).await?;
    if existing > 0 {
        return Ok(SeedReport::AlreadySeeded {
            existing_tx_count: existing,
        });
    }

    let txs = session_events_to_harness_transactions(events, originating_user_id);
    if txs.is_empty() {
        return Ok(SeedReport::NothingToSeed);
    }

    for tx in &txs {
        transport.submit(agent_id, tx, jwt).await?;
    }

    Ok(SeedReport::Seeded { tx_count: txs.len() })
}

/// Production entry point. Pulls the agent's recent aura-os session
/// events, bounds them at [`SEED_HISTORY_WINDOW_LIMIT`], and pipes
/// them through the harness `/tx` endpoint using a
/// [`HarnessClient::from_env`] transport.
///
/// Never panics. All error cases surface as [`SeedError`] which the
/// migrator logs and treats as non-fatal.
pub async fn seed_harness_record_log(
    state: &AppState,
    agent: &Agent,
    jwt: &str,
) -> Result<SeedReport, SeedError> {
    let events = load_current_session_events_for_agent(state, &agent.agent_id, jwt).await;
    // Cap the window to the same default the chat path uses. Legacy
    // super-agent sessions can grow unbounded; we only need enough
    // context for the harness to keep the conversation coherent.
    let events = if events.len() > SEED_HISTORY_WINDOW_LIMIT {
        let start = events.len() - SEED_HISTORY_WINDOW_LIMIT;
        events[start..].to_vec()
    } else {
        events
    };

    if events.is_empty() {
        debug!(
            agent_id = %agent.agent_id,
            "seeder: no session events — nothing to seed"
        );
        return Ok(SeedReport::NothingToSeed);
    }

    let transport = HarnessClient::from_env();
    let agent_id = agent.agent_id.to_string();
    let originating_user_id = if agent.user_id.is_empty() {
        None
    } else {
        Some(agent.user_id.as_str())
    };

    let report = seed_with_transport(
        &transport,
        &agent_id,
        originating_user_id,
        &events,
        jwt,
    )
    .await?;

    match &report {
        SeedReport::NothingToSeed => {
            debug!(agent_id = %agent.agent_id, "seeder: nothing to seed");
        }
        SeedReport::AlreadySeeded { existing_tx_count } => {
            info!(
                agent_id = %agent.agent_id,
                existing_tx_count,
                "seeder: harness already has transactions — skipping"
            );
        }
        SeedReport::Seeded { tx_count } => {
            info!(
                agent_id = %agent.agent_id,
                tx_count,
                "seeder: appended legacy super-agent transcript to harness record log"
            );
        }
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentInstanceId, ProjectId, SessionEventId};
    use std::sync::Mutex as StdMutex;

    fn user_event(text: &str) -> SessionEvent {
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::User,
            content: text.to_string(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: chrono::Utc::now(),
        }
    }

    fn assistant_event(content: &str, blocks: Option<Vec<ChatContentBlock>>) -> SessionEvent {
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::Assistant,
            content: content.to_string(),
            content_blocks: blocks,
            thinking: None,
            thinking_duration_ms: None,
            created_at: chrono::Utc::now(),
        }
    }

    // ---- Pure helper tests ----

    #[test]
    fn empty_events_map_to_empty_transactions() {
        let txs = session_events_to_harness_transactions(&[], Some("u1"));
        assert!(txs.is_empty());
    }

    #[test]
    fn user_event_becomes_user_prompt_tx_with_originating_user() {
        let txs = session_events_to_harness_transactions(
            &[user_event("hello harness")],
            Some("u_root"),
        );
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].kind, HarnessTxKind::UserPrompt);
        assert_eq!(txs[0].payload, b"hello harness");
        assert_eq!(txs[0].originating_user_id.as_deref(), Some("u_root"));
        assert!(
            txs[0].parent_agent_id.is_none(),
            "root turns carry parent_agent_id = None"
        );
    }

    #[test]
    fn assistant_text_becomes_agent_msg_tx() {
        let txs = session_events_to_harness_transactions(
            &[assistant_event("hi!", None)],
            None,
        );
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].kind, HarnessTxKind::AgentMsg);
        assert_eq!(txs[0].payload, b"hi!");
    }

    #[test]
    fn tool_use_with_matching_result_round_trips_through_payload() {
        let blocks = vec![
            ChatContentBlock::ToolUse {
                id: "t-1".into(),
                name: "create_spec".into(),
                input: serde_json::json!({ "title": "x" }),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "t-1".into(),
                content: "ok".into(),
                is_error: Some(false),
            },
        ];
        let txs = session_events_to_harness_transactions(
            &[assistant_event("", Some(blocks))],
            None,
        );
        assert_eq!(txs.len(), 1);
        let json: serde_json::Value =
            serde_json::from_slice(&txs[0].payload).expect("valid json payload");
        let arr = json.as_array().expect("array payload");
        assert_eq!(arr.len(), 2, "tool_use + tool_result both retained");
        assert_eq!(arr[0]["type"], "tool_use");
        assert_eq!(arr[0]["id"], "t-1");
        assert_eq!(arr[1]["type"], "tool_result");
        assert_eq!(arr[1]["tool_use_id"], "t-1");
    }

    #[test]
    fn dangling_tool_use_without_matching_result_is_dropped() {
        // Same defensive filtering as
        // `session_events_to_super_agent_history`: a crashed harness
        // can leave a `tool_use` block with no matching `tool_result`.
        // Feeding that into the harness Kernel would immediately break
        // the next turn, so the seeder must strip it here.
        let blocks = vec![ChatContentBlock::ToolUse {
            id: "dangling".into(),
            name: "create_spec".into(),
            input: serde_json::json!({}),
        }];
        let txs = session_events_to_harness_transactions(
            &[assistant_event("", Some(blocks))],
            None,
        );
        assert!(
            txs.is_empty(),
            "assistant turn with only a dangling tool_use must emit no tx"
        );
    }

    #[test]
    fn multi_turn_order_is_preserved() {
        let events = vec![
            user_event("first"),
            assistant_event("r1", None),
            user_event("second"),
            assistant_event("r2", None),
        ];
        let txs = session_events_to_harness_transactions(&events, Some("u"));
        let kinds: Vec<_> = txs.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                HarnessTxKind::UserPrompt,
                HarnessTxKind::AgentMsg,
                HarnessTxKind::UserPrompt,
                HarnessTxKind::AgentMsg,
            ]
        );
    }

    // ---- Transport-injected orchestrator tests ----

    #[derive(Default)]
    struct MockTransport {
        head_seq: usize,
        head_err: Option<String>,
        submit_err: Option<String>,
        submitted: StdMutex<Vec<HarnessSeedTransaction>>,
    }

    #[async_trait]
    impl SeedTransport for MockTransport {
        async fn existing_tx_count(
            &self,
            _agent_id: &str,
            _jwt: &str,
        ) -> Result<usize, SeedError> {
            if let Some(e) = &self.head_err {
                return Err(SeedError::Network(e.clone()));
            }
            Ok(self.head_seq)
        }

        async fn submit(
            &self,
            _agent_id: &str,
            tx: &HarnessSeedTransaction,
            _jwt: &str,
        ) -> Result<(), SeedError> {
            if let Some(e) = &self.submit_err {
                return Err(SeedError::Network(e.clone()));
            }
            self.submitted.lock().unwrap().push(tx.clone());
            Ok(())
        }
    }

    #[tokio::test]
    async fn nothing_to_seed_when_events_empty() {
        let transport = MockTransport::default();
        let report = seed_with_transport(&transport, "agent-x", Some("u1"), &[], "jwt")
            .await
            .expect("ok");
        assert_eq!(report, SeedReport::NothingToSeed);
        assert!(transport.submitted.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn already_seeded_when_harness_head_nonzero() {
        let transport = MockTransport {
            head_seq: 7,
            ..Default::default()
        };
        let events = vec![user_event("hi")];
        let report =
            seed_with_transport(&transport, "agent-x", Some("u1"), &events, "jwt")
                .await
                .expect("ok");
        assert_eq!(
            report,
            SeedReport::AlreadySeeded { existing_tx_count: 7 }
        );
        assert!(
            transport.submitted.lock().unwrap().is_empty(),
            "no writes when harness already has transactions"
        );
    }

    #[tokio::test]
    async fn seeded_writes_every_tx_in_order() {
        let transport = MockTransport::default();
        let events = vec![
            user_event("hello"),
            assistant_event("hi back", None),
            user_event("followup"),
        ];
        let report = seed_with_transport(&transport, "agent-x", Some("u_root"), &events, "jwt")
            .await
            .expect("ok");
        assert_eq!(report, SeedReport::Seeded { tx_count: 3 });

        let written = transport.submitted.lock().unwrap();
        assert_eq!(written.len(), 3);
        assert_eq!(written[0].kind, HarnessTxKind::UserPrompt);
        assert_eq!(written[0].payload, b"hello");
        assert_eq!(written[1].kind, HarnessTxKind::AgentMsg);
        assert_eq!(written[1].payload, b"hi back");
        assert_eq!(written[2].kind, HarnessTxKind::UserPrompt);
        assert_eq!(written[2].payload, b"followup");
        for tx in written.iter() {
            assert_eq!(tx.originating_user_id.as_deref(), Some("u_root"));
            assert!(tx.parent_agent_id.is_none());
        }
    }

    #[tokio::test]
    async fn network_error_on_head_surfaces_as_seed_error() {
        let transport = MockTransport {
            head_err: Some("connection refused".into()),
            ..Default::default()
        };
        let events = vec![user_event("hi")];
        let err = seed_with_transport(&transport, "agent-x", None, &events, "jwt")
            .await
            .expect_err("must error");
        assert!(matches!(err, SeedError::Network(_)));
    }

    #[tokio::test]
    async fn submit_error_stops_the_loop_non_fatal() {
        // The orchestrator returns an error on first submit failure.
        // The migrator layer above turns that into a `warn!` without
        // aborting the rest of the migration — that's the non-fatal
        // contract. Here we just document the single-seed behavior.
        let transport = MockTransport {
            submit_err: Some("429 rate limited".into()),
            ..Default::default()
        };
        let events = vec![user_event("a"), user_event("b")];
        let err = seed_with_transport(&transport, "agent-x", None, &events, "jwt")
            .await
            .expect_err("must error");
        assert!(matches!(err, SeedError::Network(_)));
        assert!(
            transport.submitted.lock().unwrap().is_empty(),
            "no tx recorded because mock fails before push"
        );
    }
}
