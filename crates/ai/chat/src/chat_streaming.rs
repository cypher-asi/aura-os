use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::*;
use aura_claude::{ThinkingConfig, ToolCall, ToolDefinition};
use aura_specs::SpecStreamEvent;
use aura_tools::agent_tool_definitions;

use crate::chat::{
    ChatService, ChatStreamEvent, ContentBlockAccumulator,
    forward_tool_loop_event,
};
use crate::chat_context::build_chat_system_prompt;
use crate::chat_tool_executor::ChatToolExecutor;
use crate::tool_loop::{
    run_tool_loop, ToolCallResult, ToolExecutor, ToolLoopConfig, ToolLoopEvent, ToolLoopResult,
};

struct ChatToolLoopExecutor {
    inner: ChatToolExecutor,
    project_id: ProjectId,
    chat_tx: mpsc::UnboundedSender<ChatStreamEvent>,
    blocks: ContentBlockAccumulator,
}

#[async_trait]
impl ToolExecutor for ChatToolLoopExecutor {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        let mut indexed_results: Vec<(usize, crate::chat_tool_executor::ToolExecResult)> =
            Vec::with_capacity(tool_calls.len());

        // Partition into create_task (sequential) vs everything else (concurrent)
        let mut concurrent_indices = Vec::new();
        let mut sequential_indices = Vec::new();
        for (i, tc) in tool_calls.iter().enumerate() {
            if tc.name == "create_task" {
                sequential_indices.push(i);
            } else {
                concurrent_indices.push(i);
            }
        }

        // Run non-create_task calls concurrently
        if !concurrent_indices.is_empty() {
            let futures: Vec<_> = concurrent_indices
                .iter()
                .map(|&i| {
                    let tc = &tool_calls[i];
                    self.inner.execute(&self.project_id, &tc.name, tc.input.clone())
                })
                .collect();
            let results = futures::future::join_all(futures).await;
            for (result, &i) in results.into_iter().zip(&concurrent_indices) {
                indexed_results.push((i, result));
            }
        }

        // Run create_task calls sequentially to prevent order_index races
        for &i in &sequential_indices {
            let tc = &tool_calls[i];
            let result = self.inner.execute(&self.project_id, &tc.name, tc.input.clone()).await;
            indexed_results.push((i, result));
        }

        // Sort back into original order
        indexed_results.sort_by_key(|(i, _)| *i);

