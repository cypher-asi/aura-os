//! Inbound `user_message` write path: build the persisted payload
//! (with optional cross-agent provenance), POST it to storage, and
//! log a structured failure on the error arm.

use tracing::error;

use crate::dto::ChatAttachmentDto;

use super::context::ChatPersistCtx;

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
    let payload = build_user_message_payload(content, attachments, ctx.from_agent_id.as_deref());
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
        let payload = build_user_message_payload("hello back", &None, Some("barret-uuid"));
        assert_eq!(
            payload.get("from_agent_id").and_then(|v| v.as_str()),
            Some("barret-uuid"),
            "cross-agent injected user_messages must carry the sender's \
             agent_id so the chat panel can label the row"
        );
        assert_eq!(payload["text"], "hello back");
    }
}
