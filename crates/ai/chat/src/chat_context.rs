use tracing::{info, warn};

use aura_claude::{self, ContentBlock, MessageContent, RichMessage};
use aura_core::*;

use crate::ChatService;

impl ChatService {
    fn is_tool_results_only(msg: &RichMessage) -> bool {
        msg.role == "user"
            && matches!(
                &msg.content,
                MessageContent::Blocks(blocks)
                    if !blocks.is_empty()
                        && blocks
                            .iter()
                            .all(|b| matches!(b, ContentBlock::ToolResult { .. }))
            )
    }

    pub(crate) async fn manage_context_window(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
    ) -> Vec<RichMessage> {
        use aura_claude::estimate_message_tokens;

        let max_context_tokens = self.llm_config.max_context_tokens;
        let keep_recent_messages = self.llm_config.keep_recent_messages;
        let target_chat_tokens = self.llm_config.target_chat_tokens;

        let system_tokens = aura_claude::estimate_tokens(system_prompt);
        let total_msg_tokens: u64 = messages.iter().map(|m| estimate_message_tokens(m)).sum();
        let total = system_tokens + total_msg_tokens;

        if total <= target_chat_tokens || messages.len() <= 4 {
            return messages;
        }

        let utilization = total as f64 / max_context_tokens as f64;

        if utilization <= 0.50 {
            info!(
                total_tokens = total,
                target_chat_tokens,
                utilization_pct = (utilization * 100.0) as u32,
                "Soft-target compaction: summarizing to stay under target_chat_tokens"
            );
            let compaction_keep = keep_recent_messages.min(6);
            let split_at = Self::find_safe_split(&messages, compaction_keep);
            return self.summarize_and_keep(api_key, &messages, split_at).await;
        }

        if utilization <= 0.75 {
            let compaction_keep = keep_recent_messages.min(6);
            if total > target_chat_tokens * 2 {
                info!(
                    total_tokens = total,
                    target_chat_tokens,
                    utilization_pct = (utilization * 100.0) as u32,
                    "Tier-1 compaction: summarizing (tokens far above soft target)"
                );
                let split_at = Self::find_safe_split(&messages, compaction_keep);
                return self.summarize_and_keep(api_key, &messages, split_at).await;
            }
            info!(
                total_tokens = total,
                utilization_pct = (utilization * 100.0) as u32,
                "Tier-1 compaction: truncating large tool results in older messages"
            );
            return crate::compaction::compact_tool_results_in_history(messages, compaction_keep);
        }

        if utilization <= 0.90 {
            info!(
                total_tokens = total,
                utilization_pct = (utilization * 100.0) as u32,
                "Tier-2 compaction: summarizing older messages"
            );
            let compaction_keep = keep_recent_messages.min(6);
            let split_at = Self::find_safe_split(&messages, compaction_keep);
            return self.summarize_and_keep(api_key, &messages, split_at).await;
        }

        info!(
            total_tokens = total,
            utilization_pct = (utilization * 100.0) as u32,
            "Tier-3 compaction: aggressive summarization"
        );
        let aggressive_keep = 4;
        let split_at = Self::find_safe_split(&messages, aggressive_keep);
        self.summarize_and_keep(api_key, &messages, split_at).await
    }

    fn find_safe_split(messages: &[RichMessage], keep_recent: usize) -> usize {
        let mut split_at = messages.len().saturating_sub(keep_recent);
        while split_at > 0 && Self::is_tool_results_only(&messages[split_at]) {
            split_at -= 1;
        }
        split_at
    }

    async fn summarize_and_keep(
        &self,
        api_key: &str,
        messages: &[RichMessage],
        split_at: usize,
    ) -> Vec<RichMessage> {
        let (old_messages, recent_messages) = messages.split_at(split_at);

        let mut summary_input = String::from(
            "Summarize the following conversation concisely, preserving key decisions, \
             tool calls made, and their outcomes. Focus on what was discussed, what was decided, \
             and what actions were taken. Keep it under 500 words.\n\n"
        );
        for msg in old_messages {
            let role = &msg.role;
            let text = match &msg.content {
                aura_claude::MessageContent::Text(t) => t.clone(),
                aura_claude::MessageContent::Blocks(blocks) => {
                    blocks.iter().map(|b| match b {
                        ContentBlock::Text { text } => text.clone(),
                        ContentBlock::Image { .. } => "[Image]".to_string(),
                        ContentBlock::ToolUse { name, .. } => format!("[Tool call: {name}]"),
                        ContentBlock::ToolResult { content, .. } => {
                            let preview: String = content.chars().take(100).collect();
                            format!("[Tool result: {preview}...]")
                        }
                    }).collect::<Vec<_>>().join(" ")
                }
            };
            if !text.is_empty() {
                summary_input.push_str(&format!("{role}: {}\n", text.chars().take(500).collect::<String>()));
            }
        }

        match self
            .llm
            .complete_with_model(aura_claude::FAST_MODEL, api_key, CONTEXT_SUMMARY_SYSTEM_PROMPT, &summary_input, 1024, "aura_context_summary", None)
            .await
        {
            Ok(resp) => {
                let summary = resp.text;
                let mut result = vec![RichMessage::user(&format!(
                    "Previous conversation summary:\n{summary}"
                ))];
                result.push(RichMessage::assistant_text(
                    "Understood. I have the context from our previous conversation. How can I help?"
                ));
                result.extend(recent_messages.to_vec());
                info!(
                    original_count = old_messages.len() + recent_messages.len(),
                    new_count = result.len(),
                    "Context window compressed via summarization"
                );
                result
            }
            Err(e) => {
                warn!(error = %e, "Failed to summarize context, truncating instead");
                recent_messages.to_vec()
            }
        }
    }
}
