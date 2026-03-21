use std::sync::{Arc, Mutex};

use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::*;
use aura_claude::{ThinkingConfig, ToolDefinition};
use aura_specs::SpecStreamEvent;
use aura_tools::agent_tool_definitions;

use crate::channel_ext::send_or_log;
use crate::chat::{ChatAttachment, ChatService, ChatStreamEvent};
use crate::chat_message_conversion::build_attachment_blocks;
use crate::constants::DEFAULT_STREAM_TIMEOUT;
use crate::chat_context::build_chat_system_prompt;
use crate::chat_tool_executor::ChatToolExecutor;
use crate::chat_tool_loop_executor::{ForwardingToolExecutor, SingleProjectResolver};
use crate::tool_loop::{
    run_tool_loop, ToolExecutor, ToolLoopConfig, ToolLoopEvent, ToolLoopResult,
};

pub(crate) type ContentBlockAccumulator = Arc<Mutex<Vec<ChatContentBlock>>>;

/// Forward a tool-loop event to the chat stream and accumulate content blocks.
///
/// Uses `std::sync::Mutex` intentionally: the critical sections are sub-microsecond
/// (single `Vec::push`) and never held across `.await` points, which is the
/// recommended pattern per Tokio docs for short, synchronous locks.
pub(crate) fn forward_tool_loop_event(
    evt: ToolLoopEvent,
    tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    blocks: &ContentBlockAccumulator,
) {
    match evt {
        ToolLoopEvent::Delta(text) => {
            send_or_log(tx, ChatStreamEvent::Delta(text));
        }
        ToolLoopEvent::ThinkingDelta(text) => {
            send_or_log(tx, ChatStreamEvent::ThinkingDelta(text));
        }
        ToolLoopEvent::ToolUseStarted { id, name } => {
            send_or_log(tx, ChatStreamEvent::ToolCallStarted { id, name });
        }
        ToolLoopEvent::ToolUseDetected { id, name, input } => {
            if let Ok(mut acc) = blocks.lock() {
                acc.push(ChatContentBlock::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                });
            }
            send_or_log(tx, ChatStreamEvent::ToolCall { id, name, input });
        }
        ToolLoopEvent::ToolResult {
            tool_use_id,
            tool_name,
            content,
            is_error,
        } => {
            if let Ok(mut acc) = blocks.lock() {
                acc.push(ChatContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: content.clone(),
                    is_error: if is_error { Some(true) } else { None },
                });
            }
            send_or_log(tx, ChatStreamEvent::ToolResult {
                id: tool_use_id,
                name: tool_name,
                result: content,
                is_error,
            });
        }
        ToolLoopEvent::IterationTokenUsage {
            input_tokens,
            output_tokens,
        } => {
            send_or_log(tx, ChatStreamEvent::TokenUsage {
                input_tokens,
                output_tokens,
            });
        }
        ToolLoopEvent::Error(msg) => {
            send_or_log(tx, ChatStreamEvent::Error(msg));
        }
    }
}

