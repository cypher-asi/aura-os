//! Chat persistence context and the lowest-level write paths used by the
//! chat handler: session resolution, retiring stale sessions, and writing
//! the inbound user message.

use std::sync::Arc;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionId};
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use chrono::Utc;
use tracing::{error, info, warn};

use crate::dto::ChatAttachmentDto;

use super::discovery::storage_session_sort_key;

/// Carries the previous-vs-new session id pair when
/// `resolve_chat_session_with_pin` detected a context-pressure
/// auto-fork (or fell back to the
/// `context_usage_estimate >= threshold` rule when the persist task's
/// `rolled_over` flag never landed). Surfaces through the chat
/// `OpenChatStreamArgs` into `build_sse_stream`, which prepends a
/// single `progress: forked_for_context` SSE event before the usual
/// `connecting` / `queued` prefix so the chat panel can swap
/// `?session=<old>` → `?session=<new>` and show a one-shot soft
/// banner without the user having to click `+`.
///
/// Both ids are typed [`SessionId`]s in memory — the
/// `progress: forked_for_context` SSE payload stringifies them at
/// the emit site so the wire shape (`previous_session_id` /
/// `new_session_id` strings) stays byte-identical.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ForkInfo {
    pub(crate) previous_session_id: SessionId,
    pub(crate) new_session_id: SessionId,
}

/// Output of `resolve_chat_session_with_pin`. The new shape carries
/// the resolved `session_id` PLUS the optional [`ForkInfo`] that
/// `build_sse_stream` needs to emit the `progress: forked_for_context`
/// event. Returning a tuple instead of widening `Option<SessionId>`
/// keeps the migration mechanical at the call sites and avoids hiding
/// the fork signal inside an unrelated wrapper.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ResolvedChatSession {
    pub(crate) session_id: SessionId,
    pub(crate) fork: Option<ForkInfo>,
}

#[derive(Clone)]
pub(crate) struct ChatPersistCtx {
    pub(crate) storage: Arc<StorageClient>,
    pub(crate) jwt: String,
    /// Resolved storage session id this chat turn is being persisted
    /// into. Strongly typed as [`SessionId`] in memory; the
    /// `aura_os_storage` JSON layer still wants `String`, so callers
    /// stringify at the boundary (see e.g.
    /// [`persist_user_message`] / [`persist_task::persist_event`]).
    pub(crate) session_id: SessionId,
    pub(crate) project_agent_id: String,
    pub(crate) project_id: String,
    /// Org-level agent id (the `agents.agent_id` from aura-network)
    /// this persistence context belongs to. Distinct from
    /// `project_agent_id` (the project binding). We broadcast it in
    /// `user_message` / `assistant_message_end` so the UI can key
    /// standalone-chat history entries by the same id the sidebar
    /// uses (`agentHistoryKey(agent_id)`); without it cross-agent
    /// `send_to_agent` deliveries only refresh the sender's view and
    /// the recipient's chat window stays stale until the user hits F5.
    pub(crate) agent_id: Option<String>,
    /// Set by `send_to_agent` in aura-harness when agent A messages
    /// agent B (sourced from
    /// [`crate::dto::SendChatRequest::originating_agent_id`]). Phase 3
    /// of the cross-agent reply plan reads this from `persist_task`
    /// on `AssistantMessageEnd` and posts B's reply back into A's
    /// session as a follow-up `user_message`, so the sender's chat
    /// surfaces the response without a manual refresh. Cross-repo
    /// contract documented in
    /// `c:\code\aura-harness\crates\aura-runtime\src\session\cross_agent_hook.rs::deliver_message`.
    pub(crate) originating_agent_id: Option<String>,
    /// Cross-agent reply chain depth. Sourced from the inbound
    /// `X-Aura-Cross-Agent-Depth` header (Phase 3) by the chat route
    /// handlers and threaded onto the persist ctx so
    /// [`super::cross_agent_reply::spawn_cross_agent_reply_callback`]
    /// can short-circuit once the chain hits
    /// [`super::cross_agent_reply::MAX_CROSS_AGENT_REPLY_DEPTH`]. Each
    /// server-issued reply POST stamps `depth + 1` on the outbound
    /// header so the receiving turn sees the incremented value on its
    /// `ChatPersistCtx`. Defaults to `0` when the header is missing
    /// (legacy harness, direct user chat, etc.) — see
    /// [`super::cross_agent_reply::read_cross_agent_depth`] for the
    /// parsing rules.
    pub(crate) cross_agent_depth: u32,
    /// Org-level `agents.agent_id` UUID of the *agent* that injected
    /// this turn on behalf of cross-agent communication, when the
    /// inbound `SendChatRequest` carried `from_agent_id`. Sourced
    /// from [`crate::dto::SendChatRequest::from_agent_id`] in
    /// [`super::setup`] and read by [`persist_user_message`] /
    /// [`build_user_message_payload`] so the persisted
    /// `user_message` content carries the provenance, plus by
    /// [`super::event_bus::publish_chat_event`] so the WS event
    /// the chat panel listens to also carries it. The chat-row
    /// renderer keys on this to badge cross-agent messages
    /// "↩ from <agent_name>" instead of styling them
    /// indistinguishably from a real human prompt — without this
    /// field, the originating agent's UI silently re-renders
    /// Barret's reply as a duplicate user message above the real
    /// prompt. Distinct from `originating_agent_id`, which exists
    /// for routing the next async reply back; `from_agent_id`
    /// exists for display-side provenance.
    pub(crate) from_agent_id: Option<String>,
}

