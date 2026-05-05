//! Chat-history persistence for image-mode generation streams.
//!
//! `POST /api/generate/image/stream` opens a synthetic harness session
//! that talks directly to the upstream provider and never touches the
//! agent's chat-session row. Without this module the UI's synthesized
//! `generate_image` tool turn (built client-side from the
//! `GenerationCompleted` SSE event) lives only in the in-memory zustand
//! stream store and disappears on hard reload.
//!
//! When the request carries either an `agent_id` (standalone agent
//! chat) or a `project_id` + `agent_instance_id` pair (project chat),
//! we resolve the same `ChatPersistCtx` the regular chat route uses and
//! persist the turn as a normal `user_message` + `assistant_message_end`
//! row pair. The assistant row carries `content_blocks` shaped
//! identically to what the chat-agent emits when it calls the
//! `generate_image` tool itself, so the existing `ImageBlock` renderer
//! consumes either origin without UI changes.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_harness::HarnessOutbound;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::dto::ChatAttachmentDto;
use crate::handlers::agents::chat::{
    persist_event, persist_user_message, publish_assistant_message_end_event,
    publish_user_message_event, setup_agent_chat_persistence, setup_project_chat_persistence,
    ChatPersistCtx,
};
use crate::state::AppState;

/// Metadata used to round-trip the request shape into the persisted
/// `tool_use` block, so cold history hydration produces the same
/// `ToolCallEntry` the in-flight stream synthesized.
#[derive(Clone)]
pub(super) struct GenerationPersistMeta {
    pub(super) prompt: String,
    pub(super) model: Option<String>,
    pub(super) size: Option<String>,
    pub(super) tool_name: &'static str,
}

/// Try to resolve a chat-session persistence context for an image-mode
/// generation request. Returns `None` when the caller did not thread
/// any chat scope through (legacy clients, non-chat callers like the
/// AURA 3D app), or when storage / discovery fails — image generation
/// MUST still succeed in those cases, we just skip durable persistence.
pub(super) async fn resolve_persist_ctx(
    state: &AppState,
    jwt: &str,
    agent_id: Option<&str>,
    project_id: Option<&str>,
    agent_instance_id: Option<&str>,
) -> Option<ChatPersistCtx> {
    if let (Some(project_id), Some(agent_instance_id)) = (project_id, agent_instance_id) {
        let parsed_project = project_id.parse::<ProjectId>().ok();
        let parsed_instance = agent_instance_id.parse::<AgentInstanceId>().ok();
        if let (Some(parsed_project), Some(parsed_instance)) = (parsed_project, parsed_instance) {
            if let Some(ctx) = setup_project_chat_persistence(
                state,
                &parsed_project,
                &parsed_instance,
                jwt,
                false,
            )
            .await
            {
                return Some(ctx);
            }
            warn!(
                %project_id,
                %agent_instance_id,
                "image-mode persist: project chat session not resolvable; turn will not be saved"
            );
        } else {
            warn!(
                %project_id,
                %agent_instance_id,
                "image-mode persist: project_id or agent_instance_id failed to parse; turn will not be saved"
            );
        }
    }
    if let Some(agent_id) = agent_id {
        if let Ok(parsed_agent) = agent_id.parse::<AgentId>() {
            if let Some(ctx) =
                setup_agent_chat_persistence(state, &parsed_agent, "", jwt, false).await
            {
                return Some(ctx);
            }
            warn!(
                %agent_id,
                "image-mode persist: agent chat session not resolvable; turn will not be saved"
            );
        } else {
            warn!(
                %agent_id,
                "image-mode persist: agent_id failed to parse; turn will not be saved"
            );
        }
    }
    None
}

/// Decode the request's `images` field (a list of `data:<media>;base64,<payload>`
/// URLs the chat input collected for image-to-image generation) into the
/// `ChatAttachmentDto` shape `persist_user_message` expects.
fn data_urls_to_attachments(images: Option<&[String]>) -> Option<Vec<ChatAttachmentDto>> {
    let images = images?;
    let attachments: Vec<ChatAttachmentDto> = images
        .iter()
        .filter_map(|url| {
            let after_data = url.strip_prefix("data:")?;
            let (header, data) = after_data.split_once(',')?;
            let media_type = header.split(';').next()?.to_string();
            if media_type.is_empty() {
                return None;
            }
            Some(ChatAttachmentDto {
                type_: "image".to_string(),
                media_type,
                data: data.to_string(),
                name: None,
            })
        })
        .collect();
    if attachments.is_empty() {
        None
    } else {
        Some(attachments)
    }
}

