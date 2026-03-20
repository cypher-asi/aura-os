use std::sync::{Arc, Mutex};
use std::collections::HashSet;

use chrono::Utc;
use tokio::sync::mpsc;
use tracing::info;

use aura_core::*;
use aura_claude::ThinkingConfig;

use crate::channel_ext::send_or_log;
use crate::chat::{
    ChatService, ChatStreamEvent, ContentBlockAccumulator,
    convert_messages_to_rich, forward_tool_loop_event,
};
use crate::constants::DEFAULT_STREAM_TIMEOUT;
use crate::chat_tool_executor::ChatToolExecutor;
use crate::chat_tool_loop_executor::{ForwardingToolExecutor, MultiProjectResolver};
use crate::tool_loop::{run_tool_loop, ToolLoopConfig, ToolLoopEvent};
use aura_tools::multi_project_tool_definitions;

fn build_multi_project_system_prompt(agent: &Agent, projects: &[Project]) -> String {
    let mut prompt = if agent.system_prompt.is_empty() {
        CHAT_SYSTEM_PROMPT_BASE.to_string()
    } else {
        let mut p = agent.system_prompt.clone();
        p.push_str("\n\n");
        p.push_str(CHAT_SYSTEM_PROMPT_BASE);
        p
    };

    prompt.push_str("\n\n## Available Projects\n\n");
    prompt.push_str(
        "You are operating in multi-project mode. Every tool call MUST include a `project_id` \
         parameter to specify which project to act on. Here are the projects you can work with:\n\n",
    );

    for project in projects {
        prompt.push_str(&format!(
            "- **{}** (ID: `{}`)\n  - Description: {}\n  - Folder: `{}`\n  - Build: `{}`\n  - Test: `{}`\n\n",
            project.name,
            project.project_id,
            project.description,
            project.linked_folder_path,
            project.build_command.as_deref().unwrap_or("(not set)"),
            project.test_command.as_deref().unwrap_or("(not set)"),
        ));
    }

    prompt
}

// ---------------------------------------------------------------------------
// ToolExecutor for multi-project agent chat (via ForwardingToolExecutor)
// ---------------------------------------------------------------------------