fn extract_user_text(messages: &[Message]) -> String {
    messages
        .iter()
        .filter(|m| m.role == ChatRole::User)
        .map(|m| {
            let block_text = m.content_blocks.as_ref().and_then(|blocks| {
                let texts: Vec<&str> = blocks
                    .iter()
                    .filter_map(|b| match b {
                        ChatContentBlock::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect();
                if texts.is_empty() { None } else { Some(texts.join("\n\n")) }
            });
            block_text.unwrap_or_else(|| m.content.clone())
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

impl ChatService {
    pub(crate) async fn handle_chat_with_tools(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        agent_instance: &AgentInstance,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
        active_session_id: Option<&str>,
    ) {
        let (api_key, system, api_messages, stored_messages) =
            match self.prepare_chat_context(project_id, agent_instance_id, agent_instance, tx).await {
                Some(v) => v,
                None => return,
            };

        self.maybe_generate_attachment_overview(&stored_messages, project_id, tx).await;

        send_or_log(tx, ChatStreamEvent::Progress("Waiting for response...".to_string()));

        let tool_blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));
        let executor = ForwardingToolExecutor {
            inner: ChatToolExecutor::new(
                self.store.clone(),
                self.storage_client.clone(),
                self.project_service.clone(),
                self.task_service.clone(),
            ),
            resolver: SingleProjectResolver { project_id: *project_id },
            chat_tx: tx.clone(),
            blocks: Arc::clone(&tool_blocks),
        };

        let credit_budget = self.llm.current_balance().await.map(|b| b / 2);
        let config = ToolLoopConfig {
            max_iterations: ChatToolExecutor::max_iterations(),
            max_tokens: self.llm_config.chat_max_tokens,
            thinking: Some(ThinkingConfig::enabled(self.llm_config.thinking_budget)),
            stream_timeout: DEFAULT_STREAM_TIMEOUT,
            billing_reason: "aura_chat",
            max_context_tokens: Some(self.llm_config.max_context_tokens),
            credit_budget,
            exploration_allowance: None,
            model_override: None,
            auto_build_cooldown: None,
        };

        let thinking_start = std::time::Instant::now();
        let tools = agent_tool_definitions();
        let result = self
            .run_forwarded_tool_loop(&api_key, &system, api_messages, tools, &config, &executor, tx, &tool_blocks)
            .await;

        self.update_instance_token_usage(
            project_id, agent_instance_id,
            result.total_input_tokens, result.total_output_tokens, tx,
        );

        info!(
            %project_id, %agent_instance_id,
            result.total_input_tokens, result.total_output_tokens,
            llm_error = result.llm_error.as_deref().unwrap_or(""),
            "Chat loop finished"
        );

        self.save_assistant_message(
            project_id, agent_instance_id, agent_instance,
            &api_key, &stored_messages, result, tool_blocks,
            thinking_start, tx, active_session_id,
        )
        .await;
    }

    async fn prepare_chat_context(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        agent_instance: &AgentInstance,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) -> Option<(String, String, Vec<aura_claude::RichMessage>, Vec<Message>)> {
        let api_key = match self.settings.get_decrypted_api_key() {
            Ok(k) => k,
            Err(e) => {
                send_or_log(tx, ChatStreamEvent::Error(format!("API key error: {e}")));
                return None;
            }
        };

        send_or_log(tx, ChatStreamEvent::Progress("Loading conversation...".to_string()));

        let stored_messages = match self.list_messages_async(project_id, agent_instance_id).await {
            Ok(m) => m,
            Err(e) => {
                send_or_log(tx, ChatStreamEvent::Error(format!("Failed to load messages: {e}")));
                return None;
            }
        };

        send_or_log(tx, ChatStreamEvent::Progress("Building context...".to_string()));

        let custom_prompt = agent_instance.system_prompt.clone();
        let system = match self.project_service.get_project_async(project_id).await {
            Ok(p) => {
                let cp = custom_prompt.clone();
                tokio::task::spawn_blocking(move || build_chat_system_prompt(&p, &cp))
                    .await
                    .unwrap_or_else(|_| CHAT_SYSTEM_PROMPT_BASE.to_string())
            }
            Err(_) => {
                if custom_prompt.is_empty() {
                    CHAT_SYSTEM_PROMPT_BASE.to_string()
                } else {
                    format!("{}\n\n{}", custom_prompt, CHAT_SYSTEM_PROMPT_BASE)
                }
            }
        };

        let mut api_messages = crate::chat_message_conversion::convert_messages_to_rich(&stored_messages);
        api_messages = self.manage_context_window(&api_key, &system, api_messages).await;
        api_messages = crate::chat_sanitize::sanitize_orphan_tool_results(api_messages);
        api_messages = crate::chat_sanitize::sanitize_tool_use_results(api_messages);

        Some((api_key, system, api_messages, stored_messages))
    }

    async fn maybe_generate_attachment_overview(
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

        send_or_log(tx, ChatStreamEvent::Progress("Analyzing attachments...".to_string()));

        let requirements_content = extract_user_text(stored_messages);
        if requirements_content.is_empty() {
            return;
        }

        info!(%project_id, len = requirements_content.len(), "Generating project overview from attachments");
        match self.spec_gen.generate_project_overview(project_id, &requirements_content).await {
            Ok((title, summary)) => {
                info!(%project_id, %title, "Project overview generated");
                send_or_log(tx, ChatStreamEvent::SpecsTitle(title));
                send_or_log(tx, ChatStreamEvent::SpecsSummary(summary));
            }
            Err(e) => {
                error!(%project_id, error = %e, "Failed to generate project overview");
                send_or_log(tx, ChatStreamEvent::Error(
                    format!("Failed to generate project overview: {e}"),
                ));
            }
        }
    }

    async fn run_forwarded_tool_loop(
        &self,
        api_key: &str,
        system: &str,
        api_messages: Vec<aura_claude::RichMessage>,
        tools: Arc<[ToolDefinition]>,
        config: &ToolLoopConfig,
        executor: &dyn ToolExecutor,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
        tool_blocks: &ContentBlockAccumulator,
    ) -> ToolLoopResult {
        let (loop_tx, mut loop_rx) = mpsc::unbounded_channel::<ToolLoopEvent>();
        let tx_clone = tx.clone();
        let fwd_blocks = Arc::clone(tool_blocks);
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = loop_rx.recv().await {
                forward_tool_loop_event(evt, &tx_clone, &fwd_blocks);
            }
        });

        let result = run_tool_loop(
            self.llm.clone(), api_key, system, api_messages,
            tools, config, executor, &loop_tx,
        )
        .await;
        drop(loop_tx);
        let _ = forwarder.await;
        result
    }

    fn update_instance_token_usage(
        &self,
        _project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        _input_tokens: u64,
        _output_tokens: u64,
        _tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        // Token usage on agent instances is tracked at the task/session level.
        // aura-storage project agents only support status updates, not token writes.
    }

    fn build_assistant_message(
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        result: &ToolLoopResult,
        content_blocks: Option<&[ChatContentBlock]>,
        thinking_start: std::time::Instant,
    ) -> (Message, Option<String>, Option<u64>) {
        let thinking = if result.thinking.is_empty() { None } else { Some(result.thinking.clone()) };
        let thinking_duration_ms = thinking.as_ref().map(|_| thinking_start.elapsed().as_millis() as u64);
        let msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: *agent_instance_id,
            project_id: *project_id,
            role: ChatRole::Assistant,
            content: result.text.clone(),
            content_blocks: content_blocks.map(|b| b.to_vec()),
            thinking: thinking.clone(),
            thinking_duration_ms,
            created_at: Utc::now(),
        };
        (msg, thinking, thinking_duration_ms)
    }

    async fn save_assistant_message(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        agent_instance: &AgentInstance,
        api_key: &str,
        stored_messages: &[Message],
        result: ToolLoopResult,
        tool_blocks: ContentBlockAccumulator,
        thinking_start: std::time::Instant,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
        active_session_id: Option<&str>,
    ) {
        let accumulated_blocks = match Arc::try_unwrap(tool_blocks) {
            Ok(mutex) => mutex.into_inner().unwrap_or_default(),
            Err(arc) => arc.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        };
        let has_tool_calls = !accumulated_blocks.is_empty();
        let content_blocks = if has_tool_calls { Some(accumulated_blocks) } else { None };

        if !result.text.is_empty() || has_tool_calls {
            let assistant_reply = result.text.clone();
            let (assistant_msg, thinking, thinking_duration_ms) = Self::build_assistant_message(
                project_id, agent_instance_id, &result,
                content_blocks.as_deref(), thinking_start,
            );
            send_or_log(tx, ChatStreamEvent::MessageSaved(assistant_msg));
            self.save_message_to_storage(
                project_id,
                agent_instance_id,
                "assistant",
                &assistant_reply,
                content_blocks.as_deref(),
                thinking.as_deref(),
                thinking_duration_ms,
                Some(result.total_input_tokens),
                Some(result.total_output_tokens),
                active_session_id,
            )
            .await;

            if let Some(sid) = active_session_id {
                self.update_session_context_usage(
                    sid,
                    result.total_input_tokens,
                    result.total_output_tokens,
                )
                .await;
            }

            if !assistant_reply.is_empty() {
                self.maybe_generate_title(
                    project_id, agent_instance_id, agent_instance,
                    api_key, stored_messages, &assistant_reply, tx,
                )
                .await;
            }
        }
    }

    async fn maybe_generate_title(
        &self,
        project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        agent_instance: &AgentInstance,
        api_key: &str,
        messages: &[Message],
        assistant_reply: &str,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        if agent_instance.name != "New Chat" {
            return;
        }

        let first_user_msg = messages
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
            .complete_with_model(aura_claude::FAST_MODEL, api_key, TITLE_GEN_SYSTEM_PROMPT, &title_prompt, 30, "aura_title_gen", None)
            .await
        {
            Ok(resp) => {
                let title = resp.text;
                let title = title.trim().trim_matches('"').to_string();
                let mut instance = agent_instance.clone();
                instance.name = title;
                instance.updated_at = Utc::now();
                send_or_log(tx, ChatStreamEvent::AgentInstanceUpdated(instance));
            }
            Err(e) => {
                error!(%project_id, error = %e, "Failed to generate title");
            }
        }
    }

    pub(crate) async fn handle_generate_specs(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        _agent_instance: &AgentInstance,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
        active_session_id: Option<&str>,
    ) {
        let send = |evt: ChatStreamEvent| {
            send_or_log(tx, evt);
        };

        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel::<SpecStreamEvent>();

        let spec_gen = self.spec_gen.clone();
        let pid = *project_id;
        tokio::spawn(async move {
            spec_gen.generate_specs_streaming(&pid, spec_tx).await;
        });

        let mut accumulated = String::new();
        let mut spec_input_tokens: u64 = 0;
        let mut spec_output_tokens: u64 = 0;

        while let Some(evt) = spec_rx.recv().await {
            match evt {
                SpecStreamEvent::Delta(text) => {
                    accumulated.push_str(&text);
                    send_or_log(tx, ChatStreamEvent::Delta(text));
                }
                SpecStreamEvent::SpecSaved(spec) => {
                    send_or_log(tx, ChatStreamEvent::SpecSaved(spec));
                }
                SpecStreamEvent::SpecsTitle(title) => {
                    send_or_log(tx, ChatStreamEvent::SpecsTitle(title));
                }
                SpecStreamEvent::SpecsSummary(summary) => {
                    send_or_log(tx, ChatStreamEvent::SpecsSummary(summary));
                }
                SpecStreamEvent::TaskSaved(task) => {
                    send_or_log(tx, ChatStreamEvent::TaskSaved(task));
                }
                SpecStreamEvent::TokenUsage { input_tokens, output_tokens } => {
                    spec_input_tokens += input_tokens;
                    spec_output_tokens += output_tokens;
                    send_or_log(tx, ChatStreamEvent::TokenUsage {
                        input_tokens: spec_input_tokens,
                        output_tokens: spec_output_tokens,
                    });
                }
                SpecStreamEvent::Error(msg) => {
                    send_or_log(tx, ChatStreamEvent::Error(msg));
                }
                SpecStreamEvent::Complete(_) => {}
                SpecStreamEvent::Progress(_) | SpecStreamEvent::Generating { .. } => {}
            }
        }

        info!(
            %project_id, %agent_instance_id,
            spec_input_tokens, spec_output_tokens,
            "Spec gen finished"
        );
        self.update_instance_token_usage(
            project_id, agent_instance_id,
            spec_input_tokens, spec_output_tokens, tx,
        );

        if !accumulated.is_empty() {
            let assistant_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *agent_instance_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: accumulated.clone(),
                content_blocks: None,
                thinking: None,
                thinking_duration_ms: None,
                created_at: Utc::now(),
            };
            send(ChatStreamEvent::MessageSaved(assistant_msg));
            self.save_message_to_storage(
                project_id,
                agent_instance_id,
                "assistant",
                &accumulated,
                None,
                None,
                None,
                Some(spec_input_tokens),
                Some(spec_output_tokens),
                active_session_id,
            )
            .await;

            if let Some(sid) = active_session_id {
                self.update_session_context_usage(sid, spec_input_tokens, spec_output_tokens)
                    .await;
            }
        }
    }

    /// Ensure an active session exists for this agent instance, save the user
    /// message to storage, and return the active session id (if any).
    pub(crate) async fn prepare_session_and_save_user_message(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        content: &str,
        content_blocks: Option<&[ChatContentBlock]>,
    ) -> Option<String> {
        let active_session_id = self
            .ensure_active_session(project_id, agent_instance_id)
            .await;
        if let Some(ref session_id) = active_session_id {
            self.save_message_to_storage(
                project_id,
                agent_instance_id,
                "user",
                content,
                content_blocks,
                None,
                None,
                None,
                None,
                Some(session_id.as_str()),
            )
            .await;
        }
        active_session_id
    }

    pub async fn send_message_streaming(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        agent_instance: &AgentInstance,
        content: &str,
        action: Option<&str>,
        attachments: &[ChatAttachment],
        tx: mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let send = |evt: ChatStreamEvent| {
            send_or_log(&tx, evt);
        };

        send(ChatStreamEvent::Progress("Connecting...".to_string()));

        let content_blocks = build_attachment_blocks(content, attachments);

        let active_session_id = self
            .prepare_session_and_save_user_message(
                project_id, agent_instance_id, content, content_blocks.as_deref(),
            )
            .await;
        let Some(ref _session_id) = active_session_id else {
            send(ChatStreamEvent::Error(
                "aura-storage is not configured or could not create session".to_string(),
            ));
            send(ChatStreamEvent::Done);
            return;
        };

        match action {
            Some("generate_specs") => {
                self.handle_generate_specs(
                    project_id, agent_instance_id, agent_instance, &tx,
                    active_session_id.as_deref(),
                ).await;
            }
            _ => {
                self.handle_chat_with_tools(
                    project_id, agent_instance_id, agent_instance, &tx,
                    active_session_id.as_deref(),
                ).await;
            }
        }

        send(ChatStreamEvent::Done);
    }

    pub async fn send_agent_message_streaming(
        &self,
        agent_id: &AgentId,
        agent: &Agent,
        projects: &[Project],
        storage_messages: Vec<Message>,
        content: &str,
        _action: Option<&str>,
        attachments: &[ChatAttachment],
        storage_anchor: Option<(ProjectId, AgentInstanceId)>,
        tx: mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let send = |evt: ChatStreamEvent| {
            send_or_log(&tx, evt);
        };

        send(ChatStreamEvent::Progress("Connecting...".to_string()));

        let now = Utc::now();
        let content_blocks = build_attachment_blocks(content, attachments);

        let (anchor_project_id, anchor_instance_id) = storage_anchor
            .unwrap_or((ProjectId::nil(), AgentInstanceId::nil()));

        let active_session_id = if !anchor_instance_id.as_uuid().is_nil() {
            self.prepare_session_and_save_user_message(
                &anchor_project_id, &anchor_instance_id, content, content_blocks.as_deref(),
            ).await
        } else {
            None
        };

        let user_msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: anchor_instance_id,
            project_id: anchor_project_id,
            role: ChatRole::User,
            content: content.to_string(),
            content_blocks,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
        };

        let mut messages_for_context = storage_messages;
        messages_for_context.push(user_msg);

        self.handle_agent_chat_with_tools(
            agent_id,
            agent,
            projects,
            messages_for_context,
            &anchor_project_id,
            &anchor_instance_id,
            active_session_id.as_deref(),
            &tx,
        )
        .await;

        send(ChatStreamEvent::Done);
    }
}
