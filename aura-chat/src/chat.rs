use std::sync::Arc;

use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::chat_tool_executor::ChatToolExecutor;
use aura_tools::agent_tool_definitions;
use aura_claude::{
    ClaudeClient, ClaudeStreamEvent, ContentBlock, ImageSource, MessageContent, RichMessage,
    ThinkingConfig, ToolDefinition,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use crate::error::ChatError;
use aura_projects::ProjectService;
use aura_specs::{SpecGenerationService, SpecStreamEvent};
use aura_tasks::TaskService;

const CHAT_MAX_TOKENS: u32 = 24_576;
const THINKING_BUDGET: u32 = 10_000;

const CHAT_SYSTEM_PROMPT_BASE: &str = r#"You are Aura, an AI software engineering assistant embedded in a project management and code execution platform.

You have access to tools that let you directly manage the user's project:
- **Specs**: list, create, update, delete technical specifications
- **Tasks**: list, create, update, delete, transition status, trigger execution
- **Sprints**: list, create, update, delete sprint plans
- **Project**: view and update project settings (name, description, build/test commands)
- **Dev Loop**: start, pause, or stop the autonomous development loop
- **Filesystem**: read, write, edit, delete files and list directories in the project folder
- **Search**: search_code for regex pattern search, find_files for glob matching
- **Shell**: run_command to execute build, test, git, or other commands
- **Progress**: view task completion metrics

When the user asks you to create, modify, or manage project artifacts, USE YOUR TOOLS to do it directly rather than just describing what to do. Be proactive -- if the user says "add a task for X", call create_task. If they say "show me the specs", call list_specs.

When creating specs with create_spec:
- Title format: two-digit zero-padded number + colon + space + short name (e.g. "01: Core Domain Types")
- Number specs sequentially based on existing specs (check with list_specs first)
- Do NOT use em dashes (—) in the title

For conversational questions about architecture, debugging, or best practices, respond with helpful text.

Use markdown formatting for code blocks and structured responses. Be concise."#;

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
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    claude_client: Arc<ClaudeClient>,
    spec_gen: Arc<SpecGenerationService>,
    project_service: Arc<ProjectService>,
    task_service: Arc<TaskService>,
}

