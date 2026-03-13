use std::sync::Arc;

use chrono::Utc;
use tokio::sync::mpsc;
use tracing::{error, info};

use aura_core::*;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::claude::{ClaudeClient, ClaudeStreamEvent};
use crate::error::ChatError;
use crate::spec_gen::{SpecGenerationService, SpecStreamEvent};

const CHAT_MAX_TOKENS: u32 = 16384;

const CHAT_SYSTEM_PROMPT: &str = r#"You are Aura, an AI software engineering assistant. You help users plan, design, and build software projects.

You have context about the user's project and can answer questions about architecture, implementation, debugging, and best practices. Be concise and helpful. Use markdown formatting for code blocks and structured responses."#;

#[derive(Debug, Clone)]
pub enum ChatStreamEvent {
    Delta(String),
    SpecSaved(Spec),
    TaskSaved(Task),
    MessageSaved(ChatMessage),
    TitleUpdated(ChatSession),
    Error(String),
    Done,
}

pub struct ChatService {
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    claude_client: Arc<ClaudeClient>,
    spec_gen: Arc<SpecGenerationService>,
}

impl ChatService {
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        claude_client: Arc<ClaudeClient>,
        spec_gen: Arc<SpecGenerationService>,
    ) -> Self {
        Self {
            store,
            settings,
            claude_client,
            spec_gen,
        }
    }

    pub fn create_session(
        &self,
        project_id: &ProjectId,
        title: &str,
    ) -> Result<ChatSession, ChatError> {
        let now = Utc::now();
        let session = ChatSession {
            chat_session_id: ChatSessionId::new(),
            project_id: *project_id,
            title: title.to_string(),
            created_at: now,
            updated_at: now,
        };
        self.store.put_chat_session(&session)?;
        info!(%project_id, session_id = %session.chat_session_id, "Chat session created");
        Ok(session)
    }

    pub fn update_session_title(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
        title: &str,
    ) -> Result<ChatSession, ChatError> {
        let mut session = self.store.get_chat_session(project_id, chat_session_id)?;
        session.title = title.to_string();
        session.updated_at = Utc::now();
        self.store.put_chat_session(&session)?;
        info!(%project_id, %chat_session_id, title, "Chat session title updated");
        Ok(session)
    }

    pub fn list_sessions(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<ChatSession>, ChatError> {
        let mut sessions = self.store.list_chat_sessions(project_id)?;
        sessions.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(sessions)
    }

    pub fn delete_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> Result<(), ChatError> {
        self.store
            .delete_chat_messages_by_session(project_id, chat_session_id)?;
        self.store
            .delete_chat_session(project_id, chat_session_id)?;
        info!(%project_id, %chat_session_id, "Chat session deleted");
        Ok(())
    }

    pub fn list_messages(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> Result<Vec<ChatMessage>, ChatError> {
        let mut messages = self
            .store
            .list_chat_messages(project_id, chat_session_id)?;
        messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(messages)
    }

    pub async fn send_message_streaming(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
        content: &str,
        action: Option<&str>,
        tx: mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let send = |evt: ChatStreamEvent| {
            let _ = tx.send(evt);
        };

        let now = Utc::now();
        let user_msg = ChatMessage {
            message_id: ChatMessageId::new(),
            chat_session_id: *chat_session_id,
            project_id: *project_id,
            role: ChatRole::User,
            content: content.to_string(),
            created_at: now,
        };
        if let Err(e) = self.store.put_chat_message(&user_msg) {
            send(ChatStreamEvent::Error(format!("Failed to save user message: {e}")));
            send(ChatStreamEvent::Done);
            return;
        }

        match action {
            Some("generate_specs") => {
                self.handle_generate_specs(project_id, chat_session_id, &tx)
                    .await;
            }
            _ => {
                self.handle_chat(project_id, chat_session_id, &tx).await;
            }
        }

        send(ChatStreamEvent::Done);
    }

    async fn handle_chat(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
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

        let messages = match self.list_messages(project_id, chat_session_id) {
            Ok(m) => m,
            Err(e) => {
                send(ChatStreamEvent::Error(format!("Failed to load messages: {e}")));
                return;
            }
        };

        let project_context = match self.store.get_project(project_id) {
            Ok(p) => format!(
                "Project: {}\nDescription: {}\nFolder: {}",
                p.name, p.description, p.linked_folder_path
            ),
            Err(_) => String::new(),
        };

        let system = format!("{CHAT_SYSTEM_PROMPT}\n\n{project_context}");

        let api_messages: Vec<(String, String)> = messages
            .iter()
            .filter(|m| m.role == ChatRole::User || m.role == ChatRole::Assistant)
            .map(|m| {
                let role = match m.role {
                    ChatRole::User => "user",
                    ChatRole::Assistant => "assistant",
                    ChatRole::System => "user",
                };
                (role.to_string(), m.content.clone())
            })
            .collect();

        let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

        let client = self.claude_client.clone();
        let api_key_owned = api_key;
        let system_owned = system;
        let stream_handle = tokio::spawn(async move {
            client
                .complete_stream_multi(
                    &api_key_owned,
                    &system_owned,
                    api_messages,
                    CHAT_MAX_TOKENS,
                    claude_tx,
                )
                .await
        });

        let mut accumulated = String::new();

        while let Some(evt) = claude_rx.recv().await {
            match evt {
                ClaudeStreamEvent::Delta(text) => {
                    accumulated.push_str(&text);
                    let _ = tx.send(ChatStreamEvent::Delta(text));
                }
                ClaudeStreamEvent::Done { .. } => {}
                ClaudeStreamEvent::Error(msg) => {
                    let _ = tx.send(ChatStreamEvent::Error(msg));
                }
            }
        }

        match stream_handle.await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                if accumulated.is_empty() {
                    send(ChatStreamEvent::Error(format!("Claude API error: {e}")));
                    return;
                }
            }
            Err(e) => {
                if accumulated.is_empty() {
                    send(ChatStreamEvent::Error(format!("Stream task error: {e}")));
                    return;
                }
            }
        }

        if !accumulated.is_empty() {
            let assistant_reply = accumulated.clone();
            let assistant_msg = ChatMessage {
                message_id: ChatMessageId::new(),
                chat_session_id: *chat_session_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: accumulated,
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_chat_message(&assistant_msg) {
                error!(%project_id, error = %e, "Failed to save assistant message");
            } else {
                send(ChatStreamEvent::MessageSaved(assistant_msg));
            }

            self.maybe_generate_title(
                project_id,
                chat_session_id,
                &api_key,
                &messages,
                &assistant_reply,
                tx,
            )
            .await;
        }
    }

    async fn maybe_generate_title(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
        api_key: &str,
        messages: &[ChatMessage],
        assistant_reply: &str,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let session = match self.store.get_chat_session(project_id, chat_session_id) {
            Ok(s) => s,
            Err(_) => return,
        };
        if session.title != "New Chat" {
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
                match self.update_session_title(project_id, chat_session_id, &title) {
                    Ok(updated) => {
                        let _ = tx.send(ChatStreamEvent::TitleUpdated(updated));
                    }
                    Err(e) => {
                        error!(%project_id, error = %e, "Failed to update session title");
                    }
                }
            }
            Err(e) => {
                error!(%project_id, error = %e, "Failed to generate session title");
            }
        }
    }

    async fn handle_generate_specs(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
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

        while let Some(evt) = spec_rx.recv().await {
            match evt {
                SpecStreamEvent::Delta(text) => {
                    accumulated.push_str(&text);
                    let _ = tx.send(ChatStreamEvent::Delta(text));
                }
                SpecStreamEvent::SpecSaved(spec) => {
                    let _ = tx.send(ChatStreamEvent::SpecSaved(spec));
                }
                SpecStreamEvent::TaskSaved(task) => {
                    let _ = tx.send(ChatStreamEvent::TaskSaved(task));
                }
                SpecStreamEvent::Error(msg) => {
                    let _ = tx.send(ChatStreamEvent::Error(msg));
                }
                SpecStreamEvent::Complete(_) => {}
                SpecStreamEvent::Progress(_) | SpecStreamEvent::Generating { .. } => {}
            }
        }

        if !accumulated.is_empty() {
            let assistant_msg = ChatMessage {
                message_id: ChatMessageId::new(),
                chat_session_id: *chat_session_id,
                project_id: *project_id,
                role: ChatRole::Assistant,
                content: accumulated,
                created_at: Utc::now(),
            };
            if let Err(e) = self.store.put_chat_message(&assistant_msg) {
                error!(%project_id, error = %e, "Failed to save spec gen assistant message");
            } else {
                send(ChatStreamEvent::MessageSaved(assistant_msg));
            }
        }
    }
}
