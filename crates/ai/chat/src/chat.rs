use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::*;
use aura_billing::MeteredLlm;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::chat_tool_executor::ChatToolExecutor;
use crate::tool_loop::{run_tool_loop, ToolCallResult, ToolExecutor, ToolLoopConfig, ToolLoopEvent};
use aura_tools::agent_tool_definitions;
use aura_claude::{
    ContentBlock, ImageSource, MessageContent, RichMessage,
    ThinkingConfig, ToolCall,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use crate::error::ChatError;
use aura_projects::ProjectService;
use aura_specs::{SpecGenerationService, SpecStreamEvent};
use aura_tasks::TaskService;


fn build_chat_system_prompt(project: &Project, custom_system_prompt: &str) -> String {
    let mut prompt = if custom_system_prompt.is_empty() {
        CHAT_SYSTEM_PROMPT_BASE.to_string()
    } else {
        let mut p = custom_system_prompt.to_string();
        p.push_str("\n\n");
        p.push_str(CHAT_SYSTEM_PROMPT_BASE);
        p
    };

    prompt.push_str(&format!(
        "\n\n## Current Project\n- **Name**: {}\n- **Description**: {}\n- **Folder**: {}\n- **Build**: {}\n- **Test**: {}\n",
        project.name,
        project.description,
        project.linked_folder_path,
        project.build_command.as_deref().unwrap_or("(not set)"),
        project.test_command.as_deref().unwrap_or("(not set)"),
    ));

    let folder = std::path::Path::new(&project.linked_folder_path);
    if folder.is_dir() {
        let mut stack: Vec<&str> = Vec::new();
        let markers: &[(&str, &str)] = &[
            ("Cargo.toml", "Rust"),
            ("package.json", "Node.js/TypeScript"),
            ("pyproject.toml", "Python"),
            ("requirements.txt", "Python"),
            ("go.mod", "Go"),
            ("pom.xml", "Java/Maven"),
            ("build.gradle", "Java/Gradle"),
            ("Gemfile", "Ruby"),
            ("composer.json", "PHP"),
            ("mix.exs", "Elixir"),
        ];
        for (file, tech) in markers {
            if folder.join(file).exists() && !stack.contains(tech) {
                stack.push(tech);
            }
        }
        if !stack.is_empty() {
            prompt.push_str(&format!("- **Tech Stack**: {}\n", stack.join(", ")));
        }

        if let Ok(entries) = std::fs::read_dir(folder) {
            let mut items: Vec<String> = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "node_modules" || name == "target"
                    || name == "__pycache__" || name == "dist" || name == "build"
                {
                    continue;
                }
                let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                items.push(if is_dir {
                    format!("{name}/")
                } else {
                    name
                });
            }
            items.sort();
            if !items.is_empty() {
                let listing = items.iter().take(30).cloned().collect::<Vec<_>>().join(", ");
                prompt.push_str(&format!("\n### Project Structure\n{listing}\n"));
            }
        }

        let config_files: &[&str] = &[
            "Cargo.toml", "package.json", "tsconfig.json", "pyproject.toml",
        ];
        let mut config_budget: usize = 2000;
        let mut config_sections: Vec<String> = Vec::new();
        for &cf in config_files {
            if config_budget == 0 {
                break;
            }
            let path = folder.join(cf);
            if let Ok(content) = std::fs::read_to_string(&path) {
                let preview: String = content.lines().take(30).collect::<Vec<_>>().join("\n");
                let preview = if preview.len() > config_budget {
                    preview[..config_budget].to_string()
                } else {
                    preview
                };
                config_budget = config_budget.saturating_sub(preview.len());
                config_sections.push(format!("**{cf}**:\n```\n{preview}\n```"));
            }
        }
        if !config_sections.is_empty() {
            prompt.push_str("\n### Key Config Files\n");
            prompt.push_str(&config_sections.join("\n"));
            prompt.push('\n');
        }
    }

    prompt
}

