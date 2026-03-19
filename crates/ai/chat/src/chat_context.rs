use tracing::{info, warn};

use aura_claude::{self, ContentBlock, MessageContent, RichMessage};
use aura_core::*;

use crate::ChatService;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

pub(crate) fn build_chat_system_prompt(project: &Project, custom_system_prompt: &str) -> String {
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

    append_tech_stack(&mut prompt, project);
    prompt
}

fn append_tech_stack(prompt: &mut String, project: &Project) {
    let folder = std::path::Path::new(&project.linked_folder_path);
    if !folder.is_dir() {
        return;
    }

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

    append_directory_listing(prompt, folder);
    append_config_previews(prompt, folder);
}

fn append_directory_listing(prompt: &mut String, folder: &std::path::Path) {
    let entries = match std::fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut items: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target"
            || name == "__pycache__" || name == "dist" || name == "build"
        {
            continue;
        }
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        items.push(if is_dir { format!("{name}/") } else { name });
    }
    items.sort();
    if !items.is_empty() {
        let listing = items.iter().take(30).cloned().collect::<Vec<_>>().join(", ");
        prompt.push_str(&format!("\n### Project Structure\n{listing}\n"));
    }
}

fn append_config_previews(prompt: &mut String, folder: &std::path::Path) {
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

impl ChatService {
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

    pub(crate) async fn manage_context_window(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
    ) -> Vec<RichMessage> {
        use aura_claude::estimate_message_tokens;

        let max_context_tokens = self.llm_config.max_context_tokens;
        let keep_recent_messages = self.llm_config.keep_recent_messages;
        let target_chat_tokens = self.llm_config.target_chat_tokens;

        let system_tokens = aura_claude::estimate_tokens(system_prompt);
        let total_msg_tokens: u64 = messages.iter().map(|m| estimate_message_tokens(m)).sum();
        let total = system_tokens + total_msg_tokens;

        if total <= target_chat_tokens || messages.len() <= 4 {
            return messages;
        }

        let utilization = total as f64 / max_context_tokens as f64;

        if utilization <= 0.50 {
            info!(
                total_tokens = total,
                target_chat_tokens,
                utilization_pct = (utilization * 100.0) as u32,
                "Soft-target compaction: summarizing to stay under target_chat_tokens"
            );
            let compaction_keep = keep_recent_messages.min(6);
            let split_at = Self::find_safe_split(&messages, compaction_keep);
            return self.summarize_and_keep(api_key, &messages, split_at).await;
        }

        if utilization <= 0.75 {
            let compaction_keep = keep_recent_messages.min(6);
            if total > target_chat_tokens * 2 {
                info!(
                    total_tokens = total,
                    target_chat_tokens,
                    utilization_pct = (utilization * 100.0) as u32,
                    "Tier-1 compaction: summarizing (tokens far above soft target)"
                );
                let split_at = Self::find_safe_split(&messages, compaction_keep);
                return self.summarize_and_keep(api_key, &messages, split_at).await;
            }
            info!(
                total_tokens = total,
                utilization_pct = (utilization * 100.0) as u32,
                "Tier-1 compaction: truncating large tool results in older messages"
            );
            return crate::compaction::compact_tool_results_in_history(messages, compaction_keep);
        }

        if utilization <= 0.90 {
            info!(
                total_tokens = total,
                utilization_pct = (utilization * 100.0) as u32,
                "Tier-2 compaction: summarizing older messages"
            );
            let compaction_keep = keep_recent_messages.min(6);
            let split_at = Self::find_safe_split(&messages, compaction_keep);
            return self.summarize_and_keep(api_key, &messages, split_at).await;
        }

        info!(
            total_tokens = total,
            utilization_pct = (utilization * 100.0) as u32,
            "Tier-3 compaction: aggressive summarization"
        );
        let aggressive_keep = 4;
        let split_at = Self::find_safe_split(&messages, aggressive_keep);
        self.summarize_and_keep(api_key, &messages, split_at).await
    }

    fn find_safe_split(messages: &[RichMessage], keep_recent: usize) -> usize {
        let mut split_at = messages.len().saturating_sub(keep_recent);
        while split_at > 0 && Self::is_tool_results_only(&messages[split_at]) {
            split_at -= 1;
        }
        split_at
    }

    async fn summarize_and_keep(
        &self,
        api_key: &str,
        messages: &[RichMessage],
        split_at: usize,
    ) -> Vec<RichMessage> {
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
            .llm
            .complete_with_model(aura_claude::FAST_MODEL, api_key, CONTEXT_SUMMARY_SYSTEM_PROMPT, &summary_input, 1024, "aura_context_summary", None)
            .await
        {
            Ok(resp) => {
                let summary = resp.text;
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
            git_repo_url: None,
            git_branch: None,
            orbit_base_url: None,
            orbit_owner: None,
            orbit_repo: None,
        }
    }

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
