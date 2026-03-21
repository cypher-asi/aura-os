use aura_core::*;
use aura_storage::StorageMessage;
use chrono::{DateTime, Utc};
use tracing::warn;

use crate::chat::ChatService;
use crate::error::ChatError;

impl ChatService {
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
            for sm in session_msgs.iter().filter(|sm| sm.role.as_deref() != Some("system")) {
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
