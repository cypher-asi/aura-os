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
    client_command_id: Option<&str>,
) -> Result<aura_os_storage::StorageSessionEvent, aura_os_storage::StorageError> {
    let payload = build_user_message_payload(
        content,
        attachments,
        ctx.from_agent_id.as_deref(),
        client_command_id,
    );
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

/// Recover image attachments from a persisted `user_message` when an
/// explicitly resumed command does not re-upload them from the client.
/// The original event is already authenticated and session-scoped, so this
/// is only a shape conversion; malformed blocks are ignored and the caller
/// can safely resume the text-only portion.
pub(crate) fn attachments_from_persisted_user_event(
    event: &aura_os_storage::StorageSessionEvent,
) -> Option<Vec<ChatAttachmentDto>> {
    let blocks = event.content.as_ref()?.get("content_blocks")?.as_array()?;
    let attachments: Vec<_> = blocks
        .iter()
        .filter_map(|block| {
            if block.get("type")?.as_str()? != "image" {
                return None;
            }
            Some(ChatAttachmentDto {
                type_: "image".to_string(),
                media_type: block.get("media_type")?.as_str()?.to_string(),
                data: block.get("data")?.as_str()?.to_string(),
                name: None,
                source_url: block
                    .get("source_url")
                    .and_then(|value| value.as_str())
                    .map(ToString::to_string),
            })
        })
        .collect();
    (!attachments.is_empty()).then_some(attachments)
}

fn build_user_message_payload(
    content: &str,
    attachments: &Option<Vec<ChatAttachmentDto>>,
    from_agent_id: Option<&str>,
    client_command_id: Option<&str>,
) -> serde_json::Value {
    let content_blocks: Option<serde_json::Value> = attachments.as_ref().and_then(|atts| {
        let image_blocks: Vec<serde_json::Value> = atts
            .iter()
            .filter(|a| a.type_ == "image")
            .map(|a| {
                // The model turn still receives the original inline data. Only
                // the storage snapshot uses the durable upload reference:
                // five individually valid images can exceed storage's 2 MiB
                // JSON body limit after base64 expansion. Keep inline fallback
                // when there is no usable URL; never silently drop the image.
                let source_url = a.source_url.as_deref().filter(|url| {
                    url::Url::parse(url).is_ok_and(|parsed| {
                        matches!(parsed.scheme(), "https" | "http") && parsed.host_str().is_some()
                    })
                });
                let mut block = serde_json::json!({
                    "type": "image",
                    "media_type": a.media_type,
                    "data": if source_url.is_some() { "" } else { &a.data },
                });
                if let Some(url) = source_url {
                    block["source_url"] = serde_json::Value::String(url.to_string());
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
    if let Some(command_id) = client_command_id.map(str::trim).filter(|s| !s.is_empty()) {
        payload["client_command_id"] = serde_json::Value::String(command_id.to_string());
    }
    payload
}

fn log_user_message_persist_failure(ctx: &ChatPersistCtx, err: &aura_os_storage::StorageError) {
    let (error, upstream_status, body_preview) = match err {
        aura_os_storage::StorageError::Server { status, body } => {
            let preview = body.chars().take(400).collect::<String>();
            (
                format!("aura-storage returned {status}"),
                Some(*status),
                preview,
            )
        }
        _ => (err.to_string(), None, String::new()),
    };
    error!(
        error = %error,
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
    use super::attachments_from_persisted_user_event;
    use super::build_user_message_payload;
    use super::{persist_user_message, ChatAttachmentDto, ChatPersistCtx};

    fn image(data: &str, source_url: Option<&str>) -> ChatAttachmentDto {
        ChatAttachmentDto {
            type_: "image".into(),
            media_type: "image/jpeg".into(),
            data: data.into(),
            name: Some("photo.jpg".into()),
            source_url: source_url.map(str::to_string),
        }
    }

    #[test]
    fn uploaded_images_persist_references_without_changing_model_payload() {
        let attachments = Some(vec![image(
            "aW1hZ2U=",
            Some("https://cdn.example/photo.jpg"),
        )]);
        let payload = build_user_message_payload("inspect", &attachments, None, Some("turn-1"));
        assert_eq!(payload["content_blocks"][1]["data"], "");
        assert_eq!(
            payload["content_blocks"][1]["source_url"],
            "https://cdn.example/photo.jpg"
        );
        assert_eq!(payload["client_command_id"], "turn-1");
        // Persistence must not mutate the DTO that is sent to the harness.
        assert_eq!(
            attachments.as_ref().map(|atts| atts[0].data.as_str()),
            Some("aW1hZ2U=")
        );
    }

    #[test]
    fn inline_fallback_is_preserved_without_a_usable_upload_url() {
        for source in [
            None,
            Some(""),
            Some(" "),
            Some("not-a-url"),
            Some("data:image/png;base64,AAAA"),
        ] {
            let payload =
                build_user_message_payload("", &Some(vec![image("aW1hZ2U=", source)]), None, None);
            assert_eq!(payload["content_blocks"][0]["data"], "aW1hZ2U=");
            assert!(payload["content_blocks"][0].get("source_url").is_none());
        }
    }

    #[tokio::test]
    async fn two_five_photo_batches_persist_and_resume_under_real_json_body_limit() {
        use aura_os_storage::{CreateSessionEventRequest, StorageClient};
        use std::sync::Arc;
        use tower::ServiceExt;

        // Axum's mock-storage JSON extractor enforces the same 2 MiB limit
        // as production storage. The previous tiny image mocks never crossed it.
        let (storage_url, db) = aura_os_storage::testutil::start_mock_storage().await;
        let ctx = ChatPersistCtx {
            storage: Arc::new(StorageClient::with_base_url(&storage_url)),
            jwt: "test-token".into(),
            user_id: Some("owner".into()),
            session_id: aura_os_core::SessionId::new(),
            project_agent_id: "project-agent".into(),
            project_id: "project".into(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        };
        // Each photo is within the browser's 1,100,000-byte image threshold,
        // but its encoded form and five-photo aggregate exceed 2 MiB.
        let data = "A".repeat(1_466_668);
        let mut all_urls = Vec::new();
        for batch in 0..2 {
            let attachments = Some(
                (0..5)
                    .map(|index| {
                        let url = format!("https://cdn.example/batch-{batch}/photo-{index}.jpg");
                        all_urls.push(url.clone());
                        image(&data, Some(&url))
                    })
                    .collect(),
            );
            let event = persist_user_message(
                &ctx,
                "Research these photos",
                &attachments,
                Some(&format!("batch-{batch}")),
            )
            .await
            .expect("uploaded five-image batch must persist");
            assert!(serde_json::to_vec(&event).unwrap().len() < 4096);
            let resumed = attachments_from_persisted_user_event(&event).expect("resume references");
            assert_eq!(resumed.len(), 5);
            for (index, attachment) in resumed.iter().enumerate() {
                assert!(attachment.data.is_empty());
                assert_eq!(
                    attachment.source_url.as_deref(),
                    Some(all_urls[batch * 5 + index].as_str())
                );
            }
            let history = crate::handlers::agents::conversions::events_to_session_history(
                &[event],
                &ctx.project_agent_id,
                &ctx.project_id,
            );
            assert_eq!(history[0].content_blocks.as_ref().unwrap().len(), 6);
            let replay = crate::handlers::agents::chat::session_events_to_agent_history(&history);
            for (index, block) in replay[0]["content"]
                .as_array()
                .unwrap()
                .iter()
                .skip(1)
                .enumerate()
            {
                assert_eq!(block["source"]["type"], "url");
                assert_eq!(block["source"]["url"], all_urls[batch * 5 + index]);
                assert!(block["source"].get("data").is_none());
            }
        }
        assert_eq!(db.lock().await.events.len(), 2);

        // Reproduce the pre-fix wire payload: uploaded references PLUS all
        // base64 bytes. Drive the router in-process to avoid an early 413
        // closing a large HTTP upload before reqwest finishes writing it.
        let inline = Some((0..5).map(|_| image(&data, None)).collect());
        let mut old_payload =
            build_user_message_payload("Research these photos", &inline, None, None);
        for (index, block) in old_payload["content_blocks"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .skip(1)
            .enumerate()
        {
            block["source_url"] = serde_json::json!(all_urls[index]);
        }
        let old_request = CreateSessionEventRequest {
            session_id: Some(ctx.session_id.to_string()),
            user_id: None,
            agent_id: Some(ctx.project_agent_id.clone()),
            sender: Some("user".into()),
            project_id: Some(ctx.project_id.clone()),
            org_id: None,
            event_type: "user_message".into(),
            content: Some(old_payload),
        };
        let old_body = serde_json::to_vec(&old_request).unwrap();
        assert!(old_body.len() > 7_000_000);
        let response = aura_os_storage::testutil::mock_storage_router(db.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri(format!("/api/sessions/{}/events", ctx.session_id))
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(old_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            db.lock().await.events.len(),
            2,
            "failed write must not look persisted"
        );
    }

    #[test]
    fn build_user_message_payload_omits_from_agent_id_when_none() {
        let payload = build_user_message_payload("hello", &None, None, None);
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
        let payload = build_user_message_payload("hi", &None, Some("   "), None);
        assert!(
            payload.get("from_agent_id").is_none(),
            "blank from_agent_id must be elided, not stored as \"\""
        );
    }

    #[test]
    fn build_user_message_payload_emits_from_agent_id_when_set() {
        let payload = build_user_message_payload("hello back", &None, Some("barret-uuid"), None);
        assert_eq!(
            payload.get("from_agent_id").and_then(|v| v.as_str()),
            Some("barret-uuid"),
            "cross-agent injected user_messages must carry the sender's \
             agent_id so the chat panel can label the row"
        );
        assert_eq!(payload["text"], "hello back");
    }

    #[test]
    fn build_user_message_payload_emits_client_command_id_when_set() {
        let payload = build_user_message_payload("ship it", &None, None, Some("mobile-123"));
        assert_eq!(
            payload.get("client_command_id").and_then(|v| v.as_str()),
            Some("mobile-123")
        );
    }

    #[test]
    fn resume_recovers_only_valid_persisted_image_blocks() {
        let event = aura_os_storage::StorageSessionEvent {
            id: "event-1".into(),
            session_id: None,
            user_id: None,
            agent_id: None,
            sender: None,
            project_id: None,
            org_id: None,
            event_type: Some("user_message".into()),
            content: Some(serde_json::json!({
                "text": "inspect",
                "content_blocks": [
                    {"type":"text","text":"inspect"},
                    {"type":"image","media_type":"image/png","data":"pixels","source_url":"https://cdn/image.png"},
                    {"type":"image","media_type":"image/jpeg"}
                ]
            })),
            created_at: None,
        };
        let attachments = attachments_from_persisted_user_event(&event).unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].media_type, "image/png");
        assert_eq!(attachments[0].data, "pixels");
        assert_eq!(
            attachments[0].source_url.as_deref(),
            Some("https://cdn/image.png")
        );
    }
}
