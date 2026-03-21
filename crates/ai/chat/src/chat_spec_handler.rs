use chrono::Utc;
use tokio::sync::mpsc;
use tracing::info;

use aura_core::*;
use aura_specs::SpecStreamEvent;

use crate::channel_ext::send_or_log;
use crate::chat::{ChatService, ChatStreamEvent};

impl ChatService {
    pub(crate) async fn handle_generate_specs(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        _agent_instance: &AgentInstance,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
        active_session_id: Option<&str>,
    ) {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel::<SpecStreamEvent>();

        let spec_gen = self.spec_gen.clone();
        let pid = *project_id;
        tokio::spawn(async move {
            spec_gen.generate_specs_streaming(&pid, spec_tx).await;
        });

        let (accumulated, spec_input_tokens, spec_output_tokens) =
            drain_spec_events(&mut spec_rx, tx).await;

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
            self.save_spec_assistant_message(
                project_id, agent_instance_id, &accumulated,
                spec_input_tokens, spec_output_tokens,
                tx, active_session_id,
            ).await;
        }
    }

    async fn save_spec_assistant_message(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        accumulated: &str,
        input_tokens: u64,
        output_tokens: u64,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
        active_session_id: Option<&str>,
    ) {
        let assistant_msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: *agent_instance_id,
            project_id: *project_id,
            role: ChatRole::Assistant,
            content: accumulated.to_string(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: Utc::now(),
        };
        send_or_log(tx, ChatStreamEvent::MessageSaved(assistant_msg));
        self.save_message_to_storage(
            project_id, agent_instance_id, "assistant", accumulated,
            None, None, None,
            Some(input_tokens), Some(output_tokens),
            active_session_id,
        ).await;

        if let Some(sid) = active_session_id {
            self.update_session_context_usage(sid, input_tokens, output_tokens).await;
        }
    }
}

async fn drain_spec_events(
    spec_rx: &mut mpsc::UnboundedReceiver<SpecStreamEvent>,
    tx: &mpsc::UnboundedSender<ChatStreamEvent>,
) -> (String, u64, u64) {
    let mut accumulated = String::new();
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;

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
            SpecStreamEvent::TokenUsage { input_tokens: it, output_tokens: ot } => {
                input_tokens += it;
                output_tokens += ot;
                send_or_log(tx, ChatStreamEvent::TokenUsage {
                    input_tokens,
                    output_tokens,
                });
            }
            SpecStreamEvent::Error(msg) => {
                send_or_log(tx, ChatStreamEvent::Error(msg));
            }
            SpecStreamEvent::Complete(_) | SpecStreamEvent::Progress(_) | SpecStreamEvent::Generating { .. } => {}
        }
    }

    (accumulated, input_tokens, output_tokens)
}