/// Build the harness partition string for a chat route, folding in
/// `persist.session_id` as the third segment so the registry, turn
/// slot, and `SessionInit.agent_id` are all per-storage-session. See
/// [`aura_os_core::harness_agent_id`] for the partition shape and
/// `PARALLEL_SESSIONS.md` for why both chat routes share this builder.
///
/// Tier 3 cleanup: `ChatPersistCtx::session_id` is now a typed
/// [`SessionId`], so the helper no longer parses a `String` back to
/// `SessionId` on every call — the parse happened once at the
/// resolver and the typed value has been carried through to here.
pub(super) fn build_chat_partition(
    template: &AgentId,
    instance: Option<&AgentInstanceId>,
    persist: Option<&ChatPersistCtx>,
) -> String {
    aura_os_core::harness_agent_id(template, instance, persist.map(|c| &c.session_id))
}

/// Outcome of attempting to validate a caller-supplied
/// `pinned_session_id` against the agent's session list. The mismatch
/// arm carries enough detail for the handler to return a structured
/// 400 instead of a generic 500.
///
/// `Matched` carries a typed [`SessionId`] (Tier 3 cleanup); the
/// `Mismatch.session_id` deliberately stays `String` because it is
/// the caller-supplied stringified id we report back in the 400, and
/// matches whatever wire shape the caller sent us regardless of
/// whether it parses as a UUID.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PinnedSessionOutcome {
    /// No pin requested — fall through to the legacy resolution path.
    NotRequested,
    /// Pin matched a session that belongs to this agent — use as-is.
    Matched(SessionId),
    /// Pin pointed at a session that does not belong to this agent.
    Mismatch { session_id: String },
}

