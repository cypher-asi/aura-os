//! Background ChatGPT-style title task: kicks off in parallel with
//! the assistant turn and pushes the result onto the WS event bus
//! when this is the first user message in a fresh session.

use tokio::sync::broadcast;
use tracing::{info, warn};

use super::super::event_bus::publish_session_summary_updated_event;
use super::super::persist::ChatPersistCtx;

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
pub(super) fn spawn_session_title_task(
    http: reqwest::Client,
    router_url: String,
    event_bus: broadcast::Sender<serde_json::Value>,
    ctx: ChatPersistCtx,
    user_content: String,
) {
    tokio::spawn(async move {
        let storage = ctx.storage.clone();
        // Stringify the typed session id once; every storage / router
        // call inside this task wants `&str`.
        let session_id_str = ctx.session_id.to_string();

        // Guard 1: respect rolled-over summary from session_service.
        match storage.get_session(&session_id_str, &ctx.jwt).await {
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
            .list_events(&session_id_str, &ctx.jwt, None, None)
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
            &session_id_str,
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
