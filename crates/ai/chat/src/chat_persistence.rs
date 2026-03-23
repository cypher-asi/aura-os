use aura_core::*;
use aura_storage::StorageMessage;
use chrono::{DateTime, Utc};
use tracing::warn;

use crate::chat::ChatService;
use crate::error::ChatError;

pub(crate) struct SaveMessageParams<'a> {
    pub project_id: &'a ProjectId,
    pub agent_instance_id: &'a AgentInstanceId,
    pub role: &'a str,
    pub content: &'a str,
    pub content_blocks: Option<&'a [ChatContentBlock]>,
    pub thinking: Option<&'a str>,
    pub thinking_duration_ms: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub session_id: Option<&'a str>,
}

impl ChatService {
    /// Save a message to aura-storage.
    /// Fire-and-forget: logs a warning on failure but does not propagate errors.
    /// When `session_id` is provided, skips the session lookup HTTP call.
    pub(crate) async fn save_message_to_storage(&self, params: SaveMessageParams<'_>) {
        let SaveMessageParams {
            project_id,
            agent_instance_id,
            role,
            content,
            content_blocks,
            thinking,
            thinking_duration_ms,
            input_tokens,
            output_tokens,
            session_id,
        } = params;

        let Some(ref storage) = self.storage_client else {
            return;
        };
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

        let serialized_blocks = content_blocks.and_then(|blocks| {
            if blocks.is_empty() {
                return None;
            }
            blocks
                .iter()
                .map(|b| serde_json::to_value(b).ok())
                .collect::<Option<Vec<_>>>()
        });

        let req = aura_storage::CreateMessageRequest {
            project_agent_id: agent_instance_id.to_string(),
            project_id: project_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            content_blocks: serialized_blocks,
            input_tokens,
            output_tokens,
            thinking: thinking.map(|t| t.to_string()),
            thinking_duration_ms,
        };

        if let Err(e) = storage.create_message(sid, &jwt, &req).await {
            warn!(
                %project_id, %agent_instance_id,
                error = %e,
                "Failed to save message to aura-storage"
            );
        }
    }