/// Validate that `pinned_session_id` belongs to the project agent
/// before we wire it into persistence. Returning a structured result
/// (vs. silently falling back to the latest session) lets callers
/// surface a 400 to the UI and avoids scribbling messages from one
/// session into another.
pub(crate) async fn try_pin_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    pinned_session_id: Option<&SessionId>,
) -> PinnedSessionOutcome {
    let Some(pinned) = pinned_session_id else {
        return PinnedSessionOutcome::NotRequested;
    };
    // Stringify once at the storage boundary; the in-memory id stays
    // typed for downstream consumers.
    let pinned_str = pinned.to_string();
    match storage.list_sessions(project_agent_id, jwt).await {
        Ok(sessions) => {
            if sessions.iter().any(|s| s.id == pinned_str) {
                PinnedSessionOutcome::Matched(*pinned)
            } else {
                PinnedSessionOutcome::Mismatch {
                    session_id: pinned_str,
                }
            }
        }
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions while validating pinned session_id; treating as mismatch"
            );
            PinnedSessionOutcome::Mismatch {
                session_id: pinned_str,
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn resolve_chat_session_with_pin(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    force_new: bool,
    pinned_session_id: Option<&SessionId>,
    session_service: &SessionService,
    auto_fork_threshold: f64,
) -> Option<ResolvedChatSession> {
    let candidate = pick_candidate_session(
        storage,
        jwt,
        project_agent_id,
        project_id,
        force_new,
        pinned_session_id,
    )
    .await?;
    // Phase 3 auto-fork: if the candidate session already crossed the
    // context-pressure threshold (either because the persist task
    // flagged it `rolled_over` after the previous turn, or because the
    // persisted `context_usage_estimate` is past the auto-fork mark),
    // mint a fresh session here and route the user message into it.
    // Forking happens NOW (before this user's turn opens) so the
    // harness session config sees the new `aura_session_id` and the
    // SSE stream can emit `progress: forked_for_context` to update
    // `?session=` in the URL.
    match maybe_auto_fork_chat_session(
        storage,
        jwt,
        project_agent_id,
        project_id,
        &candidate,
        session_service,
        auto_fork_threshold,
    )
    .await
    {
        Some(fork) => Some(ResolvedChatSession {
            session_id: fork.new_session_id,
            fork: Some(fork),
        }),
        None => Some(ResolvedChatSession {
            session_id: candidate,
            fork: None,
        }),
    }
}

async fn pick_candidate_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    force_new: bool,
    pinned_session_id: Option<&SessionId>,
) -> Option<SessionId> {
    // `force_new` wins over `pinned_session_id`: callers that
    // explicitly want a brand-new session (the chat-input "+" button)
    // shouldn't accidentally land in an old session because their
    // URL still has `?session=...`.
    if !force_new {
        if let Some(pinned) = pinned_session_id {
            // Trust the pin if it survived `try_pin_session` upstream;
            // re-validating here would double the round-trip on
            // every turn. Callers (the chat handlers) validate up
            // front and 400 on mismatch before reaching here.
            return Some(*pinned);
        }
        if let Some(existing) = existing_session_for_agent(storage, jwt, project_agent_id).await {
            return Some(existing);
        }
    }
    close_active_sessions_for_agent(storage, jwt, project_agent_id).await;
    create_new_chat_session(storage, jwt, project_agent_id, project_id).await
}

/// Inspect the candidate storage session and, if it qualifies for an
/// auto-fork (status `rolled_over` set by the persist task, or
/// `context_usage_estimate` past the configured threshold as a
/// fallback when the summary write failed), mint a fresh session via
/// [`SessionService::create_chat_followup_session`] carrying the
/// previous summary forward.
///
/// Returns `None` when no fork is needed or when minting the new
/// session fails — in the latter case the caller falls back to the
/// candidate so the chat at least lands somewhere instead of erroring
/// the user out of their conversation.
async fn maybe_auto_fork_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
    candidate_session_id: &SessionId,
    session_service: &SessionService,
    auto_fork_threshold: f64,
) -> Option<ForkInfo> {
    // Stringify once at the storage boundary; the rest of this
    // function works with the typed id.
    let candidate_id_str = candidate_session_id.to_string();
    let candidate = match storage.get_session(&candidate_id_str, jwt).await {
        Ok(s) => s,
        Err(error) => {
            warn!(
                session_id = %candidate_session_id,
                %error,
                "auto-fork check: failed to load candidate session; skipping fork"
            );
            return None;
        }
    };

    let is_rolled_over = candidate.status.as_deref() == Some("rolled_over");
    let usage_over_threshold = candidate
        .context_usage_estimate
        .map(|usage| usage >= auto_fork_threshold)
        .unwrap_or(false);
    if !is_rolled_over && !usage_over_threshold {
        return None;
    }

    let parsed_project_id = match project_id.parse::<ProjectId>() {
        Ok(p) => p,
        Err(error) => {
            warn!(
                %project_id,
                %error,
                "auto-fork check: project_id is not a valid UUID; skipping fork"
            );
            return None;
        }
    };

    let summary = lookup_rollover_summary(storage, jwt, &candidate_id_str).await;
    let summary = if summary.trim().is_empty() {
        // Fallback path: the persist task failed to write the summary
        // event (or this is the `usage_over_threshold` branch where the
        // `rolled_over` flag never landed). Carry forward a static
        // label so the fresh session at least signals continuity to
        // the user.
        "Continued from a long conversation (no summary available).".to_string()
    } else {
        summary
    };

    match session_service
        .create_chat_followup_session(
            &parsed_project_id,
            project_agent_id,
            candidate_session_id,
            summary,
            candidate.model.clone(),
        )
        .await
    {
        Ok(new_session_id) => {
            info!(
                previous_session_id = %candidate_session_id,
                new_session_id = %new_session_id,
                project_agent_id = %project_agent_id,
                trigger = if is_rolled_over { "rolled_over_flag" } else { "usage_estimate" },
                "Auto-forked chat session at context pressure"
            );
            Some(ForkInfo {
                previous_session_id: *candidate_session_id,
                new_session_id,
            })
        }
        Err(error) => {
            warn!(
                session_id = %candidate_session_id,
                %error,
                "Auto-fork: create_chat_followup_session failed; staying on the candidate session"
            );
            None
        }
    }
}