pub(crate) fn convert_messages_to_rich(messages: &[Message]) -> Vec<RichMessage> {
    messages
        .iter()
        .filter(|m| m.role == ChatRole::User || m.role == ChatRole::Assistant)
        .map(|m| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                ChatRole::System => "user",
            };
            if let Some(blocks) = &m.content_blocks {
                let content_blocks: Vec<ContentBlock> = blocks
                    .iter()
                    .filter_map(|b| match b {
                        ChatContentBlock::Text { text } => Some(ContentBlock::Text {
                            text: text.clone(),
                        }),
                        ChatContentBlock::ToolUse { id, name, input } => {
                            Some(ContentBlock::ToolUse {
                                id: id.clone(),
                                name: name.clone(),
                                input: input.clone(),
                            })
                        }
                        ChatContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            is_error,
                        } => Some(ContentBlock::ToolResult {
                            tool_use_id: tool_use_id.clone(),
                            content: content.clone(),
                            is_error: *is_error,
                        }),
                        ChatContentBlock::Image { media_type, data } => Some(ContentBlock::Image {
                            source: ImageSource {
                                source_type: "base64".to_string(),
                                media_type: media_type.clone(),
                                data: data.clone(),
                            },
                        }),
                        ChatContentBlock::TaskRef { .. } | ChatContentBlock::SpecRef { .. } => None,
                    })
                    .collect();
                RichMessage {
                    role: role.to_string(),
                    content: MessageContent::Blocks(content_blocks),
                }
            } else {
                RichMessage {
                    role: role.to_string(),
                    content: MessageContent::Text(m.content.clone()),
                }
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Shared accumulator for persisting tool calls and task/spec refs
// ---------------------------------------------------------------------------

pub(crate) type ContentBlockAccumulator = Arc<Mutex<Vec<ChatContentBlock>>>;

// ---------------------------------------------------------------------------
// ToolExecutor for single-project chat
// ---------------------------------------------------------------------------

struct ChatToolLoopExecutor {
    inner: ChatToolExecutor,
    project_id: ProjectId,
    chat_tx: mpsc::UnboundedSender<ChatStreamEvent>,
    blocks: ContentBlockAccumulator,
}

#[async_trait]
impl ToolExecutor for ChatToolLoopExecutor {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        let futures: Vec<_> = tool_calls
            .iter()
            .map(|tc| self.inner.execute(&self.project_id, &tc.name, tc.input.clone()))
            .collect();
        let results = futures::future::join_all(futures).await;

        results
            .into_iter()
            .zip(tool_calls)
            .map(|(result, tc)| {
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

// ---------------------------------------------------------------------------
// Forward ToolLoopEvents to ChatStreamEvent channel
// ---------------------------------------------------------------------------

pub(crate) fn forward_tool_loop_event(
    evt: ToolLoopEvent,
    tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    blocks: &ContentBlockAccumulator,
) {
    match evt {
        ToolLoopEvent::Delta(text) => {
            let _ = tx.send(ChatStreamEvent::Delta(text));
        }
        ToolLoopEvent::ThinkingDelta(text) => {
            let _ = tx.send(ChatStreamEvent::ThinkingDelta(text));
        }
        ToolLoopEvent::ToolUseDetected { id, name, input } => {
            if let Ok(mut acc) = blocks.lock() {
                acc.push(ChatContentBlock::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                });
            }
            let _ = tx.send(ChatStreamEvent::ToolCall { id, name, input });
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
            let _ = tx.send(ChatStreamEvent::ToolResult {
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
            let _ = tx.send(ChatStreamEvent::TokenUsage {
                input_tokens,
                output_tokens,
            });
        }
        ToolLoopEvent::Error(msg) => {
            let _ = tx.send(ChatStreamEvent::Error(msg));
        }
    }
}

fn build_attachment_blocks(
    content: &str,
    attachments: &[ChatAttachment],
) -> Option<Vec<ChatContentBlock>> {
    if attachments.is_empty() {
        return None;
    }
    let mut blocks: Vec<ChatContentBlock> = Vec::new();
    if !content.trim().is_empty() {
        blocks.push(ChatContentBlock::Text {
            text: content.to_string(),
        });
    }
    for att in attachments {
        if att.type_ == "image" {
            blocks.push(ChatContentBlock::Image {
                media_type: att.media_type.clone(),
                data: att.data.clone(),
            });
        } else if att.type_ == "text" {
            let text = match B64.decode(&att.data) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(_) => continue,
            };
            let header = att
                .name
                .as_deref()
                .map(|n| format!("[File: {}]\n\n", n))
                .unwrap_or_default();
            blocks.push(ChatContentBlock::Text {
                text: format!("{}{}", header, text),
            });
        }
    }
    if blocks.is_empty() { None } else { Some(blocks) }
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

// ---------------------------------------------------------------------------
// Attachment (from API request)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatAttachment {
    #[serde(rename = "type")]
    pub type_: String,
    pub media_type: String,
    pub data: String,
    #[serde(default)]
    pub name: Option<String>,
}

// ---------------------------------------------------------------------------
// Stream events sent to the SSE handler
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ChatStreamEvent {
    Delta(String),
    ThinkingDelta(String),
    ToolCall {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        id: String,
        name: String,
        result: String,
        is_error: bool,
    },
    SpecSaved(Spec),
    SpecsTitle(String),
    SpecsSummary(String),
    TaskSaved(Box<Task>),
    MessageSaved(Message),
    AgentInstanceUpdated(AgentInstance),
    TokenUsage {
        input_tokens: u64,
        output_tokens: u64,
    },
    Error(String),
    Done,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct ChatService {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) llm: Arc<MeteredLlm>,
    pub(crate) spec_gen: Arc<SpecGenerationService>,
    pub(crate) project_service: Arc<ProjectService>,
    pub(crate) task_service: Arc<TaskService>,
    pub(crate) llm_config: LlmConfig,
}

impl ChatService {
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
        spec_gen: Arc<SpecGenerationService>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
    ) -> Self {
        Self::with_config(store, settings, llm, spec_gen, project_service, task_service, LlmConfig::from_env())
    }

    pub fn with_config(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
        spec_gen: Arc<SpecGenerationService>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
        llm_config: LlmConfig,
    ) -> Self {
        Self {
            store,
            settings,
            llm,
            spec_gen,
            project_service,
            task_service,
            llm_config,
        }
    }

    pub fn list_messages(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Vec<Message>, ChatError> {
        let mut messages = self
            .store
            .list_messages(project_id, agent_instance_id)?;
        messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(messages)
    }

    pub fn list_agent_messages(
        &self,
        agent_id: &AgentId,
    ) -> Result<Vec<Message>, ChatError> {
        let mut messages = self.store.list_agent_messages(agent_id)?;
        messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(messages)
    }

    // -- Streaming message handler ------------------------------------------

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
            let _ = tx.send(evt);
        };

        let now = Utc::now();
        let content_blocks = build_attachment_blocks(content, attachments);

        let user_msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: *agent_instance_id,
            project_id: *project_id,
            role: ChatRole::User,
            content: content.to_string(),
            content_blocks,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
        };
        if let Err(e) = self.store.put_message(&user_msg) {
            send(ChatStreamEvent::Error(format!("Failed to save user message: {e}")));
            send(ChatStreamEvent::Done);
            return;
        }

        match action {
            Some("generate_specs") => {
                self.handle_generate_specs(project_id, agent_instance_id, agent_instance, &tx)
                    .await;
            }
            _ => {
                self.handle_chat_with_tools(project_id, agent_instance_id, agent_instance, &tx)
                    .await;
            }
        }

        send(ChatStreamEvent::Done);
    }

    // -- Agent-level streaming (multi-project) ---------------------------------

    pub async fn send_agent_message_streaming(
        &self,
        agent_id: &AgentId,
        agent: &Agent,
        projects: &[Project],
        content: &str,
        _action: Option<&str>,
        attachments: &[ChatAttachment],
        tx: mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let send = |evt: ChatStreamEvent| {
            let _ = tx.send(evt);
        };

        let now = Utc::now();
        let content_blocks = build_attachment_blocks(content, attachments);

        let dummy_project_id = ProjectId::nil();
        let dummy_agent_instance_id = AgentInstanceId::nil();

        let user_msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: dummy_agent_instance_id,
            project_id: dummy_project_id,
            role: ChatRole::User,
            content: content.to_string(),
            content_blocks,
            thinking: None,
            thinking_duration_ms: None,
            created_at: now,
        };
        if let Err(e) = self.store.put_agent_message(agent_id, &user_msg) {
            send(ChatStreamEvent::Error(format!("Failed to save user message: {e}")));
            send(ChatStreamEvent::Done);
            return;
        }

        self.handle_agent_chat_with_tools(agent_id, agent, projects, &tx)
            .await;

        send(ChatStreamEvent::Done);
    }

    // -----------------------------------------------------------------------
    // Agentic chat with tool-use loop
    // -----------------------------------------------------------------------

    async fn handle_chat_with_tools(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        agent_instance: &AgentInstance,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let send = |evt: ChatStreamEvent| {
            let _ = tx.send(evt);
        };

        let api_key = match self.settings.get_decrypted_api_key() {
            Ok(k) => k,
            Err(e) => {
                send(ChatStreamEvent::Error(format!("API key error: {e}")));
                return;
            }
        };

        let stored_messages = match self.list_messages(project_id, agent_instance_id) {
            Ok(m) => m,
            Err(e) => {
                send(ChatStreamEvent::Error(format!("Failed to load messages: {e}")));
                return;
            }
        };

        let custom_prompt = &agent_instance.system_prompt;
        let system = match self.store.get_project(project_id) {
            Ok(p) => build_chat_system_prompt(&p, custom_prompt),
            Err(_) => {
                if custom_prompt.is_empty() {
                    CHAT_SYSTEM_PROMPT_BASE.to_string()
                } else {
                    format!("{}\n\n{}", custom_prompt, CHAT_SYSTEM_PROMPT_BASE)
                }
            }
        };

        let mut api_messages = convert_messages_to_rich(&stored_messages);

        api_messages = self
            .manage_context_window(&api_key, &system, api_messages)
            .await;

        api_messages = Self::sanitize_orphan_tool_results(api_messages);
        api_messages = Self::sanitize_tool_use_results(api_messages);

        let tools = agent_tool_definitions();

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

        if has_text_attachments {
            let requirements_content = extract_user_text(&stored_messages);
            if !requirements_content.is_empty() {
                info!(%project_id, len = requirements_content.len(), "Generating project overview from attachments");
                match self
                    .spec_gen
                    .generate_project_overview(project_id, &requirements_content)
                    .await
                {
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
        }

        let tool_blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        let executor = ChatToolLoopExecutor {
            inner: ChatToolExecutor::new(
                self.store.clone(),
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
        };

        let thinking_start = std::time::Instant::now();

        let (loop_tx, mut loop_rx) = mpsc::unbounded_channel::<ToolLoopEvent>();
        let tx_clone = tx.clone();
        let fwd_blocks = Arc::clone(&tool_blocks);
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = loop_rx.recv().await {
                forward_tool_loop_event(evt, &tx_clone, &fwd_blocks);
            }
        });

        let result = run_tool_loop(
            self.llm.clone(),
            &api_key,
            &system,
            api_messages,
            tools,
            &config,
            &executor,
            &loop_tx,
        )
        .await;
        drop(loop_tx);
        let _ = forwarder.await;

        if result.total_input_tokens > 0 || result.total_output_tokens > 0 {
            if let Ok(mut instance) = self.store.get_agent_instance(project_id, agent_instance_id) {
                instance.total_input_tokens += result.total_input_tokens;
                instance.total_output_tokens += result.total_output_tokens;
                if instance.model.is_none() {
                    instance.model = Some(self.llm_config.default_model.clone());
                }
                instance.updated_at = Utc::now();
                if let Err(e) = self.store.put_agent_instance(&instance) {
                    error!(%project_id, %agent_instance_id, error = %e, "Failed to persist token usage");
                } else {
                    let _ = tx.send(ChatStreamEvent::AgentInstanceUpdated(instance));
                }
            }
        }

        info!(
            %project_id, %agent_instance_id,
            result.total_input_tokens, result.total_output_tokens,
            llm_error = result.llm_error.as_deref().unwrap_or(""),
            "Chat loop finished"
        );

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
                content: result.text,
                content_blocks,
                thinking,
                thinking_duration_ms,
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_message(&assistant_msg) {
                error!(%project_id, error = %e, "Failed to save assistant message");
            } else {
                send(ChatStreamEvent::MessageSaved(assistant_msg));
            }

            if !assistant_reply.is_empty() {
                self.maybe_generate_title(
                    project_id,
                    agent_instance_id,
                    agent_instance,
                    &api_key,
                    &stored_messages,
                    &assistant_reply,
                    tx,
                )
                .await;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Title generation (updates AgentInstance name)
    // -----------------------------------------------------------------------

    async fn maybe_generate_title(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
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
                if let Ok(mut instance) = self.store.get_agent_instance(project_id, agent_instance_id) {
                    instance.name = title;
                    instance.updated_at = Utc::now();
                    match self.store.put_agent_instance(&instance) {
                        Ok(()) => {
                            let _ = tx.send(ChatStreamEvent::AgentInstanceUpdated(instance));
                        }
                        Err(e) => {
                            error!(%project_id, error = %e, "Failed to update agent instance name");
                        }
                    }
                }
            }
            Err(e) => {
                error!(%project_id, error = %e, "Failed to generate title");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Spec generation
    // -----------------------------------------------------------------------

    async fn handle_generate_specs(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        _agent_instance: &AgentInstance,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
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
            "Spec gen finished, persisting token usage"
        );
        if spec_input_tokens > 0 || spec_output_tokens > 0 {
            match self.store.get_agent_instance(project_id, agent_instance_id) {
                Ok(mut instance) => {
                    instance.total_input_tokens += spec_input_tokens;
                    instance.total_output_tokens += spec_output_tokens;
                    if instance.model.is_none() {
                        instance.model = Some(self.llm_config.default_model.clone());
                    }
                    instance.updated_at = Utc::now();
                    if let Err(e) = self.store.put_agent_instance(&instance) {
                        error!(%project_id, %agent_instance_id, error = %e, "Failed to persist spec-gen tokens on agent instance");
                    } else {
                        info!(
                            %project_id, %agent_instance_id,
                            total_input = instance.total_input_tokens,
                            total_output = instance.total_output_tokens,
                            "Spec-gen token usage persisted to agent instance"
                        );
                        let _ = tx.send(ChatStreamEvent::AgentInstanceUpdated(instance));
                    }
                }
                Err(e) => {
                    error!(%project_id, %agent_instance_id, error = %e, "Failed to load agent instance for spec-gen token persistence");
                }
            }
        }

        if !accumulated.is_empty() {
            let assistant_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *agent_instance_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: accumulated,
                content_blocks: None,
                thinking: None,
                thinking_duration_ms: None,
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_message(&assistant_msg) {
                error!(%project_id, error = %e, "Failed to save spec gen assistant message");
            } else {
                send(ChatStreamEvent::MessageSaved(assistant_msg));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_project(name: &str, folder: &str) -> Project {
        Project {
            project_id: ProjectId::new(),
            org_id: OrgId::new(),
            name: name.into(),
            description: "Test project description".into(),
            linked_folder_path: folder.into(),
            requirements_doc_path: None,
            current_status: ProjectStatus::Planning,
            build_command: Some("cargo build".into()),
            test_command: Some("cargo test".into()),
            specs_summary: None,
            specs_title: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn make_message(role: ChatRole, content: &str) -> Message {
        Message {
            message_id: MessageId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role,
            content: content.into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: Utc::now(),
        }
    }

    // -----------------------------------------------------------------------
    // convert_messages_to_rich
    // -----------------------------------------------------------------------

    #[test]
    fn convert_empty_messages() {
        let result = convert_messages_to_rich(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn convert_text_only_messages() {
        let messages = vec![
            make_message(ChatRole::User, "Hello"),
            make_message(ChatRole::Assistant, "Hi there"),
        ];
        let rich = convert_messages_to_rich(&messages);
        assert_eq!(rich.len(), 2);
        assert_eq!(rich[0].role, "user");
        assert_eq!(rich[1].role, "assistant");
        match &rich[0].content {
            MessageContent::Text(t) => assert_eq!(t, "Hello"),
            _ => panic!("expected Text content"),
        }
    }

    #[test]
    fn convert_system_message_mapped_to_user() {
        let messages = vec![make_message(ChatRole::System, "system msg")];
        let rich = convert_messages_to_rich(&messages);
        assert!(rich.is_empty(), "System messages should be filtered out");
    }

    #[test]
    fn convert_messages_with_content_blocks() {
        let mut msg = make_message(ChatRole::User, "");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text {
                text: "check this".into(),
            },
            ChatContentBlock::ToolUse {
                id: "t1".into(),
                name: "read_file".into(),
                input: serde_json::json!({"path": "a.rs"}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "file contents".into(),
                is_error: None,
            },
            ChatContentBlock::Image {
                media_type: "image/png".into(),
                data: "base64data".into(),
            },
        ]);

        let rich = convert_messages_to_rich(&[msg]);
        assert_eq!(rich.len(), 1);
        match &rich[0].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 4);
                matches!(&blocks[0], ContentBlock::Text { .. });
                matches!(&blocks[1], ContentBlock::ToolUse { .. });
                matches!(&blocks[2], ContentBlock::ToolResult { .. });
                matches!(&blocks[3], ContentBlock::Image { .. });
            }
            _ => panic!("expected Blocks content"),
        }
    }

    #[test]
    fn convert_filters_out_system_keeps_user_and_assistant() {
        let messages = vec![
            make_message(ChatRole::System, "sys"),
            make_message(ChatRole::User, "u1"),
            make_message(ChatRole::Assistant, "a1"),
            make_message(ChatRole::User, "u2"),
        ];
        let rich = convert_messages_to_rich(&messages);
        assert_eq!(rich.len(), 3);
        assert_eq!(rich[0].role, "user");
        assert_eq!(rich[1].role, "assistant");
        assert_eq!(rich[2].role, "user");
    }

    // -----------------------------------------------------------------------
    // build_chat_system_prompt
    // -----------------------------------------------------------------------

    #[test]
    fn system_prompt_uses_base_when_custom_empty() {
        let project = make_project("TestProj", "/nonexistent/path");
        let prompt = build_chat_system_prompt(&project, "");
        assert!(prompt.starts_with(CHAT_SYSTEM_PROMPT_BASE));
        assert!(prompt.contains("TestProj"));
    }

    #[test]
    fn system_prompt_prepends_custom() {
        let project = make_project("TestProj", "/nonexistent/path");
        let prompt = build_chat_system_prompt(&project, "Custom instructions here.");
        assert!(prompt.starts_with("Custom instructions here."));
        assert!(prompt.contains(CHAT_SYSTEM_PROMPT_BASE));
        assert!(prompt.contains("TestProj"));
    }

    #[test]
    fn system_prompt_includes_project_details() {
        let mut project = make_project("MyApp", "/nonexistent/path");
        project.description = "A web application".into();
        project.build_command = Some("npm run build".into());
        project.test_command = None;

        let prompt = build_chat_system_prompt(&project, "");
        assert!(prompt.contains("MyApp"));
        assert!(prompt.contains("A web application"));
        assert!(prompt.contains("npm run build"));
        assert!(prompt.contains("(not set)"));
    }

    #[test]
    fn system_prompt_detects_tech_stack() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();

        let project = make_project("MultiStack", &dir.path().to_string_lossy());
        let prompt = build_chat_system_prompt(&project, "");
        assert!(prompt.contains("Rust"));
        assert!(prompt.contains("Node.js/TypeScript"));
    }

    #[test]
    fn system_prompt_lists_project_structure() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("README.md"), "# Hi").unwrap();

        let project = make_project("Structured", &dir.path().to_string_lossy());
        let prompt = build_chat_system_prompt(&project, "");
        assert!(prompt.contains("Project Structure"));
        assert!(prompt.contains("src/"));
        assert!(prompt.contains("README.md"));
    }
}
