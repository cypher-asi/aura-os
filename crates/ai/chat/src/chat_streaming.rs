use std::sync::{Arc, Mutex};
use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};
use aura_core::*;
use aura_claude::ThinkingConfig;
use aura_billing::MeteredCompletionRequest;
use aura_tools::agent_tool_definitions;
use crate::channel_ext::send_or_log;
use crate::chat::{ChatAttachment, ChatService, ChatStreamEvent};
use crate::chat_event_forwarding::{ContentBlockAccumulator, forward_tool_loop_event, extract_user_text};
use crate::chat_message_conversion::build_attachment_blocks;
use crate::constants::DEFAULT_STREAM_TIMEOUT;
use crate::chat_context::build_chat_system_prompt;
use crate::chat_tool_executor::ChatToolExecutor;
use crate::chat_tool_loop_executor::{ForwardingToolExecutor, SingleProjectResolver};
use crate::tool_loop::{run_tool_loop, ToolLoopConfig, ToolLoopEvent, ToolLoopInput, ToolLoopResult};

struct ChatLoopContext<'a> {
    project_id: &'a ProjectId,
    agent_instance_id: &'a AgentInstanceId,
    agent_instance: &'a AgentInstance,
    api_key: &'a str,
    stored_messages: &'a [Message],
    tx: &'a mpsc::UnboundedSender<ChatStreamEvent>,
    active_session_id: Option<&'a str>,
}

pub struct ChatMessageParams<'a> {
    pub project_id: &'a ProjectId,
    pub agent_instance_id: &'a AgentInstanceId,
    pub agent_instance: &'a AgentInstance,
    pub content: &'a str,
    pub action: Option<&'a str>,
    pub attachments: &'a [ChatAttachment],
}

pub struct AgentMessageParams<'a> {
    pub agent_id: &'a AgentId,
    pub agent: &'a Agent,
    pub projects: &'a [Project],
    pub storage_messages: Vec<Message>,
    pub content: &'a str,
    pub action: Option<&'a str>,
    pub attachments: &'a [ChatAttachment],
    pub storage_anchor: Option<(ProjectId, AgentInstanceId)>,
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

        let (loop_tx, mut loop_rx) = mpsc::unbounded_channel::<ToolLoopEvent>();
        let tx_clone = tx.clone();
        let fwd_blocks = Arc::clone(&tool_blocks);
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = loop_rx.recv().await {
                forward_tool_loop_event(evt, &tx_clone, &fwd_blocks);
            }
        });
        let result = run_tool_loop(ToolLoopInput {
            llm: self.llm.clone(),
            api_key: &api_key,
            system_prompt: &system,
            initial_messages: api_messages,
            tools,
            config: &config,
            executor: &executor,
            event_tx: &loop_tx,
        })
        .await;
        drop(loop_tx);
        let _ = forwarder.await;

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

        let chat_ctx = ChatLoopContext {
            project_id, agent_instance_id, agent_instance,
            api_key: &api_key, stored_messages: &stored_messages,
            tx, active_session_id,
        };
        self.save_assistant_message(&chat_ctx, result, tool_blocks, thinking_start).await;
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

    pub(crate) fn update_instance_token_usage(
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
        ctx: &ChatLoopContext<'_>,
        result: ToolLoopResult,
        tool_blocks: ContentBlockAccumulator,
        thinking_start: std::time::Instant,
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
                ctx.project_id, ctx.agent_instance_id, &result,
                content_blocks.as_deref(), thinking_start,
            );
            send_or_log(ctx.tx, ChatStreamEvent::MessageSaved(assistant_msg));
            self.save_message_to_storage(crate::chat_persistence::SaveMessageParams {
                project_id: ctx.project_id,
                agent_instance_id: ctx.agent_instance_id,
                role: "assistant",
                content: &assistant_reply,
                content_blocks: content_blocks.as_deref(),
                thinking: thinking.as_deref(),
                thinking_duration_ms,
                input_tokens: Some(result.total_input_tokens),
                output_tokens: Some(result.total_output_tokens),
                session_id: ctx.active_session_id,
            })
            .await;

            if let Some(sid) = ctx.active_session_id {
                self.update_session_context_usage(
                    sid,
                    result.total_input_tokens,
                    result.total_output_tokens,
                )
                .await;
            }

            if !assistant_reply.is_empty() {
                self.maybe_generate_title(ctx, &assistant_reply).await;
            }
        }
    }

    async fn maybe_generate_title(
        &self,
        ctx: &ChatLoopContext<'_>,
        assistant_reply: &str,
    ) {
        if ctx.agent_instance.name != "New Chat" {
            return;
        }

        let first_user_msg = ctx.stored_messages
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
                model: Some(aura_claude::FAST_MODEL), api_key: ctx.api_key,
                system_prompt: TITLE_GEN_SYSTEM_PROMPT,
                user_message: &title_prompt, max_tokens: 30,
                billing_reason: "aura_title_gen", metadata: None,
            })
            .await
        {
            Ok(resp) => {
                let title = resp.text;
                let title = title.trim().trim_matches('"').to_string();
                let mut instance = ctx.agent_instance.clone();
                instance.name = title;
                instance.updated_at = Utc::now();
                send_or_log(ctx.tx, ChatStreamEvent::AgentInstanceUpdated(instance));
            }
            Err(e) => {
                let project_id = ctx.project_id;
                error!(%project_id, error = %e, "Failed to generate title");
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
            self.save_message_to_storage(crate::chat_persistence::SaveMessageParams {
                project_id,
                agent_instance_id,
                role: "user",
                content,
                content_blocks,
                thinking: None,
                thinking_duration_ms: None,
                input_tokens: None,
                output_tokens: None,
                session_id: Some(session_id.as_str()),
            })
            .await;
        }
        active_session_id
    }

    pub async fn send_message_streaming(
        &self,
        params: ChatMessageParams<'_>,
        tx: mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let ChatMessageParams {
            project_id, agent_instance_id, agent_instance,
            content, action, attachments,
        } = params;

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
        params: AgentMessageParams<'_>,
        tx: mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let AgentMessageParams {
            agent_id, agent, projects, storage_messages,
            content, action: _action, attachments, storage_anchor,
        } = params;
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
            crate::chat_agent::AgentChatParams {
                agent_id,
                agent,
                projects,
                stored_messages: messages_for_context,
                anchor_project_id: &anchor_project_id,
                anchor_instance_id: &anchor_instance_id,
                active_session_id: active_session_id.as_deref(),
            },
            &tx,
        )
        .await;

        send(ChatStreamEvent::Done);
    }
}