/// Persist the user prompt (plus any reference images) as a
/// `user_message` event, mirroring [`crate::handlers::agents::chat::persist_user_message`]
/// so the row is indistinguishable from a regular chat turn on reload.
/// Failures are logged and swallowed: durable history is best-effort
/// for image mode, never block generation.
pub(super) async fn persist_user_prompt(
    state: &AppState,
    ctx: &ChatPersistCtx,
    prompt: &str,
    images: Option<&[String]>,
) {
    let attachments = data_urls_to_attachments(images);
    match persist_user_message(ctx, prompt, &attachments).await {
        Ok(evt) => {
            publish_user_message_event(&state.event_broadcast, ctx, evt.id.as_str());
            info!(
                session_id = %ctx.session_id,
                event_id = %evt.id,
                "image-mode persist: user prompt saved"
            );
        }
        Err(e) => {
            warn!(
                session_id = %ctx.session_id,
                error = %e,
                "image-mode persist: failed to save user prompt; image will still generate"
            );
        }
    }
}

/// Subscribe to the harness session's outbound channel and write a
/// synthetic `assistant_message_end` row when the terminal
/// `GenerationCompleted` event arrives. Mirrors the shape the regular
/// chat-agent persists when its LLM calls `generate_image` as a tool
/// (a `tool_use` block with the request input + a `tool_result` block
/// whose `content` is the JSON-serialized completion payload), so
/// cold reload renders the image via the same `ImageBlock` path.
pub(super) fn spawn_generation_persist_task(
    rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
    meta: GenerationPersistMeta,
) {
    tokio::spawn(async move {
        run_generation_persist_loop(rx, ctx, event_bus, meta).await;
    });
}

async fn run_generation_persist_loop(
    mut rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
    meta: GenerationPersistMeta,
) {
    loop {
        match rx.recv().await {
            Ok(HarnessOutbound::GenerationCompleted(completed)) => {
                let payload = super::harness_stream::normalize_generation_completed_payload(
                    completed.mode.clone(),
                    completed.payload,
                );
                persist_completion(&ctx, &event_bus, &meta, &payload).await;
                return;
            }
            Ok(
                HarnessOutbound::GenerationError(_)
                | HarnessOutbound::Error(_),
            ) => {
                // Generation failed upstream. The user_message row
                // already exists in storage; we deliberately do not
                // synthesize an empty assistant turn so the UI can
                // surface the failure exactly like a regular chat
                // error (no orphan assistant bubble).
                return;
            }
            Ok(_) => continue,
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                warn!(
                    session_id = %ctx.session_id,
                    skipped,
                    "image-mode persist: harness broadcast lagged"
                );
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => {
                warn!(
                    session_id = %ctx.session_id,
                    "image-mode persist: harness broadcast closed before GenerationCompleted; \
                     user_message remains, no assistant row"
                );
                return;
            }
        }
    }
}