/// Pull the most recent `rollover_summary` event for `session_id` and
/// extract its `summary` text. Returns the empty string when nothing
/// usable was found (the caller substitutes a static fallback). The
/// chat persist task writes one of these events per auto-fork-trigger
/// turn; reading them here lets the next user send carry the
/// conversation summary forward without re-running the LLM call.
async fn lookup_rollover_summary(storage: &StorageClient, jwt: &str, session_id: &str) -> String {
    let events = match storage.list_events(session_id, jwt, None, None).await {
        Ok(events) => events,
        Err(error) => {
            warn!(
                %session_id,
                %error,
                "auto-fork: list_events failed while looking up rollover_summary"
            );
            return String::new();
        }
    };
    events
        .iter()
        .rev()
        .filter(|evt| evt.event_type.as_deref() == Some("rollover_summary"))
        .find_map(|evt| {
            evt.content
                .as_ref()
                .and_then(|c| c.get("summary"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default()
}

async fn existing_session_for_agent(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
) -> Option<SessionId> {
    match storage.list_sessions(project_agent_id, jwt).await {
        Ok(sessions) => {
            // Sort by the same recency key the reader uses so a writer
            // never lands in a different session than
            // `load_project_session_history` will later read from.
            // Storage may return sessions in any order (insertion,
            // alphanumeric id, etc.); we want newest-by-timestamp first.
            //
            // Previously we also walked the sorted list and issued a
            // `list_events(limit=1)` probe on each candidate to skip
            // "stale" sessions. That added one round-trip per session
            // on the hot path — for users with long chat histories
            // this was the single slowest setup step. Trust the sort
            // key instead: if the newest session by timestamp is
            // structurally unreadable the very next persist will
            // surface the error, and the UI loader applies the same
            // sort key so writer/reader can't diverge.
            let latest = sessions
                .iter()
                .max_by_key(|s| storage_session_sort_key(s))?;
            parse_storage_session_id(&latest.id, project_agent_id)
        }
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions for chat resolution"
            );
            None
        }
    }
}

async fn create_new_chat_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    project_id: &str,
) -> Option<SessionId> {
    let req = aura_os_storage::CreateSessionRequest {
        project_id: project_id.to_string(),
        org_id: None,
        model: None,
        status: Some("active".to_string()),
        context_usage_estimate: None,
        summary_of_previous_context: None,
    };
    match storage.create_session(project_agent_id, jwt, &req).await {
        Ok(session) => parse_storage_session_id(&session.id, project_agent_id),
        Err(e) => {
            error!(error = %e, %project_agent_id, "Failed to create chat session in storage");
            None
        }
    }
}

/// Parse a storage-returned session id into the typed [`SessionId`]
/// at the producer side of the chat persist pipeline. Storage
/// session ids are UUIDs in production; any non-UUID would have to
/// have been written by a bug or an external tool, and we'd rather
/// degrade to "no resolved session" (the chat path's existing
/// soft-fail mode) than carry a poison value through every consumer
/// downstream. The warn! makes the regression visible on the
/// first turn rather than at some downstream point that no longer
/// has the original id in scope.
fn parse_storage_session_id(raw: &str, project_agent_id: &str) -> Option<SessionId> {
    match raw.parse::<SessionId>() {
        Ok(id) => Some(id),
        Err(error) => {
            warn!(
                session_id = %raw,
                %project_agent_id,
                %error,
                "storage returned a non-UUID session id; treating as unresolved \
                 (chat will fall through to the unresolved-session error path)"
            );
            None
        }
    }
}

/// Flip any lingering `active` sessions for this agent instance to
/// `completed` so the sidekick does not render historical sessions as
/// spinning/in-progress. Failures are logged and swallowed: retiring old
/// sessions is best-effort and must never block creation of a new one.
pub(super) async fn close_active_sessions_for_agent(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
) {
    let sessions = match storage.list_sessions(project_agent_id, jwt).await {
        Ok(list) => list,
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions while retiring stale active sessions"
            );
            return;
        }
    };

    let now = Utc::now().to_rfc3339();
    for session in sessions {
        if session.status.as_deref() != Some("active") {
            continue;
        }
        let req = aura_os_storage::UpdateSessionRequest {
            status: Some("completed".to_string()),
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
            summary_of_previous_context: None,
            tasks_worked_count: None,
            ended_at: Some(now.clone()),
        };
        if let Err(e) = storage.update_session(&session.id, jwt, &req).await {
            warn!(session_id = %session.id, error = %e, "Failed to retire stale active session");
        }
    }
}

