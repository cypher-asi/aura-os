use super::chat_streaming::ChatLoopContext;
use crate::channel_ext::send_or_log;
use crate::chat::{ChatService, ChatStreamEvent};
use crate::chat_event_forwarding::extract_user_text;
use aura_billing::MeteredCompletionRequest;
use aura_core::*;
use tokio::sync::mpsc;
use tracing::{error, info};

impl ChatService {
    pub(crate) async fn maybe_generate_attachment_overview(
        &self,
        stored_messages: &[Message],
        project_id: &ProjectId,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let has_text_attachments = stored_messages.iter().any(|m| {
            m.role == ChatRole::User
                && m.content_blocks
                    .as_ref()
                    .map(|blocks| {
                        blocks.iter().any(|b| {
                            matches!(b, ChatContentBlock::Text { text } if text.contains("[File:"))
                        })
                    })
                    .unwrap_or(false)
        });

        if !has_text_attachments {
            return;
        }

        send_or_log(
            tx,
            ChatStreamEvent::Progress("Analyzing attachments...".to_string()),
        );

        let requirements_content = extract_user_text(stored_messages);
        if requirements_content.is_empty() {
            return;
        }

        info!(%project_id, len = requirements_content.len(), "Generating project overview from attachments");
        match self
            .spec_gen
            .generate_project_overview(project_id, &requirements_content)
            .await
        {
            Ok((title, summary)) => {
                info!(%project_id, %title, "Project overview generated");
                send_or_log(tx, ChatStreamEvent::SpecsTitle(title));
                send_or_log(tx, ChatStreamEvent::SpecsSummary(summary));
            }
            Err(e) => {
                error!(%project_id, error = %e, "Failed to generate project overview");
                send_or_log(
                    tx,
                    ChatStreamEvent::Error(format!("Failed to generate project overview: {e}")),
                );
            }
        }
    }

    pub(crate) async fn maybe_generate_title(
        &self,
        ctx: &ChatLoopContext<'_>,
        assistant_reply: &str,
    ) {
        if ctx.agent_instance.name != "New Chat" {
            return;
        }

        let first_user_msg = ctx
            .stored_messages
            .iter()
            .find(|m| m.role == ChatRole::User)
            .map(|m| m.content.as_str())
            .unwrap_or("");
        let reply_preview: String = assistant_reply.chars().take(300).collect();

        let title_prompt = format!(
            "User: {first_user_msg}\n\nAssistant: {reply_preview}\n\n\
             Generate a concise 3-6 word title for this conversation. \
             Return ONLY the title text, no quotes or punctuation at the end."
        );

        match self
            .llm
            .complete(MeteredCompletionRequest {
                model: Some(aura_claude::FAST_MODEL),
                api_key: ctx.api_key,
                system_prompt: TITLE_GEN_SYSTEM_PROMPT,
                user_message: &title_prompt,
                max_tokens: 30,
                billing_reason: "aura_title_gen",
                metadata: None,
            })
            .await
        {
            Ok(resp) => {
                let title = resp.text;
                let title = title.trim().trim_matches('"').to_string();
                let mut instance = ctx.agent_instance.clone();
                instance.name = title;
                instance.updated_at = chrono::Utc::now();
                send_or_log(ctx.tx, ChatStreamEvent::AgentInstanceUpdated(instance));
            }
            Err(e) => {
                let project_id = ctx.project_id;
                error!(%project_id, error = %e, "Failed to generate title");
            }
        }
    }
}
