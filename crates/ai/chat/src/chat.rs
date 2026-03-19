use std::sync::{Arc, Mutex};

use chrono::Utc;
use tokio::sync::mpsc;

use aura_core::*;
use aura_billing::MeteredLlm;
use aura_settings::SettingsService;
use aura_storage::StorageClient;
use aura_store::RocksStore;
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

    /// Save a message to aura-storage via the latest active session.
    /// Fire-and-forget: logs a warning on failure but does not propagate errors.
    pub(crate) async fn save_message_to_storage(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        role: &str,
        content: &str,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    ) {
        let Some(ref storage) = self.storage_client else { return };
        let Some(jwt) = self.get_jwt() else { return };

        let sessions = storage
            .list_sessions(&agent_instance_id.to_string(), &jwt)
            .await
            .unwrap_or_default();
        let active_session = sessions
            .iter()
            .find(|s| s.status.as_deref() == Some("active"));
        let Some(session) = active_session else { return };

        let req = aura_storage::CreateMessageRequest {
            project_agent_id: agent_instance_id.to_string(),
            project_id: project_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            input_tokens,
            output_tokens,
        };

        if let Err(e) = storage.create_message(&session.id, &jwt, &req).await {
            warn!(
                %project_id, %agent_instance_id,
                error = %e,
                "Failed to save message to aura-storage"
            );
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
        self.save_message_to_storage(project_id, agent_instance_id, "user", content, None, None)
            .await;

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
        // Agent-level messages use dummy IDs; no StorageClient write
        // (aura-storage scopes messages by session, not agent)

        self.handle_agent_chat_with_tools(agent_id, agent, projects, &tx)
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
