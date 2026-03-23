use chrono::Utc;
use tokio::sync::mpsc;
use tracing::info;

use aura_core::*;
use aura_specs::SpecStreamEvent;

use crate::channel_ext::send_or_log;
use crate::chat::{ChatService, ChatStreamEvent};

struct SpecSaveContext<'a> {
    project_id: &'a ProjectId,
    agent_instance_id: &'a AgentInstanceId,
    content: &'a str,
    content_blocks: Option<&'a [ChatContentBlock]>,
    input_tokens: u64,
    output_tokens: u64,
    tx: &'a mpsc::UnboundedSender<ChatStreamEvent>,
    active_session_id: Option<&'a str>,
}

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

        let (accumulated, content_blocks, spec_input_tokens, spec_output_tokens) =
            drain_spec_events(&mut spec_rx, tx).await;

        info!(
            %project_id, %agent_instance_id,
            spec_input_tokens, spec_output_tokens,
            "Spec gen finished"
        );
        self.update_instance_token_usage(
            project_id,
            agent_instance_id,
            spec_input_tokens,
            spec_output_tokens,
            tx,
        );

        if !accumulated.is_empty() {
            let blocks = if content_blocks.is_empty() {
                None
            } else {
                Some(content_blocks)
            };
            self.save_spec_assistant_message(SpecSaveContext {
                project_id,
                agent_instance_id,
                content: &accumulated,
                content_blocks: blocks.as_deref(),
                input_tokens: spec_input_tokens,
                output_tokens: spec_output_tokens,
                tx,
                active_session_id,
            })
            .await;
        }
    }

    async fn save_spec_assistant_message(&self, ctx: SpecSaveContext<'_>) {
        let assistant_msg = Message {
            message_id: MessageId::new(),
            agent_instance_id: *ctx.agent_instance_id,
            project_id: *ctx.project_id,
            role: ChatRole::Assistant,
            content: ctx.content.to_string(),
            content_blocks: ctx.content_blocks.map(|b| b.to_vec()),
            thinking: None,
            thinking_duration_ms: None,
            created_at: Utc::now(),
        };
        send_or_log(ctx.tx, ChatStreamEvent::MessageSaved(assistant_msg));
        self.save_message_to_storage(crate::chat_persistence::SaveMessageParams {
            project_id: ctx.project_id,
            agent_instance_id: ctx.agent_instance_id,
            role: "assistant",
            content: ctx.content,
            content_blocks: ctx.content_blocks,
            thinking: None,
            thinking_duration_ms: None,
            input_tokens: Some(ctx.input_tokens),
            output_tokens: Some(ctx.output_tokens),
            session_id: ctx.active_session_id,
        })
        .await;

        if let Some(sid) = ctx.active_session_id {
            self.update_session_context_usage(sid, ctx.input_tokens, ctx.output_tokens)
                .await;
        }
    }
}