/// Build + write the synthetic `assistant_message_end` row for a
/// completed generation. Pulled out of the spawn body so tests can
/// drive the persistence path against a mock storage client without
/// spawning a tokio task.
pub(super) async fn persist_completion(
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    meta: &GenerationPersistMeta,
    completed_payload: &Value,
) {
    let tool_use_id = format!("gen-{}", uuid::Uuid::new_v4().as_simple());
    let mut input = serde_json::Map::new();
    input.insert("prompt".to_string(), json!(meta.prompt));
    if let Some(model) = meta.model.as_deref() {
        input.insert("model".to_string(), json!(model));
    }
    if let Some(size) = meta.size.as_deref() {
        input.insert("size".to_string(), json!(size));
    }

    let tool_result_content = serde_json::to_string(completed_payload)
        .unwrap_or_else(|_| "{}".to_string());

    let content_blocks = vec![
        json!({
            "type": "tool_use",
            "id": tool_use_id,
            "name": meta.tool_name,
            "input": Value::Object(input),
        }),
        json!({
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": tool_result_content,
            "is_error": false,
        }),
    ];

    let message_id = format!("img-{}", uuid::Uuid::new_v4().as_simple());
    let payload = json!({
        "message_id": message_id,
        "text": "",
        "thinking": Value::Null,
        "content_blocks": content_blocks,
        "usage": Value::Null,
        "files_changed": {
            "created": [],
            "modified": [],
            "deleted": [],
        },
        "stop_reason": "end_turn",
        "seq": 1,
        "synthesized": true,
        "source": "image_mode",
    });

    if persist_event(ctx, "assistant_message_end", payload).await {
        publish_assistant_message_end_event(event_bus, ctx, &message_id);
        info!(
            session_id = %ctx.session_id,
            tool = meta.tool_name,
            "image-mode persist: assistant turn saved"
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::StorageClient;
    use serde_json::json;

    use super::*;

    #[test]
    fn data_urls_to_attachments_decodes_media_type_and_data() {
        let images = vec![
            "data:image/png;base64,iVBORw0KGgo".to_string(),
            "data:image/jpeg;base64,/9j/4AAQ".to_string(),
        ];
        let atts = data_urls_to_attachments(Some(&images)).expect("attachments");
        assert_eq!(atts.len(), 2);
        assert_eq!(atts[0].type_, "image");
        assert_eq!(atts[0].media_type, "image/png");
        assert_eq!(atts[0].data, "iVBORw0KGgo");
        assert_eq!(atts[1].media_type, "image/jpeg");
        assert_eq!(atts[1].data, "/9j/4AAQ");
    }

    #[test]
    fn data_urls_to_attachments_returns_none_for_empty_or_invalid() {
        assert!(data_urls_to_attachments(None).is_none());
        assert!(data_urls_to_attachments(Some(&[])).is_none());
        assert!(data_urls_to_attachments(Some(&["not-a-data-url".to_string()])).is_none());
        // Missing media type still returns None for that entry.
        let invalid = vec!["data:;base64,abc".to_string()];
        assert!(data_urls_to_attachments(Some(&invalid)).is_none());
    }

    /// Pin the on-disk shape of the synthetic `assistant_message_end`
    /// row: cold history hydration must produce the exact same
    /// `tool_use` / `tool_result` content_blocks that the chat-agent
    /// emits when its LLM calls `generate_image` as a tool, so the
    /// existing `ImageBlock` renderer can paint the image without
    /// branching on the persist origin. This test is the regression
    /// gate for the original bug — image-mode results disappearing on
    /// reload because no row was ever saved.
    #[tokio::test]
    async fn persist_completion_writes_assistant_message_end_with_image_tool_blocks() {
        let (url, _db) = start_mock_storage().await;
        let storage = Arc::new(StorageClient::with_base_url(&url));

        // Prime a session row so `create_event` has somewhere to write.
        let project_agent_id = "pa-image-mode".to_string();
        let project_id = "p-image-mode".to_string();
        let session = storage
            .create_session(
                &project_agent_id,
                "jwt",
                &aura_os_storage::CreateSessionRequest {
                    project_id: project_id.clone(),
                    org_id: None,
                    model: None,
                    status: Some("active".to_string()),
                    context_usage_estimate: None,
                    summary_of_previous_context: None,
                },
            )
            .await
            .expect("create_session");

        let ctx = ChatPersistCtx {
            storage: storage.clone(),
            jwt: "jwt".to_string(),
            session_id: session.id.clone(),
            project_agent_id: project_agent_id.clone(),
            project_id: project_id.clone(),
            agent_id: Some("agent-image-mode".to_string()),
        };
        let (event_bus, _rx) = broadcast::channel::<Value>(8);
        let meta = GenerationPersistMeta {
            prompt: "draw a fox".to_string(),
            model: Some("gpt-image-2".to_string()),
            size: Some("1024x1024".to_string()),
            tool_name: "generate_image",
        };
        let completed = json!({
            "mode": "image",
            "imageUrl": "https://cdn.example.com/fox.png",
            "originalUrl": "https://cdn.example.com/fox-orig.png",
            "artifactId": "art-fox",
        });

        persist_completion(&ctx, &event_bus, &meta, &completed).await;

        let events = storage
            .list_events(&session.id, "jwt", None, None)
            .await
            .expect("list_events");
        let assistant_end = events
            .iter()
            .find(|e| e.event_type.as_deref() == Some("assistant_message_end"))
            .expect("assistant_message_end row was written");
        let content = assistant_end
            .content
            .as_ref()
            .expect("assistant_message_end has content");

        // Top-level shape mirrors what the chat-agent persists for a
        // tool-driven turn — including the `synthesized` /
        // `source: image_mode` markers so cold log analysis can tell
        // image-mode rows apart from real LLM tool turns without
        // changing how the UI renders them.
        assert_eq!(content["text"], "");
        assert_eq!(content["stop_reason"], "end_turn");
        assert_eq!(content["synthesized"], true);
        assert_eq!(content["source"], "image_mode");

        let blocks = content["content_blocks"]
            .as_array()
            .expect("content_blocks is an array");
        assert_eq!(blocks.len(), 2);

        let tool_use = &blocks[0];
        assert_eq!(tool_use["type"], "tool_use");
        assert_eq!(tool_use["name"], "generate_image");
        assert_eq!(tool_use["input"]["prompt"], "draw a fox");
        assert_eq!(tool_use["input"]["model"], "gpt-image-2");
        assert_eq!(tool_use["input"]["size"], "1024x1024");
        let tool_use_id = tool_use["id"]
            .as_str()
            .expect("tool_use.id is a string");
        assert!(tool_use_id.starts_with("gen-"));

        let tool_result = &blocks[1];
        assert_eq!(tool_result["type"], "tool_result");
        assert_eq!(tool_result["tool_use_id"], tool_use_id);
        assert_eq!(tool_result["is_error"], false);

        // The result `content` is JSON.stringified completion payload;
        // ImageBlock parses this back out and reads `imageUrl`.
        let parsed_result: Value = serde_json::from_str(
            tool_result["content"]
                .as_str()
                .expect("tool_result.content is a string"),
        )
        .expect("tool_result.content parses as JSON");
        assert_eq!(parsed_result["imageUrl"], "https://cdn.example.com/fox.png");
        assert_eq!(
            parsed_result["originalUrl"],
            "https://cdn.example.com/fox-orig.png"
        );
        assert_eq!(parsed_result["artifactId"], "art-fox");
    }
}
