use std::sync::{Arc, Mutex};

use chrono::Utc;
use tokio::sync::mpsc;

use aura_core::*;
use aura_billing::MeteredLlm;
use aura_settings::SettingsService;
use aura_storage::{StorageClient, StorageMessage};
use aura_store::RocksStore;
use chrono::DateTime;
use tracing::warn;

use aura_claude::{
    ContentBlock, ImageSource, MessageContent, RichMessage,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use crate::error::ChatError;
use aura_projects::ProjectService;
use aura_specs::SpecGenerationService;
use aura_tasks::TaskService;
use crate::tool_loop::ToolLoopEvent;

pub(crate) fn convert_messages_to_rich(messages: &[Message]) -> Vec<RichMessage> {
    messages
        .iter()
        .filter(|m| m.role == ChatRole::User || m.role == ChatRole::Assistant)
        .flat_map(|m| {
            let role = match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
                ChatRole::System => "user",
            };
            if let Some(blocks) = &m.content_blocks {
                let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
                let mut tool_result_blocks: Vec<ContentBlock> = Vec::new();

                for b in blocks {
                    match b {
                        ChatContentBlock::Text { text } => {
                            assistant_blocks.push(ContentBlock::Text {
                                text: text.clone(),
                            });
                        }
                        ChatContentBlock::ToolUse { id, name, input } => {
                            assistant_blocks.push(ContentBlock::ToolUse {
                                id: id.clone(),
                                name: name.clone(),
                                input: input.clone(),
                            });
                        }
                        ChatContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            is_error,
                        } => {
                            let block = ContentBlock::ToolResult {
                                tool_use_id: tool_use_id.clone(),
                                content: content.clone(),
                                is_error: *is_error,
                            };
                            if role == "assistant" {
                                tool_result_blocks.push(block);
                            } else {
                                assistant_blocks.push(block);
                            }
                        }
                        ChatContentBlock::Image { media_type, data } => {
                            assistant_blocks.push(ContentBlock::Image {
                                source: ImageSource {
                                    source_type: "base64".to_string(),
                                    media_type: media_type.clone(),
                                    data: data.clone(),
                                },
                            });
                        }
                        ChatContentBlock::TaskRef { .. } | ChatContentBlock::SpecRef { .. } => {}
                    }
                }

                let mut result = vec![RichMessage {
                    role: role.to_string(),
                    content: MessageContent::Blocks(assistant_blocks),
                }];
                if !tool_result_blocks.is_empty() {
                    result.push(RichMessage {
                        role: "user".to_string(),
                        content: MessageContent::Blocks(tool_result_blocks),
                    });
                }
                result
            } else {
                vec![RichMessage {
                    role: role.to_string(),
                    content: MessageContent::Text(m.content.clone()),
                }]
            }
        })
        .collect()
}