/// Persist the inbound user message to storage and return the created
/// event on success.
///
/// Previously this fire-and-forget spawned a background task that only
/// logged failures, which let the CEO's `send_to_agent` tool report
/// `persisted: true` for writes that silently vanished from the target
/// agent's chat history. Callers are now required to `.await` this
/// function and hard-fail the request on `Err` — no silent success.
pub(crate) async fn persist_user_message(
    ctx: &ChatPersistCtx,
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
) -> Result<aura_os_storage::StorageSessionEvent, aura_os_storage::StorageError> {
    let payload =
        build_user_message_payload(content, attachments, ctx.from_agent_id.as_deref());
    // Stringify the typed `SessionId` once at this storage boundary;
    // `aura_os_storage` keeps `String` on the wire deliberately.
    let session_id_str = ctx.session_id.to_string();
    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id_str.clone()),
        user_id: None,
        agent_id: Some(ctx.project_agent_id.clone()),
        sender: Some("user".to_string()),
        project_id: Some(ctx.project_id.clone()),
        org_id: None,
        event_type: "user_message".to_string(),
        content: Some(payload),
    };
    match ctx
        .storage
        .create_event(&session_id_str, &ctx.jwt, &req)
        .await
    {
        Ok(evt) => Ok(evt),
        Err(e) => {
            log_user_message_persist_failure(ctx, &e);
            Err(e)
        }
    }
}

fn build_user_message_payload(
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
    from_agent_id: Option<&str>,
) -> serde_json::Value {
    let content_blocks: Option<serde_json::Value> = attachments.as_ref().and_then(|atts| {
        let image_blocks: Vec<serde_json::Value> = atts
            .iter()
            .filter(|a| a.type_ == "image")
            .map(|a| {
                let mut block = serde_json::json!({
                    "type": "image",
                    "media_type": a.media_type,
                    "data": a.data,
                });
                if let Some(ref url) = a.source_url {
                    block["source_url"] = serde_json::Value::String(url.clone());
                }
                block
            })
            .collect();
        if image_blocks.is_empty() {
            None
        } else {
            let mut blocks = Vec::new();
            if !content.is_empty() {
                blocks.push(serde_json::json!({ "type": "text", "text": content }));
            }
            blocks.extend(image_blocks);
            Some(serde_json::Value::Array(blocks))
        }
    });

    let mut payload = serde_json::json!({ "text": content });
    if let Some(blocks) = content_blocks {
        payload["content_blocks"] = blocks;
    }
    // Cross-agent provenance: when this user_message was injected by
    // another agent (rather than typed by the human), embed the
    // sender's UUID into the persisted content so
    // `parse_user_message_event` can surface it on `SessionEvent`
    // and the chat panel can label the row "↩ from <agent>"
    // instead of styling it as a normal user prompt. Blank ids are
    // dropped so a stray empty string never enables the badge UI.
    if let Some(from) = from_agent_id.map(str::trim).filter(|s| !s.is_empty()) {
        payload["from_agent_id"] = serde_json::Value::String(from.to_string());
    }
    payload
}