    pub(crate) fn storage_message_to_message(
        sm: &StorageMessage,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
    ) -> Message {
        let message_id = sm.id.parse::<MessageId>().unwrap_or_else(|e| {
            warn!(raw_id = %sm.id, error = %e, "Generating new MessageId for unparseable storage ID");
            MessageId::new()
        });
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
        let has_native_fields = sm.content_blocks.is_some()
            || sm.thinking.is_some()
            || sm.thinking_duration_ms.is_some();

        if has_native_fields {
            let content_blocks = sm.content_blocks.as_ref().and_then(|vals| {
                let blocks: Vec<ChatContentBlock> = vals
                    .iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect();
                if blocks.is_empty() {
                    None
                } else {
                    Some(blocks)
                }
            });
            Message {
                message_id,
                agent_instance_id,
                project_id,
                role,
                content: sm.content.clone().unwrap_or_default(),
                content_blocks,
                thinking: sm.thinking.clone(),
                thinking_duration_ms: sm.thinking_duration_ms,
                created_at,
            }
        } else {
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
    }

    /// List project-scoped messages from aura-storage only (no local store).
    /// Returns error if storage is not configured.
    pub(crate) async fn list_messages_async(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Vec<Message>, ChatError> {
        let storage = self
            .storage_client
            .as_ref()
            .ok_or_else(|| ChatError::Storage(aura_storage::StorageError::NotConfigured))?;
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
            for sm in session_msgs
                .iter()
                .filter(|sm| sm.role.as_deref() != Some("system"))
            {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_storage::StorageMessage;

    fn make_storage_msg(overrides: impl FnOnce(&mut StorageMessage)) -> StorageMessage {
        let mut sm = StorageMessage {
            id: MessageId::new().to_string(),
            session_id: None,
            project_agent_id: None,
            project_id: None,
            role: None,
            content: None,
            content_blocks: None,
            input_tokens: None,
            output_tokens: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: None,
        };
        overrides(&mut sm);
        sm
    }

    #[test]
    fn storage_message_to_message_basic() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let sm = make_storage_msg(|sm| {
            sm.session_id = Some("s1".into());
            sm.project_agent_id = Some(aid.to_string());
            sm.project_id = Some(pid.to_string());
            sm.role = Some("user".into());
            sm.content = Some("Hello world".into());
            sm.input_tokens = Some(100);
            sm.output_tokens = Some(50);
            sm.created_at = Some("2024-01-15T10:30:00Z".into());
        });

        let msg = ChatService::storage_message_to_message(&sm, pid, aid);

        assert_eq!(msg.role, ChatRole::User);
        assert_eq!(msg.content, "Hello world");
        assert_eq!(msg.project_id, pid);
        assert_eq!(msg.agent_instance_id, aid);
        assert!(msg.thinking.is_none());
        assert!(msg.content_blocks.is_none());
    }

    #[test]
    fn storage_message_to_message_assistant_role() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let sm = make_storage_msg(|sm| {
            sm.role = Some("assistant".into());
            sm.content = Some("I can help".into());
        });

        let msg = ChatService::storage_message_to_message(&sm, pid, aid);
        assert_eq!(msg.role, ChatRole::Assistant);
        assert_eq!(msg.content, "I can help");
    }

    #[test]
    fn storage_message_native_fields() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let sm = make_storage_msg(|sm| {
            sm.role = Some("assistant".into());
            sm.content = Some("main text".into());
            sm.content_blocks = Some(vec![
                serde_json::json!({"type": "text", "text": "check this"}),
                serde_json::json!({"type": "tool_use", "id": "t1", "name": "read_file", "input": {"path": "a.rs"}}),
            ]);
            sm.thinking = Some("thinking...".into());
            sm.thinking_duration_ms = Some(1500);
            sm.created_at = Some("2024-06-01T12:00:00Z".into());
        });

        let msg = ChatService::storage_message_to_message(&sm, pid, aid);
        assert_eq!(msg.content, "main text");
        assert_eq!(msg.content_blocks.as_ref().unwrap().len(), 2);
        assert_eq!(msg.thinking.as_deref(), Some("thinking..."));
        assert_eq!(msg.thinking_duration_ms, Some(1500));
    }

    #[test]
    fn storage_message_legacy_encoded_content_fallback() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let blocks = vec![
            ChatContentBlock::Text {
                text: "check this".into(),
            },
            ChatContentBlock::ToolUse {
                id: "t1".into(),
                name: "read_file".into(),
                input: serde_json::json!({"path": "a.rs"}),
            },
        ];
        let encoded = crate::message_metadata::encode_message_content(
            "main text",
            Some(&blocks),
            Some("thinking..."),
            Some(1500),
        );
        let sm = make_storage_msg(|sm| {
            sm.role = Some("assistant".into());
            sm.content = Some(encoded);
            sm.created_at = Some("2024-06-01T12:00:00Z".into());
        });

        let msg = ChatService::storage_message_to_message(&sm, pid, aid);
        assert_eq!(msg.content, "main text");
        assert_eq!(msg.content_blocks.as_ref().unwrap().len(), 2);
        assert_eq!(msg.thinking.as_deref(), Some("thinking..."));
        assert_eq!(msg.thinking_duration_ms, Some(1500));
    }

    #[test]
    fn storage_message_to_message_missing_fields_use_defaults() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let mut sm = make_storage_msg(|_| {});
        sm.id = "not-a-valid-uuid".into();

        let msg = ChatService::storage_message_to_message(&sm, pid, aid);
        assert_eq!(msg.role, ChatRole::User);
        assert_eq!(msg.content, "");
        assert!(msg.thinking.is_none());
        assert!(msg.content_blocks.is_none());
    }

    #[test]
    fn storage_message_to_message_unknown_role_defaults_to_user() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let sm = make_storage_msg(|sm| {
            sm.role = Some("system".into());
            sm.content = Some("test".into());
        });

        let msg = ChatService::storage_message_to_message(&sm, pid, aid);
        assert_eq!(msg.role, ChatRole::User);
    }

    #[test]
    fn storage_message_to_message_invalid_date_uses_now() {
        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let sm = make_storage_msg(|sm| {
            sm.role = Some("user".into());
            sm.content = Some("test".into());
            sm.created_at = Some("not-a-date".into());
        });

        let before = chrono::Utc::now();
        let msg = ChatService::storage_message_to_message(&sm, pid, aid);
        let after = chrono::Utc::now();
        assert!(msg.created_at >= before && msg.created_at <= after);
    }
}