impl ChatService {
    pub(crate) async fn handle_agent_chat_with_tools(
        &self,
        agent_id: &AgentId,
        agent: &Agent,
        projects: &[Project],
        stored_messages: Vec<Message>,
        anchor_project_id: &ProjectId,
        anchor_instance_id: &AgentInstanceId,
        active_session_id: Option<&str>,
        tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    ) {
        let send = |evt: ChatStreamEvent| {
            send_or_log(&tx, evt);
        };

        let api_key = match self.settings.get_decrypted_api_key() {
            Ok(k) => k,
            Err(e) => {
                send(ChatStreamEvent::Error(format!("API key error: {e}")));
                return;
            }
        };

        send_or_log(&tx, ChatStreamEvent::Progress("Building context...".to_string()));

        let system = build_multi_project_system_prompt(agent, projects);

        let mut api_messages = convert_messages_to_rich(&stored_messages);

        api_messages = self
            .manage_context_window(&api_key, &system, api_messages)
            .await;

        api_messages = crate::chat_sanitize::sanitize_orphan_tool_results(api_messages);
        api_messages = crate::chat_sanitize::sanitize_tool_use_results(api_messages);

        send_or_log(&tx, ChatStreamEvent::Progress("Waiting for response...".to_string()));

        let tools = multi_project_tool_definitions();

        let allowed_project_ids: HashSet<String> = projects
            .iter()
            .map(|p| p.project_id.to_string())
            .collect();

        let tool_blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        let executor = ForwardingToolExecutor {
            inner: ChatToolExecutor::new(
                self.store.clone(),
                self.storage_client.clone(),
                self.project_service.clone(),
                self.task_service.clone(),
            ),
            resolver: MultiProjectResolver { allowed_project_ids },
            chat_tx: tx.clone(),
            blocks: Arc::clone(&tool_blocks),
        };

        let credit_budget = self.llm.current_balance().await.map(|b| b / 2);

        let config = ToolLoopConfig {
            max_iterations: ChatToolExecutor::max_iterations(),
            max_tokens: self.llm_config.chat_max_tokens,
            thinking: Some(ThinkingConfig::enabled(self.llm_config.thinking_budget)),
            stream_timeout: DEFAULT_STREAM_TIMEOUT,
            billing_reason: "aura_chat",
            max_context_tokens: Some(self.llm_config.max_context_tokens),
            credit_budget,
            exploration_allowance: None,
            model_override: None,
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

        info!(
            ?agent_id,
            result.total_input_tokens,
            result.total_output_tokens,
            llm_error = result.llm_error.as_deref().unwrap_or(""),
            "Agent chat loop finished"
        );

        let accumulated_blocks = match Arc::try_unwrap(tool_blocks) {
            Ok(mutex) => mutex.into_inner().unwrap_or_default(),
            Err(arc) => arc.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        };
        let has_tool_calls = !accumulated_blocks.is_empty();
        let content_blocks = if has_tool_calls { Some(accumulated_blocks) } else { None };

        if !result.text.is_empty() || has_tool_calls {
            let thinking = if result.thinking.is_empty() { None } else { Some(result.thinking) };
            let thinking_duration_ms = thinking.as_ref().map(|_| thinking_start.elapsed().as_millis() as u64);
            let assistant_msg = Message {
                message_id: MessageId::new(),
                agent_instance_id: *anchor_instance_id,
                project_id: *anchor_project_id,
                role: ChatRole::Assistant,
                content: result.text.clone(),
                content_blocks: content_blocks.clone(),
                thinking: thinking.clone(),
                thinking_duration_ms,
                created_at: Utc::now(),
            };
            send(ChatStreamEvent::MessageSaved(assistant_msg));

            if active_session_id.is_some() {
                self.save_message_to_storage(
                    anchor_project_id,
                    anchor_instance_id,
                    "assistant",
                    &result.text,
                    content_blocks.as_deref(),
                    thinking.as_deref(),
                    thinking_duration_ms,
                    Some(result.total_input_tokens),
                    Some(result.total_output_tokens),
                    active_session_id,
                )
                .await;
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
            workspace_source: None,
            workspace_display_path: None,
            requirements_doc_path: None,
            current_status: ProjectStatus::Planning,
            build_command: Some("cargo build".into()),
            test_command: Some("cargo test".into()),
            specs_summary: None,
            specs_title: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            git_repo_url: None,
            git_branch: None,
            orbit_base_url: None,
            orbit_owner: None,
            orbit_repo: None,
        }
    }

    fn make_agent(system_prompt: &str) -> Agent {
        Agent {
            agent_id: AgentId::new(),
            user_id: "u1".into(),
            name: "TestAgent".into(),
            role: "developer".into(),
            personality: String::new(),
            system_prompt: system_prompt.into(),
            skills: vec![],
            icon: None,
            network_agent_id: None,
            profile_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn multi_project_prompt_uses_base_when_agent_empty() {
        let agent = make_agent("");
        let projects = vec![make_project("ProjA", "/a"), make_project("ProjB", "/b")];
        let prompt = build_multi_project_system_prompt(&agent, &projects);
        assert!(prompt.starts_with(CHAT_SYSTEM_PROMPT_BASE));
        assert!(prompt.contains("multi-project mode"));
    }

    #[test]
    fn multi_project_prompt_uses_custom_agent_prompt() {
        let agent = make_agent("You are a special agent.");
        let projects = vec![make_project("P1", "/p1")];
        let prompt = build_multi_project_system_prompt(&agent, &projects);
        assert!(prompt.starts_with("You are a special agent."));
        assert!(prompt.contains(CHAT_SYSTEM_PROMPT_BASE));
    }

    #[test]
    fn multi_project_prompt_lists_all_projects() {
        let agent = make_agent("");
        let projects = vec![
            make_project("Alpha", "/alpha"),
            make_project("Beta", "/beta"),
            make_project("Gamma", "/gamma"),
        ];
        let prompt = build_multi_project_system_prompt(&agent, &projects);
        assert!(prompt.contains("**Alpha**"));
        assert!(prompt.contains("**Beta**"));
        assert!(prompt.contains("**Gamma**"));
        assert!(prompt.contains("/alpha"));
        assert!(prompt.contains("/beta"));
        assert!(prompt.contains("/gamma"));
    }

    #[test]
    fn multi_project_prompt_includes_project_commands() {
        let agent = make_agent("");
        let mut p = make_project("WithCmd", "/cmd");
        p.build_command = Some("make".into());
        p.test_command = None;
        let prompt = build_multi_project_system_prompt(&agent, &[p]);
        assert!(prompt.contains("make"));
        assert!(prompt.contains("(not set)"));
    }
}