        indexed_results
            .into_iter()
            .map(|(i, result)| {
                let tc = &tool_calls[i];
                if let Some(spec) = &result.saved_spec {
                    if let Ok(mut acc) = self.blocks.lock() {
                        acc.push(ChatContentBlock::SpecRef {
                            spec_id: spec.spec_id.to_string(),
                            title: spec.title.clone(),
                        });
                    }
                    let _ = self.chat_tx.send(ChatStreamEvent::SpecSaved(spec.clone()));
                }
                if let Some(task) = &result.saved_task {
                    if let Ok(mut acc) = self.blocks.lock() {
                        acc.push(ChatContentBlock::TaskRef {
                            task_id: task.task_id.to_string(),
                            title: task.title.clone(),
                        });
                    }
                    let _ = self.chat_tx.send(ChatStreamEvent::TaskSaved(task.clone()));
                }
                ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: result.content,
                    is_error: result.is_error,
                    stop_loop: false,
                }
            })
            .collect()
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

        let tool_blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));
        let executor = ChatToolLoopExecutor {
            inner: ChatToolExecutor::new(
                self.store.clone(),
                self.storage_client.clone(),
                self.project_service.clone(),
                self.task_service.clone(),
            ),
            project_id: *project_id,
            chat_tx: tx.clone(),
            blocks: Arc::clone(&tool_blocks),
        };

        let credit_budget = self.llm.current_balance().await.map(|b| b / 2);
        let config = ToolLoopConfig {
            max_iterations: ChatToolExecutor::max_iterations(),
            max_tokens: self.llm_config.chat_max_tokens,
            thinking: Some(ThinkingConfig::enabled(self.llm_config.thinking_budget)),
            stream_timeout: std::time::Duration::from_secs(300),
            billing_reason: "aura_chat",
            max_context_tokens: Some(self.llm_config.max_context_tokens),
            credit_budget,
            exploration_allowance: None,
            model_override: None,
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
                let _ = tx.send(ChatStreamEvent::Error(format!("API key error: {e}")));
                return None;
            }
        };

        let stored_messages = match self.list_messages_async(project_id, agent_instance_id).await {
            Ok(m) => m,
            Err(e) => {
                let _ = tx.send(ChatStreamEvent::Error(format!("Failed to load messages: {e}")));
                return None;
            }
        };

        let custom_prompt = &agent_instance.system_prompt;
        let system = match self.project_service.get_project_async(project_id).await {
            Ok(p) => build_chat_system_prompt(&p, custom_prompt),
            Err(_) => {
                if custom_prompt.is_empty() {
                    CHAT_SYSTEM_PROMPT_BASE.to_string()
                } else {
                    format!("{}\n\n{}", custom_prompt, CHAT_SYSTEM_PROMPT_BASE)
                }
            }
        };

        let mut api_messages = crate::chat::convert_messages_to_rich(&stored_messages);
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

        let requirements_content = extract_user_text(stored_messages);
        if requirements_content.is_empty() {
            return;
        }

        info!(%project_id, len = requirements_content.len(), "Generating project overview from attachments");
        match self.spec_gen.generate_project_overview(project_id, &requirements_content).await {
            Ok((title, summary)) => {
                info!(%project_id, %title, "Project overview generated");
                let _ = tx.send(ChatStreamEvent::SpecsTitle(title));
                let _ = tx.send(ChatStreamEvent::SpecsSummary(summary));
            }
            Err(e) => {
                error!(%project_id, error = %e, "Failed to generate project overview");
                let _ = tx.send(ChatStreamEvent::Error(
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
            Err(arc) => arc.lock().unwrap().clone(),
        };
        let has_tool_calls = !accumulated_blocks.is_empty();
        let content_blocks = if has_tool_calls { Some(accumulated_blocks) } else { None };

        if !result.text.is_empty() || has_tool_calls {
            let assistant_reply = result.text.clone();
            let thinking = if result.thinking.is_empty() { None } else { Some(result.thinking) };
            let thinking_duration_ms = thinking.as_ref().map(|_| thinking_start.elapsed().as_millis() as u64);
            let assistant_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *agent_instance_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: result.text.clone(),
                content_blocks: content_blocks.clone(),
                thinking: thinking.clone(),
                thinking_duration_ms,
                created_at: Utc::now(),
            };
            let _ = tx.send(ChatStreamEvent::MessageSaved(assistant_msg));
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
                let _ = tx.send(ChatStreamEvent::AgentInstanceUpdated(instance));
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
            let _ = tx.send(evt);
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
                    let _ = tx.send(ChatStreamEvent::Delta(text));
                }
                SpecStreamEvent::SpecSaved(spec) => {
                    let _ = tx.send(ChatStreamEvent::SpecSaved(spec));
                }
                SpecStreamEvent::SpecsTitle(title) => {
                    let _ = tx.send(ChatStreamEvent::SpecsTitle(title));
                }
                SpecStreamEvent::SpecsSummary(summary) => {
                    let _ = tx.send(ChatStreamEvent::SpecsSummary(summary));
                }
                SpecStreamEvent::TaskSaved(task) => {
                    let _ = tx.send(ChatStreamEvent::TaskSaved(task));
                }
                SpecStreamEvent::TokenUsage { input_tokens, output_tokens } => {
                    spec_input_tokens += input_tokens;
                    spec_output_tokens += output_tokens;
                    let _ = tx.send(ChatStreamEvent::TokenUsage {
                        input_tokens: spec_input_tokens,
                        output_tokens: spec_output_tokens,
                    });
                }
                SpecStreamEvent::Error(msg) => {
                    let _ = tx.send(ChatStreamEvent::Error(msg));
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
}