#[cfg(test)]
mod build_user_message_payload_tests {
    //! Pin the persisted-content shape for the new
    //! `from_agent_id` provenance field. The frontend's
    //! `parse_user_message_event` and the chat-row renderer both
    //! key on the exact JSON key name, so any rename breaks the
    //! "↩ from <agent>" badge silently — assert the on-disk
    //! shape rather than the in-memory `ChatPersistCtx` field.
    use super::build_user_message_payload;

    #[test]
    fn build_user_message_payload_omits_from_agent_id_when_none() {
        let payload = build_user_message_payload("hello", &None, None);
        assert_eq!(payload["text"], "hello");
        assert!(
            payload.get("from_agent_id").is_none(),
            "regular user prompts must not include from_agent_id; \
             a stray field would force the badge UI on every typed turn"
        );
    }

    #[test]
    fn build_user_message_payload_omits_from_agent_id_when_blank() {
        // Whitespace-only ids must be normalized to absent so a buggy
        // upstream caller cannot accidentally trip the badge UI.
        let payload = build_user_message_payload("hi", &None, Some("   "));
        assert!(
            payload.get("from_agent_id").is_none(),
            "blank from_agent_id must be elided, not stored as \"\""
        );
    }

    #[test]
    fn build_user_message_payload_emits_from_agent_id_when_set() {
        let payload =
            build_user_message_payload("hello back", &None, Some("barret-uuid"));
        assert_eq!(
            payload.get("from_agent_id").and_then(|v| v.as_str()),
            Some("barret-uuid"),
            "cross-agent injected user_messages must carry the sender's \
             agent_id so the chat panel can label the row"
        );
        assert_eq!(payload["text"], "hello back");
    }
}

fn log_user_message_persist_failure(ctx: &ChatPersistCtx, err: &aura_os_storage::StorageError) {
    let (upstream_status, body_preview) = match err {
        aura_os_storage::StorageError::Server { status, body } => {
            (Some(*status), body.chars().take(400).collect::<String>())
        }
        _ => (None, String::new()),
    };
    error!(
        error = %err,
        upstream_status = ?upstream_status,
        body_preview = %body_preview,
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        project_id = %ctx.project_id,
        "Failed to persist user message event"
    );
}

#[cfg(test)]
mod pin_tests {
    //! Pin down the contract for `try_pin_session` and
    //! `resolve_chat_session_with_pin`. Both functions guard the chat
    //! handler against routing a turn into the wrong session when the
    //! UI's `?session=` query param disagrees with storage. These
    //! tests use the in-memory mock storage so we don't need to pay
    //! the cost of a real backend.

    use std::sync::Arc;

    use aura_os_core::SessionId;
    use aura_os_sessions::SessionService;
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{CreateSessionRequest, StorageClient};

    use super::{resolve_chat_session_with_pin, try_pin_session, PinnedSessionOutcome};

    /// Build a minimal `SessionService` wired to the same mock storage
    /// the rest of these tests use, so `resolve_chat_session_with_pin`
    /// can route through the auto-fork check without reaching for a
    /// real aura-storage backend.
    fn test_session_service(storage: Arc<StorageClient>) -> SessionService {
        let tmp = tempfile::TempDir::new().expect("temp dir for SettingsStore");
        let store = Arc::new(
            aura_os_store::SettingsStore::open(tmp.path())
                .expect("SettingsStore should open in temp dir"),
        );
        // Leak the temp dir so the SettingsStore stays alive for the
        // lifetime of the test process; mirrors what `fixture` does for
        // the storage `_db` handle below.
        std::mem::forget(tmp);
        SessionService::new(store, 0.8, 200_000).with_storage_client(Some(storage))
    }