pub(crate) type ContentBlockAccumulator = Arc<Mutex<Vec<ChatContentBlock>>>;

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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatAttachment {
    #[serde(rename = "type")]
    pub type_: String,
    pub media_type: String,
    pub data: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ChatStreamEvent {
    Delta(String),
    ThinkingDelta(String),
    Progress(String),
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

pub struct ChatService {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) llm: Arc<MeteredLlm>,
    pub(crate) spec_gen: Arc<SpecGenerationService>,
    pub(crate) project_service: Arc<ProjectService>,
    pub(crate) task_service: Arc<TaskService>,
    pub(crate) storage_client: Option<Arc<StorageClient>>,
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
        storage_client: Option<Arc<StorageClient>>,
    ) -> Self {
        Self::with_config(store, settings, llm, spec_gen, project_service, task_service, storage_client, LlmConfig::from_env())
    }

    pub fn with_config(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
        spec_gen: Arc<SpecGenerationService>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
        storage_client: Option<Arc<StorageClient>>,
        llm_config: LlmConfig,
    ) -> Self {
        Self {
            store,
            settings,
            llm,
            spec_gen,
            project_service,
            task_service,
            storage_client,
            llm_config,
        }
    }

    pub(crate) fn get_jwt(&self) -> Option<String> {
        let bytes = self.store.get_setting("zero_auth_session").ok()?;
        let session: ZeroAuthSession = serde_json::from_slice(&bytes).ok()?;
        Some(session.access_token)
    }

    /// Resolve the active session ID for a given agent instance.
    pub(crate) async fn find_active_session_id(
        &self,
        agent_instance_id: &AgentInstanceId,
    ) -> Option<String> {
        let storage = self.storage_client.as_ref()?;
        let jwt = self.get_jwt()?;
        let sessions = storage
            .list_sessions(&agent_instance_id.to_string(), &jwt)
            .await
            .ok()?;
        sessions
            .iter()
            .find(|s| s.status.as_deref() == Some("active"))
            .map(|s| s.id.clone())
    }

    /// Ensure an active session exists for this project agent; create one if not.
    /// Returns the session id to use for saving messages, or None if storage is unavailable.
    pub(crate) async fn ensure_active_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Option<String> {
        if let Some(sid) = self.find_active_session_id(agent_instance_id).await {
            return Some(sid);
        }
        let storage = self.storage_client.as_ref()?;
        let jwt = self.get_jwt()?;
        let req = aura_storage::CreateSessionRequest {
            project_id: project_id.to_string(),
            status: Some("active".to_string()),
            context_usage_estimate: None,
            summary_of_previous_context: None,
        };
        let session = storage
            .create_session(&agent_instance_id.to_string(), &jwt, &req)
            .await
            .ok()?;
        Some(session.id)
    }

    /// Update the session's `context_usage_estimate` in aura-storage after a chat turn.
    /// Fire-and-forget: logs a warning on failure.
    pub(crate) async fn update_session_context_usage(
        &self,
        session_id: &str,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        let Some(ref storage) = self.storage_client else { return };
        let Some(jwt) = self.get_jwt() else { return };

        let current = match storage.get_session(session_id, &jwt).await {
            Ok(s) => s.context_usage_estimate.unwrap_or(0.0),
            Err(e) => {
                warn!(error = %e, "Failed to get session for context usage update");
                return;
            }
        };
        let turn_usage =
            (input_tokens + output_tokens) as f64 / self.llm_config.max_context_tokens as f64;
        let new_estimate = (current + turn_usage).min(1.0);

        let req = aura_storage::UpdateSessionRequest {
            status: None,
            context_usage_estimate: Some(new_estimate),
            ended_at: None,
        };
        if let Err(e) = storage.update_session(session_id, &jwt, &req).await {
            warn!(error = %e, "Failed to update session context usage");
        }
    }

    /// Save a message to aura-storage.
    /// Fire-and-forget: logs a warning on failure but does not propagate errors.
    /// When `session_id` is provided, skips the session lookup HTTP call.
    pub(crate) async fn save_message_to_storage(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        role: &str,
        content: &str,
        content_blocks: Option<&[ChatContentBlock]>,
        thinking: Option<&str>,
        thinking_duration_ms: Option<u64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        session_id: Option<&str>,
    ) {
        let Some(ref storage) = self.storage_client else { return };
        let Some(jwt) = self.get_jwt() else { return };

        let owned_session_id;
        let sid = match session_id {
            Some(id) => id,
            None => match self.find_active_session_id(agent_instance_id).await {
                Some(id) => {
                    owned_session_id = id;
                    &owned_session_id
                }
                None => {
                    warn!(
                        %project_id, %agent_instance_id,
                        "No active session found, cannot save message to aura-storage"
                    );
                    return;
                }
            },
        };

        let encoded_content = crate::message_metadata::encode_message_content(
            content,
            content_blocks,
            thinking,
            thinking_duration_ms,
        );

        let req = aura_storage::CreateMessageRequest {
            project_agent_id: agent_instance_id.to_string(),
            project_id: project_id.to_string(),
            role: role.to_string(),
            content: encoded_content,
            input_tokens,
            output_tokens,
        };

        if let Err(e) = storage.create_message(sid, &jwt, &req).await {
            warn!(
                %project_id, %agent_instance_id,
                error = %e,
                "Failed to save message to aura-storage"
            );
        }
    }

    fn storage_message_to_message(
        sm: &StorageMessage,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
    ) -> Message {
        let message_id = sm
            .id
            .parse::<MessageId>()
            .unwrap_or_else(|_| MessageId::new());
        let role = match sm.role.as_deref() {
            Some("user") => ChatRole::User,
            Some("assistant") => ChatRole::Assistant,
            _ => ChatRole::User,
        };
        let created_at = sm
            .created_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);
        let raw = sm.content.clone().unwrap_or_default();
        let decoded = crate::message_metadata::decode_message_content(&raw);
        Message {
            message_id,
            agent_instance_id,
            project_id,
            role,
            content: decoded.text,
            content_blocks: decoded.content_blocks,
            thinking: decoded.thinking,
            thinking_duration_ms: decoded.thinking_duration_ms,
            created_at,
        }
    }

    /// List project-scoped messages from aura-storage only (no local store).
    /// Returns error if storage is not configured.
    pub(crate) async fn list_messages_async(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Vec<Message>, ChatError> {
        let storage = self.storage_client.as_ref().ok_or_else(|| {
            ChatError::Storage(aura_storage::StorageError::NotConfigured)
        })?;
        let jwt = self.get_jwt().ok_or_else(|| {
            ChatError::Storage(aura_storage::StorageError::Deserialize(
                "not authenticated".to_string(),
            ))
        })?;
        let sessions = storage
            .list_sessions(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(ChatError::Storage)?;
        let mut messages = Vec::new();
        for session in &sessions {
            let session_msgs = storage
                .list_messages(&session.id, &jwt, None, None)
                .await
                .map_err(ChatError::Storage)?;
            for sm in &session_msgs {
                messages.push(Self::storage_message_to_message(
                    sm,
                    *project_id,
                    *agent_instance_id,
                ));
            }
        }
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

        let _content_blocks = build_attachment_blocks(content, attachments);

        let active_session_id = self
            .ensure_active_session(project_id, agent_instance_id)
            .await;
        let Some(ref session_id) = active_session_id else {
            send(ChatStreamEvent::Error(
                "aura-storage is not configured or could not create session".to_string(),
            ));
            send(ChatStreamEvent::Done);
            return;
        };
        self.save_message_to_storage(
            project_id,
            agent_instance_id,
            "user",
            content,
            _content_blocks.as_deref(),
            None,
            None,
            None,
            None,
            Some(session_id.as_str()),
        )
        .await;

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

    // -- Agent-level streaming (multi-project) ---------------------------------
    // Messages are from aura-storage aggregate only; current user message is in-memory for this turn (no agent-level message API yet).

    pub async fn send_agent_message_streaming(
        &self,
        agent_id: &AgentId,
        agent: &Agent,
        projects: &[Project],
        storage_messages: Vec<Message>,
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

        let mut messages_for_context = storage_messages;
        messages_for_context.push(user_msg);

        self.handle_agent_chat_with_tools(agent_id, agent, projects, messages_for_context, &tx)
            .await;

        send(ChatStreamEvent::Done);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

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
    fn convert_splits_tool_results_from_assistant_message() {
        let mut msg = make_message(ChatRole::Assistant, "");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text {
                text: "I'll read the file".into(),
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
        ]);

        let rich = convert_messages_to_rich(&[msg]);
        assert_eq!(rich.len(), 2, "assistant msg with ToolResult should split into 2 messages");
        assert_eq!(rich[0].role, "assistant");
        assert_eq!(rich[1].role, "user");
        match &rich[0].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 2);
                assert!(matches!(&blocks[0], ContentBlock::Text { .. }));
                assert!(matches!(&blocks[1], ContentBlock::ToolUse { .. }));
            }
            _ => panic!("expected Blocks content for assistant"),
        }
        match &rich[1].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                assert!(matches!(&blocks[0], ContentBlock::ToolResult { .. }));
            }
            _ => panic!("expected Blocks content for tool_results user msg"),
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
}