impl ChatService {
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        claude_client: Arc<ClaudeClient>,
        spec_gen: Arc<SpecGenerationService>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
    ) -> Self {
        Self {
            store,
            settings,
            claude_client,
            spec_gen,
            project_service,
            task_service,
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

        let content_blocks = if attachments.is_empty() {
            None
        } else {
            let mut blocks: Vec<ChatContentBlock> = Vec::new();
            if !content.trim().is_empty() {
                blocks.push(ChatContentBlock::Text {
                    text: content.to_string(),
                });
            }
            for att in attachments.iter() {
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
            if blocks.is_empty() {
                None
            } else {
                Some(blocks)
            }
        };

        let user_msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: *agent_instance_id,
            project_id: *project_id,
            role: ChatRole::User,
            content: content.to_string(),
            content_blocks,
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

        let mut api_messages: Vec<RichMessage> = stored_messages
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
                        .map(|b| match b {
                            ChatContentBlock::Text { text } => ContentBlock::Text {
                                text: text.clone(),
                            },
                            ChatContentBlock::ToolUse { id, name, input } => {
                                ContentBlock::ToolUse {
                                    id: id.clone(),
                                    name: name.clone(),
                                    input: input.clone(),
                                }
                            }
                            ChatContentBlock::ToolResult {
                                tool_use_id,
                                content,
                                is_error,
                            } => ContentBlock::ToolResult {
                                tool_use_id: tool_use_id.clone(),
                                content: content.clone(),
                                is_error: *is_error,
                            },
                            ChatContentBlock::Image { media_type, data } => ContentBlock::Image {
                                source: ImageSource {
                                    source_type: "base64".to_string(),
                                    media_type: media_type.clone(),
                                    data: data.clone(),
                                },
                            },
                        })
                        .collect();
                    RichMessage {
                        role: role.to_string(),
                        content: aura_claude::MessageContent::Blocks(content_blocks),
                    }
                } else {
                    RichMessage {
                        role: role.to_string(),
                        content: aura_claude::MessageContent::Text(m.content.clone()),
                    }
                }
            })
            .collect();

        api_messages = self
            .manage_context_window(&api_key, &system, api_messages)
            .await;

        api_messages = Self::sanitize_orphan_tool_results(api_messages);
        api_messages = Self::sanitize_tool_use_results(api_messages);

        let tools: Vec<ToolDefinition> = agent_tool_definitions();
        let executor = ChatToolExecutor::new(
            self.store.clone(),
            self.project_service.clone(),
            self.task_service.clone(),
        );

        let max_iters = ChatToolExecutor::max_iterations();
        let mut total_text = String::new();
        let mut accumulated_input_tokens: u64 = 0;
        let mut accumulated_output_tokens: u64 = 0;
        let mut specs_created_count: u32 = 0;

        for iteration in 0..max_iters {
            let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

            let client = self.claude_client.clone();
            let api_key_owned = api_key.clone();
            let system_owned = system.clone();
            let msgs_owned = api_messages.clone();
            let tools_owned = tools.clone();

            let stream_handle = tokio::spawn(async move {
                client
                    .complete_stream_with_tools_thinking(
                        &api_key_owned,
                        &system_owned,
                        msgs_owned,
                        tools_owned,
                        CHAT_MAX_TOKENS,
                        ThinkingConfig::enabled(THINKING_BUDGET),
                        claude_tx,
                    )
                    .await
            });

            let mut iter_text = String::new();
            let mut iter_tool_calls: Vec<aura_claude::ToolCall> = Vec::new();

            while let Some(evt) = claude_rx.recv().await {
                match evt {
                    ClaudeStreamEvent::Delta(text) => {
                        iter_text.push_str(&text);
                        let _ = tx.send(ChatStreamEvent::Delta(text));
                    }
                    ClaudeStreamEvent::ToolUse { id, name, input } => {
                        let _ = tx.send(ChatStreamEvent::ToolCall {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });
                        iter_tool_calls.push(aura_claude::ToolCall { id, name, input });
                    }
                    ClaudeStreamEvent::ThinkingDelta(text) => {
                        let _ = tx.send(ChatStreamEvent::ThinkingDelta(text));
                    }
                    ClaudeStreamEvent::Done { stop_reason, .. } => {
                        info!(iteration, stop_reason = %stop_reason, tool_calls = iter_tool_calls.len(), "Chat iteration done");
                    }
                    ClaudeStreamEvent::Error(msg) => {
                        let _ = tx.send(ChatStreamEvent::Error(msg));
                    }
                }
            }

            let stream_result = match stream_handle.await {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    if iter_text.is_empty() && iter_tool_calls.is_empty() {
                        send(ChatStreamEvent::Error(format!("Claude API error: {e}")));
                    }
                    if !total_text.is_empty() && !iter_text.is_empty() {
                        total_text.push_str("\n\n");
                    }
                    total_text.push_str(&iter_text);
                    break;
                }
                Err(e) => {
                    if iter_text.is_empty() && iter_tool_calls.is_empty() {
                        send(ChatStreamEvent::Error(format!("Stream task error: {e}")));
                    }
                    if !total_text.is_empty() && !iter_text.is_empty() {
                        total_text.push_str("\n\n");
                    }
                    total_text.push_str(&iter_text);
                    break;
                }
            };

            accumulated_input_tokens += stream_result.input_tokens;
            accumulated_output_tokens += stream_result.output_tokens;
            let _ = tx.send(ChatStreamEvent::TokenUsage {
                input_tokens: accumulated_input_tokens,
                output_tokens: accumulated_output_tokens,
            });
            if !total_text.is_empty() && !iter_text.is_empty() {
                total_text.push_str("\n\n");
            }
            total_text.push_str(&iter_text);

            if stream_result.stop_reason != "tool_use" || iter_tool_calls.is_empty() {
                break;
            }

            let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
            let mut assistant_persist_blocks: Vec<ChatContentBlock> = Vec::new();
            if !iter_text.is_empty() {
                assistant_blocks.push(ContentBlock::Text {
                    text: iter_text.clone(),
                });
                assistant_persist_blocks.push(ChatContentBlock::Text {
                    text: iter_text.clone(),
                });
            }
            for tc in &iter_tool_calls {
                assistant_blocks.push(ContentBlock::ToolUse {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    input: tc.input.clone(),
                });
                assistant_persist_blocks.push(ChatContentBlock::ToolUse {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    input: tc.input.clone(),
                });
            }
            api_messages.push(RichMessage::assistant_blocks(assistant_blocks));

            let assistant_iter_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *agent_instance_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: String::new(),
                content_blocks: Some(assistant_persist_blocks),
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_message(&assistant_iter_msg) {
                error!(%project_id, error = %e, "Failed to persist assistant tool-use message");
            }

            let tool_futures: Vec<_> = iter_tool_calls.iter().map(|tc| {
                executor.execute(project_id, &tc.name, tc.input.clone())
            }).collect();
            let tool_results = futures::future::join_all(tool_futures).await;

            let mut result_blocks: Vec<ContentBlock> = Vec::new();
            let mut result_persist_blocks: Vec<ChatContentBlock> = Vec::new();
            for (tc, result) in iter_tool_calls.iter().zip(tool_results) {
                if let Some(spec) = result.saved_spec {
                    specs_created_count += 1;
                    let _ = tx.send(ChatStreamEvent::SpecSaved(spec));
                }
                if let Some(task) = result.saved_task {
                    let _ = tx.send(ChatStreamEvent::TaskSaved(task));
                }
                let _ = tx.send(ChatStreamEvent::ToolResult {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    result: result.content.clone(),
                    is_error: result.is_error,
                });
                result_blocks.push(ContentBlock::ToolResult {
                    tool_use_id: tc.id.clone(),
                    content: result.content.clone(),
                    is_error: if result.is_error { Some(true) } else { None },
                });
                result_persist_blocks.push(ChatContentBlock::ToolResult {
                    tool_use_id: tc.id.clone(),
                    content: result.content,
                    is_error: if result.is_error { Some(true) } else { None },
                });
            }
            api_messages.push(RichMessage::tool_results(result_blocks));

            let tool_result_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *agent_instance_id,
                project_id: *project_id,
                role: ChatRole::User,
                content: String::new(),
                content_blocks: Some(result_persist_blocks),
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_message(&tool_result_msg) {
                error!(%project_id, error = %e, "Failed to persist tool result message");
            }

            if iteration + 1 >= max_iters {
                warn!(
                    %project_id,
                    max_iters,
                    "Tool-use loop hit max iterations, stopping"
                );
            }
        }

        if specs_created_count > 0 {
            info!(%project_id, specs_created_count, "Specs created via tool calls, generating project overview");
            let requirements_content: String = stored_messages
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
                .join("\n\n");

            if requirements_content.is_empty() {
                error!(%project_id, "No user message text found for overview generation");
                let _ = tx.send(ChatStreamEvent::Error(
                    "Cannot generate project overview: no requirements text found in chat messages".to_string(),
                ));
            } else {
                info!(%project_id, len = requirements_content.len(), "Generating project overview from user messages");
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

        info!(
            %project_id, %agent_instance_id,
            accumulated_input_tokens, accumulated_output_tokens,
            "Chat loop finished, persisting token usage"
        );
        if accumulated_input_tokens > 0 || accumulated_output_tokens > 0 {
            match self.store.get_agent_instance(project_id, agent_instance_id) {
                Ok(mut instance) => {
                    instance.total_input_tokens += accumulated_input_tokens;
                    instance.total_output_tokens += accumulated_output_tokens;
                    if instance.model.is_none() {
                        instance.model = Some(aura_claude::DEFAULT_MODEL.to_string());
                    }
                    instance.updated_at = Utc::now();
                    if let Err(e) = self.store.put_agent_instance(&instance) {
                        error!(%project_id, %agent_instance_id, error = %e, "Failed to persist token usage on agent instance");
                    } else {
                        info!(
                            %project_id, %agent_instance_id,
                            total_input = instance.total_input_tokens,
                            total_output = instance.total_output_tokens,
                            "Token usage persisted to agent instance"
                        );
                        let _ = tx.send(ChatStreamEvent::AgentInstanceUpdated(instance));
                    }
                }
                Err(e) => {
                    error!(%project_id, %agent_instance_id, error = %e, "Failed to load agent instance for token persistence");
                }
            }
        }

        if !total_text.is_empty() {
            let assistant_reply = total_text.clone();
            let assistant_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *agent_instance_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: total_text,
                content_blocks: None,
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_message(&assistant_msg) {
                error!(%project_id, error = %e, "Failed to save assistant message");
            } else {
                send(ChatStreamEvent::MessageSaved(assistant_msg));
            }

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

    // -----------------------------------------------------------------------
    // Tool-use / tool-result sanitization (Anthropic API requirement)
    // -----------------------------------------------------------------------

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

    fn sanitize_orphan_tool_results(messages: Vec<RichMessage>) -> Vec<RichMessage> {
        let mut result = Vec::with_capacity(messages.len());
        for i in 0..messages.len() {
            let msg = &messages[i];
            let MessageContent::Blocks(blocks) = &msg.content else {
                result.push(msg.clone());
                continue;
            };
            let tool_result_blocks: Vec<_> = blocks
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::ToolResult { .. } => Some(b.clone()),
                    _ => None,
                })
                .collect();
            if tool_result_blocks.is_empty() || msg.role != "user" {
                result.push(msg.clone());
                continue;
            }
            let orig_count = tool_result_blocks.len();
            let valid_ids: std::collections::HashSet<String> = match messages.get(i.wrapping_sub(1)) {
                Some(prev) if prev.role == "assistant" => match &prev.content {
                    MessageContent::Blocks(prev_blocks) => prev_blocks
                        .iter()
                        .filter_map(|b| match b {
                            ContentBlock::ToolUse { id, .. } => Some(id.clone()),
                            _ => None,
                        })
                        .collect(),
                    _ => std::collections::HashSet::new(),
                },
                _ => std::collections::HashSet::new(),
            };
            let kept: Vec<ContentBlock> = tool_result_blocks
                .into_iter()
                .filter_map(|b| match &b {
                    ContentBlock::ToolResult { tool_use_id, .. } if valid_ids.contains(tool_use_id) => {
                        Some(b)
                    }
                    ContentBlock::ToolResult { tool_use_id, .. } => {
                        warn!(tool_use_id, "Dropping orphan tool_result");
                        None
                    }
                    _ => None,
                })
                .collect();
            let other_blocks: Vec<ContentBlock> = blocks
                .iter()
                .filter(|b| !matches!(b, ContentBlock::ToolResult { .. }))
                .cloned()
                .collect();
            if kept.is_empty() && other_blocks.is_empty() {
                let preview: String = blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::ToolResult { content, .. } => Some(content.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(200)
                    .collect();
                warn!(preview = %preview, "Converting orphan tool_result message to text");
                result.push(RichMessage::user(&format!(
                    "[Previous tool result was lost due to context: {}]",
                    preview
                )));
            } else if kept.len() != orig_count {
                let mut new_blocks = other_blocks;
                new_blocks.extend(kept);
                result.push(RichMessage {
                    role: "user".into(),
                    content: MessageContent::Blocks(new_blocks),
                });
            } else {
                result.push(msg.clone());
            }
        }
        result
    }

    fn sanitize_tool_use_results(messages: Vec<RichMessage>) -> Vec<RichMessage> {
        let mut result = Vec::with_capacity(messages.len() + 16);
        let mut i = 0;
        while i < messages.len() {
            let msg = &messages[i];
            let tool_use_ids: Vec<String> = match &msg.content {
                MessageContent::Blocks(blocks) => blocks
                    .iter()
                    .filter_map(|b| match b {
                        ContentBlock::ToolUse { id, .. } => Some(id.clone()),
                        _ => None,
                    })
                    .collect(),
                MessageContent::Text(_) => vec![],
            };

            result.push(msg.clone());

            if tool_use_ids.is_empty() {
                i += 1;
                continue;
            }

            let next = messages.get(i + 1);
            let existing_ids: std::collections::HashSet<String> = match next {
                Some(m) if m.role == "user" => match &m.content {
                    MessageContent::Blocks(blocks) => blocks
                        .iter()
                        .filter_map(|b| match b {
                            ContentBlock::ToolResult { tool_use_id, .. } => Some(tool_use_id.clone()),
                            _ => None,
                        })
                        .collect(),
                    _ => std::collections::HashSet::new(),
                },
                _ => std::collections::HashSet::new(),
            };

            let missing: Vec<String> = tool_use_ids
                .into_iter()
                .filter(|id| !existing_ids.contains(id))
                .collect();

            if !missing.is_empty() {
                warn!(
                    orphaned_count = missing.len(),
                    ids = ?missing,
                    "Adding synthetic tool_result for orphaned tool_use"
                );
                let synthetic: Vec<ContentBlock> = missing
                    .into_iter()
                    .map(|tool_use_id| ContentBlock::ToolResult {
                        tool_use_id: tool_use_id.clone(),
                        content: "Tool execution was interrupted or not completed."
                            .to_string(),
                        is_error: Some(true),
                    })
                    .collect();

                if let Some(m) = next {
                    if m.role == "user" {
                        if let MessageContent::Blocks(blocks) = &m.content {
                            let mut merged = blocks.clone();
                            for b in &synthetic {
                                merged.push(b.clone());
                            }
                            result.push(RichMessage {
                                role: "user".into(),
                                content: MessageContent::Blocks(merged),
                            });
                            i += 2;
                            continue;
                        }
                    }
                }
                result.push(RichMessage::tool_results(synthetic));
            }
            i += 1;
        }
        result
    }

    // Context window management
    // -----------------------------------------------------------------------

    const MAX_CONTEXT_TOKENS: u64 = 150_000;
    const KEEP_RECENT_MESSAGES: usize = 10;

    async fn manage_context_window(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
    ) -> Vec<RichMessage> {
        use aura_claude::estimate_message_tokens;

        let system_tokens = aura_claude::estimate_tokens(system_prompt);
        let total_msg_tokens: u64 = messages.iter().map(|m| estimate_message_tokens(m)).sum();
        let total = system_tokens + total_msg_tokens;

        if total <= Self::MAX_CONTEXT_TOKENS || messages.len() <= Self::KEEP_RECENT_MESSAGES {
            return messages;
        }

        info!(
            total_tokens = total,
            message_count = messages.len(),
            "Context window approaching limit, summarizing older messages"
        );

        let mut split_at = messages.len().saturating_sub(Self::KEEP_RECENT_MESSAGES);
        while split_at > 0 && Self::is_tool_results_only(&messages[split_at]) {
            split_at -= 1;
        }
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
            .claude_client
            .complete(api_key, "You summarize conversations concisely.", &summary_input, 1024)
            .await
        {
            Ok(summary) => {
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
            .claude_client
            .complete(api_key, "You generate short chat titles.", &title_prompt, 30)
            .await
        {
            Ok(title) => {
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
                        instance.model = Some(aura_claude::DEFAULT_MODEL.to_string());
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