    /// Helper: spin up the mock storage and create one session for
    /// `agent_id` so the tests have a real session id to pin. Returns
    /// the typed [`SessionId`] (the mock storage hands back a UUID by
    /// construction, so the parse always succeeds in tests).
    async fn fixture(agent_id: &str) -> (StorageClient, SessionId) {
        let (url, _db) = start_mock_storage().await;
        let storage = StorageClient::with_base_url(&url);
        let session = storage
            .create_session(
                agent_id,
                "jwt",
                &CreateSessionRequest {
                    project_id: "project-x".to_string(),
                    org_id: None,
                    model: None,
                    status: Some("active".to_string()),
                    context_usage_estimate: None,
                    summary_of_previous_context: None,
                },
            )
            .await
            .expect("mock storage create_session");
        // Leak the temp DB so it lives for the whole test — the
        // returned client only needs the URL to keep talking to it.
        // The mock handle going out of scope here is fine because the
        // server task holds the DB alive for the test process.
        std::mem::forget(_db);
        let sid: SessionId = session
            .id
            .parse()
            .expect("mock storage must return a parseable UUID");
        (storage, sid)
    }

    #[tokio::test]
    async fn try_pin_session_returns_not_requested_when_input_is_none() {
        let (storage, _sid) = fixture("agent-a").await;
        let outcome = try_pin_session(&storage, "jwt", "agent-a", None).await;
        assert_eq!(outcome, PinnedSessionOutcome::NotRequested);
    }

    #[tokio::test]
    async fn try_pin_session_matches_when_session_belongs_to_agent() {
        let (storage, sid) = fixture("agent-b").await;
        let outcome = try_pin_session(&storage, "jwt", "agent-b", Some(&sid)).await;
        assert_eq!(outcome, PinnedSessionOutcome::Matched(sid));
    }

    #[tokio::test]
    async fn try_pin_session_mismatches_when_session_id_is_unknown() {
        let (storage, _sid) = fixture("agent-c").await;
        // Use a freshly-minted UUID that storage does not know about;
        // the mock will list zero matches and return Mismatch.
        let phantom = SessionId::new();
        let outcome = try_pin_session(&storage, "jwt", "agent-c", Some(&phantom)).await;
        assert_eq!(
            outcome,
            PinnedSessionOutcome::Mismatch {
                session_id: phantom.to_string(),
            }
        );
    }

    #[tokio::test]
    async fn resolve_with_pin_uses_pinned_id_without_round_trip() {
        // When `pinned_session_id` is `Some`, the resolver trusts the
        // upstream `try_pin_session` validation and returns the pin
        // verbatim — even if the agent has other sessions. With the
        // Phase 3 auto-fork hook in place the pinned session is still
        // run through `maybe_auto_fork_chat_session`; the mock storage
        // returns `status="active"` and a 0.0 usage estimate so the
        // fork branch is a no-op and the resolved id matches the pin.
        let (storage, sid) = fixture("agent-d").await;
        let storage_arc = Arc::new(storage);
        let svc = test_session_service(storage_arc.clone());
        let result = resolve_chat_session_with_pin(
            storage_arc.as_ref(),
            "jwt",
            "agent-d",
            "project-x",
            false,
            Some(&sid),
            &svc,
            0.8,
        )
        .await
        .expect("resolver should yield a session");
        assert_eq!(result.session_id, sid);
        assert!(
            result.fork.is_none(),
            "pinned session below the threshold must not auto-fork"
        );
    }

    #[tokio::test]
    async fn resolve_force_new_overrides_pin() {
        // `force_new=true` (the chat input "+" button) wins over the
        // URL pin: the resolver creates a fresh session even when a
        // pin is supplied. Otherwise the user would land in the old
        // session because their URL still has `?session=`.
        let (storage, sid) = fixture("agent-e").await;
        let storage_arc = Arc::new(storage);
        let svc = test_session_service(storage_arc.clone());
        let result = resolve_chat_session_with_pin(
            storage_arc.as_ref(),
            "jwt",
            "agent-e",
            "project-x",
            true,
            Some(&sid),
            &svc,
            0.8,
        )
        .await
        .expect("resolver should create a new session");
        assert_ne!(
            result.session_id, sid,
            "force_new must beat the pin and yield a different session id"
        );
        assert!(
            result.fork.is_none(),
            "force_new without rollover state must not surface a fork event"
        );
    }
}