pub(crate) async fn drain_spec_events(
    spec_rx: &mut mpsc::UnboundedReceiver<SpecStreamEvent>,
    tx: &mpsc::UnboundedSender<ChatStreamEvent>,
) -> (String, Vec<ChatContentBlock>, u64, u64) {
    let mut accumulated = String::new();
    let mut content_blocks = Vec::new();
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;

    let mut current_draft_index: usize = 0;
    let mut draft_started = false;

    while let Some(evt) = spec_rx.recv().await {
        match evt {
            SpecStreamEvent::Delta(text) => {
                accumulated.push_str(&text);
            }
            SpecStreamEvent::SpecDraftPreview {
                draft_index,
                title,
                markdown_preview,
            } => {
                let id = format!("draft-spec-{draft_index}");
                if !draft_started || draft_index != current_draft_index {
                    current_draft_index = draft_index;
                    draft_started = true;
                    send_or_log(
                        tx,
                        ChatStreamEvent::ToolCallStarted {
                            id: id.clone(),
                            name: "create_spec".into(),
                        },
                    );
                }
                let mut input = serde_json::Map::new();
                if let Some(t) = title {
                    input.insert("title".into(), serde_json::Value::String(t));
                }
                input.insert(
                    "markdown_contents".into(),
                    serde_json::Value::String(markdown_preview),
                );
                send_or_log(
                    tx,
                    ChatStreamEvent::ToolCallSnapshot {
                        id,
                        name: "create_spec".into(),
                        input: serde_json::Value::Object(input),
                    },
                );
            }
            SpecStreamEvent::SpecSaved(spec) => {
                if draft_started {
                    let id = format!("draft-spec-{current_draft_index}");
                    let input = serde_json::json!({
                        "title": spec.title,
                        "markdown_contents": spec.markdown_contents,
                    });
                    send_or_log(
                        tx,
                        ChatStreamEvent::ToolCall {
                            id: id.clone(),
                            name: "create_spec".into(),
                            input,
                        },
                    );
                    send_or_log(
                        tx,
                        ChatStreamEvent::ToolResult {
                            id,
                            name: "create_spec".into(),
                            result: format!("Spec \"{}\" saved", spec.title),
                            is_error: false,
                        },
                    );
                    draft_started = false;
                }
                content_blocks.push(ChatContentBlock::SpecRef {
                    spec_id: spec.spec_id.to_string(),
                    title: spec.title.clone(),
                });
                send_or_log(tx, ChatStreamEvent::SpecSaved(spec));
            }
            SpecStreamEvent::SpecsTitle(title) => {
                send_or_log(tx, ChatStreamEvent::SpecsTitle(title));
            }
            SpecStreamEvent::SpecsSummary(summary) => {
                send_or_log(tx, ChatStreamEvent::SpecsSummary(summary));
            }
            SpecStreamEvent::TaskSaved(task) => {
                content_blocks.push(ChatContentBlock::TaskRef {
                    task_id: task.task_id.to_string(),
                    title: task.title.clone(),
                });
                send_or_log(tx, ChatStreamEvent::TaskSaved(task));
            }
            SpecStreamEvent::TokenUsage {
                input_tokens: it,
                output_tokens: ot,
            } => {
                input_tokens += it;
                output_tokens += ot;
                send_or_log(
                    tx,
                    ChatStreamEvent::TokenUsage {
                        input_tokens,
                        output_tokens,
                    },
                );
            }
            SpecStreamEvent::Error(msg) => {
                send_or_log(tx, ChatStreamEvent::Error(msg));
            }
            SpecStreamEvent::Progress(stage) => {
                send_or_log(tx, ChatStreamEvent::Progress(stage));
            }
            SpecStreamEvent::Generating { .. } => {
                send_or_log(
                    tx,
                    ChatStreamEvent::Progress("Generating spec...".to_string()),
                );
            }
            SpecStreamEvent::Complete(_) => {}
        }
    }

    (accumulated, content_blocks, input_tokens, output_tokens)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn make_spec() -> Spec {
        Spec {
            spec_id: SpecId::new(),
            project_id: ProjectId::new(),
            title: "Test spec".into(),
            order_index: 0,
            markdown_contents: "Spec content".into(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    fn make_task() -> Task {
        Task {
            task_id: TaskId::new(),
            project_id: ProjectId::new(),
            spec_id: SpecId::new(),
            title: "Test task".into(),
            description: "Task desc".into(),
            status: TaskStatus::Pending,
            order_index: 0,
            dependency_ids: vec![],
            parent_task_id: None,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[tokio::test]
    async fn drain_spec_events_accumulates_deltas_but_suppresses_forwarding() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::Delta("Hello ".into()))
            .unwrap();
        spec_tx
            .send(SpecStreamEvent::Delta("World".into()))
            .unwrap();
        drop(spec_tx);

        let (accumulated, _blocks, input_tokens, output_tokens) =
            drain_spec_events(&mut spec_rx, &chat_tx).await;

        assert_eq!(accumulated, "Hello World");
        assert_eq!(input_tokens, 0);
        assert_eq!(output_tokens, 0);

        let mut delta_count = 0;
        while let Ok(evt) = chat_rx.try_recv() {
            if matches!(evt, ChatStreamEvent::Delta(_)) {
                delta_count += 1;
            }
        }
        assert_eq!(delta_count, 0, "Raw JSON deltas should be suppressed");
    }

    #[tokio::test]
    async fn drain_spec_events_tracks_token_usage() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
            })
            .unwrap();
        spec_tx
            .send(SpecStreamEvent::TokenUsage {
                input_tokens: 200,
                output_tokens: 80,
            })
            .unwrap();
        drop(spec_tx);

        let (_, _blocks, input_tokens, output_tokens) =
            drain_spec_events(&mut spec_rx, &chat_tx).await;

        assert_eq!(input_tokens, 300);
        assert_eq!(output_tokens, 130);

        let mut usage_events = vec![];
        while let Ok(evt) = chat_rx.try_recv() {
            if let ChatStreamEvent::TokenUsage {
                input_tokens,
                output_tokens,
            } = evt
            {
                usage_events.push((input_tokens, output_tokens));
            }
        }
        assert_eq!(usage_events.len(), 2);
        assert_eq!(usage_events[0], (100, 50));
        assert_eq!(usage_events[1], (300, 130));
    }

    #[tokio::test]
    async fn drain_spec_events_forwards_spec_saved() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        let spec = make_spec();
        spec_tx.send(SpecStreamEvent::SpecSaved(spec)).unwrap();
        drop(spec_tx);

        let (_accumulated, blocks, _it, _ot) = drain_spec_events(&mut spec_rx, &chat_tx).await;

        assert_eq!(blocks.len(), 1);
        assert!(matches!(&blocks[0], ChatContentBlock::SpecRef { .. }));

        let mut found = false;
        while let Ok(evt) = chat_rx.try_recv() {
            if matches!(evt, ChatStreamEvent::SpecSaved(_)) {
                found = true;
            }
        }
        assert!(found, "SpecSaved should be forwarded");
    }

    #[tokio::test]
    async fn drain_spec_events_forwards_error() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx.send(SpecStreamEvent::Error("oops".into())).unwrap();
        drop(spec_tx);

        drain_spec_events(&mut spec_rx, &chat_tx).await;

        let mut found = false;
        while let Ok(evt) = chat_rx.try_recv() {
            if let ChatStreamEvent::Error(msg) = evt {
                assert_eq!(msg, "oops");
                found = true;
            }
        }
        assert!(found, "Error should be forwarded");
    }

    #[tokio::test]
    async fn drain_spec_events_forwards_progress_and_generating_ignores_complete() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::Progress("loading...".into()))
            .unwrap();
        spec_tx
            .send(SpecStreamEvent::Generating { tokens: 100 })
            .unwrap();
        spec_tx.send(SpecStreamEvent::Complete(vec![])).unwrap();
        drop(spec_tx);

        let (accumulated, _blocks, _, _) = drain_spec_events(&mut spec_rx, &chat_tx).await;
        assert!(accumulated.is_empty());

        let mut progress_events = vec![];
        while let Ok(evt) = chat_rx.try_recv() {
            if let ChatStreamEvent::Progress(stage) = evt {
                progress_events.push(stage);
            }
        }
        assert_eq!(
            progress_events.len(),
            2,
            "Progress and Generating should forward as Progress events"
        );
        assert_eq!(progress_events[0], "loading...");
        assert_eq!(progress_events[1], "Generating spec...");
    }

    #[tokio::test]
    async fn drain_spec_events_forwards_title_and_summary() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::SpecsTitle("My Project".into()))
            .unwrap();
        spec_tx
            .send(SpecStreamEvent::SpecsSummary("A summary".into()))
            .unwrap();
        drop(spec_tx);

        drain_spec_events(&mut spec_rx, &chat_tx).await;

        let mut found_title = false;
        let mut found_summary = false;
        while let Ok(evt) = chat_rx.try_recv() {
            match evt {
                ChatStreamEvent::SpecsTitle(t) => {
                    assert_eq!(t, "My Project");
                    found_title = true;
                }
                ChatStreamEvent::SpecsSummary(s) => {
                    assert_eq!(s, "A summary");
                    found_summary = true;
                }
                _ => {}
            }
        }
        assert!(found_title, "SpecsTitle should be forwarded");
        assert!(found_summary, "SpecsSummary should be forwarded");
    }

    #[tokio::test]
    async fn drain_spec_events_forwards_task_saved() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        let task = make_task();
        spec_tx
            .send(SpecStreamEvent::TaskSaved(Box::new(task)))
            .unwrap();
        drop(spec_tx);

        let (_accumulated, blocks, _it, _ot) = drain_spec_events(&mut spec_rx, &chat_tx).await;

        assert_eq!(blocks.len(), 1);
        assert!(matches!(&blocks[0], ChatContentBlock::TaskRef { .. }));

        let mut found = false;
        while let Ok(evt) = chat_rx.try_recv() {
            if matches!(evt, ChatStreamEvent::TaskSaved(_)) {
                found = true;
            }
        }
        assert!(found, "TaskSaved should be forwarded");
    }

    #[tokio::test]
    async fn drain_spec_events_draft_preview_emits_tool_call_started_and_snapshot() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::SpecDraftPreview {
                draft_index: 0,
                title: Some("Auth Module".into()),
                markdown_preview: "## Purpose\n\nHandle auth".into(),
            })
            .unwrap();
        spec_tx
            .send(SpecStreamEvent::SpecDraftPreview {
                draft_index: 0,
                title: Some("Auth Module".into()),
                markdown_preview: "## Purpose\n\nHandle auth\n\n# Details".into(),
            })
            .unwrap();
        drop(spec_tx);

        drain_spec_events(&mut spec_rx, &chat_tx).await;

        let mut events = vec![];
        while let Ok(evt) = chat_rx.try_recv() {
            events.push(evt);
        }

        assert!(
            matches!(&events[0], ChatStreamEvent::ToolCallStarted { id, name }
            if id == "draft-spec-0" && name == "create_spec"),
            "First event should be ToolCallStarted"
        );

        assert!(
            matches!(&events[1], ChatStreamEvent::ToolCallSnapshot { id, name, .. }
            if id == "draft-spec-0" && name == "create_spec"),
            "Second event should be ToolCallSnapshot"
        );

        assert!(
            matches!(&events[2], ChatStreamEvent::ToolCallSnapshot { id, name, .. }
            if id == "draft-spec-0" && name == "create_spec"),
            "Third event should be another ToolCallSnapshot (no second ToolCallStarted)"
        );

        assert_eq!(
            events.len(),
            3,
            "Should be exactly 3 events: 1 started + 2 snapshots"
        );
    }

    #[tokio::test]
    async fn drain_spec_events_spec_saved_finalizes_draft() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::SpecDraftPreview {
                draft_index: 0,
                title: Some("Auth".into()),
                markdown_preview: "preview".into(),
            })
            .unwrap();
        let spec = make_spec();
        spec_tx.send(SpecStreamEvent::SpecSaved(spec)).unwrap();
        drop(spec_tx);

        let (_accumulated, blocks, _it, _ot) = drain_spec_events(&mut spec_rx, &chat_tx).await;

        let mut events = vec![];
        while let Ok(evt) = chat_rx.try_recv() {
            events.push(evt);
        }

        let event_names: Vec<&str> = events
            .iter()
            .map(|e| match e {
                ChatStreamEvent::ToolCallStarted { .. } => "started",
                ChatStreamEvent::ToolCallSnapshot { .. } => "snapshot",
                ChatStreamEvent::ToolCall { .. } => "call",
                ChatStreamEvent::ToolResult { .. } => "result",
                ChatStreamEvent::SpecSaved(_) => "spec_saved",
                _ => "other",
            })
            .collect();

        assert_eq!(
            event_names,
            vec!["started", "snapshot", "call", "result", "spec_saved"],
            "Draft preview → SpecSaved should produce: started, snapshot, call, result, spec_saved"
        );

        assert_eq!(blocks.len(), 1);
        assert!(matches!(&blocks[0], ChatContentBlock::SpecRef { .. }));
    }

    #[tokio::test]
    async fn drain_spec_events_multiple_drafts_get_distinct_ids() {
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        let (chat_tx, mut chat_rx) = mpsc::unbounded_channel();

        spec_tx
            .send(SpecStreamEvent::SpecDraftPreview {
                draft_index: 0,
                title: Some("First".into()),
                markdown_preview: "md1".into(),
            })
            .unwrap();
        let spec1 = make_spec();
        spec_tx.send(SpecStreamEvent::SpecSaved(spec1)).unwrap();
        spec_tx
            .send(SpecStreamEvent::SpecDraftPreview {
                draft_index: 1,
                title: Some("Second".into()),
                markdown_preview: "md2".into(),
            })
            .unwrap();
        drop(spec_tx);

        drain_spec_events(&mut spec_rx, &chat_tx).await;

        let mut started_ids = vec![];
        while let Ok(evt) = chat_rx.try_recv() {
            if let ChatStreamEvent::ToolCallStarted { id, .. } = evt {
                started_ids.push(id);
            }
        }
        assert_eq!(
            started_ids,
            vec!["draft-spec-0", "draft-spec-1"],
            "Each draft spec should get a distinct synthetic ID"
        );
    }
}
