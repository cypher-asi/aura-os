use aura_core::*;

use crate::file_ops::{self, WorkspaceCache};

pub(super) struct CodebaseContext {
    pub codebase_snapshot: String,
    pub dep_api_context: String,
    pub type_defs_context: String,
}

pub(super) async fn fetch_codebase_context(
    project: &Project,
    task: &Task,
    spec: &Spec,
    workspace_cache: &WorkspaceCache,
    workspace_map: &str,
) -> CodebaseContext {
    let codebase_snapshot = match file_ops::retrieve_task_relevant_files_cached(
        &project.linked_folder_path,
        &task.title,
        &task.description,
        50_000,
        workspace_cache,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("cached file retrieval failed, falling back to basic read: {e}");
            file_ops::read_relevant_files(&project.linked_folder_path, 50_000).unwrap_or_else(
                |e2| {
                    tracing::warn!("fallback read_relevant_files also failed: {e2}");
                    String::new()
                },
            )
        }
    };

    let dep_api_context = if !workspace_map.is_empty() {
        file_ops::resolve_task_dep_api_context_cached(
            &project.linked_folder_path,
            &task.title,
            &task.description,
            15_000,
            workspace_cache,
        )
        .await
        .unwrap_or_else(|e| {
            tracing::warn!("resolve_task_dep_api_context_cached failed: {e}");
            String::new()
        })
    } else {
        String::new()
    };

    let type_defs_context = file_ops::resolve_type_definitions_for_task_async(
        &project.linked_folder_path,
        &task.title,
        &task.description,
        &spec.markdown_contents,
        10_000,
    )
    .await;

    CodebaseContext {
        codebase_snapshot,
        dep_api_context,
        type_defs_context,
    }
}

pub(super) async fn resolve_completed_deps(
    task_service: &aura_tasks::TaskService,
    project_id: &ProjectId,
    task: &Task,
) -> Vec<Task> {
    if task.dependency_ids.is_empty() {
        return Vec::new();
    }
    let all_project_tasks = task_service
        .list_tasks(project_id)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!("failed to list tasks for dependency resolution: {e}");
            Vec::new()
        });
    task.dependency_ids
        .iter()
        .filter_map(|dep_id| {
            all_project_tasks
                .iter()
                .find(|t| t.task_id == *dep_id && t.status == TaskStatus::Done)
                .cloned()
        })
        .collect()
}

fn extract_codebase_conventions(codebase_snapshot: &str) -> String {
    let mut conventions = Vec::new();

    if codebase_snapshot.contains("thiserror") {
        conventions.push("Error types: uses thiserror derive macros");
    }
    if codebase_snapshot.contains("#[tokio::test]") {
        conventions.push("Tests: async tests with #[tokio::test]");
    }
    if codebase_snapshot.contains("Arc<") && codebase_snapshot.contains("impl") {
        conventions.push("Services: wrapped in Arc for shared ownership");
    }
    if codebase_snapshot.contains("tracing::") || codebase_snapshot.contains("use tracing") {
        conventions.push("Logging: uses tracing crate");
    }
    if codebase_snapshot.contains("serde::") || codebase_snapshot.contains("#[derive(Serialize") {
        conventions.push("Serialization: uses serde with derive macros");
    }
    if codebase_snapshot.contains("async fn") && codebase_snapshot.contains("await") {
        conventions.push("Async: uses async/await patterns");
    }
    if codebase_snapshot.contains("#[cfg(test)]") {
        conventions.push("Tests: inline #[cfg(test)] modules");
    }

    if conventions.is_empty() {
        return String::new();
    }
    format!(
        "\n# Codebase Conventions (follow these patterns)\n{}\n",
        conventions
            .iter()
            .map(|c| format!("- {c}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

pub(super) fn build_full_task_context(
    mut task_context: String,
    workspace_map: &str,
    type_defs: &str,
    codebase_snapshot: &str,
    dep_api: &str,
) -> String {
    let conventions = extract_codebase_conventions(codebase_snapshot);
    if !conventions.is_empty() {
        task_context.push_str(&conventions);
    }
    if !workspace_map.is_empty() {
        task_context.push_str(&format!("\n# Workspace Structure\n{}\n", workspace_map));
    }
    if !type_defs.is_empty() {
        task_context.push_str(&format!(
            "\n# Type Definitions Referenced in Task\n{}\n",
            type_defs
        ));
    }
    if !codebase_snapshot.is_empty() {
        task_context.push_str(&format!(
            "\n# Current Codebase Files\n{}\n",
            codebase_snapshot
        ));
    }
    if !dep_api.is_empty() {
        task_context.push_str(&format!("\n# Dependency API Surface\n{}\n", dep_api));
    }
    cap_task_context(&mut task_context, MAX_TASK_CONTEXT_CHARS);
    task_context
}

pub(super) const MAX_TASK_CONTEXT_CHARS: usize = 160_000; // ~40K tokens
const MAX_WORK_LOG_TASK_CONTEXT: usize = 4_000;

pub(super) fn build_work_log_summary(work_log: &[String]) -> String {
    if work_log.is_empty() {
        return String::new();
    }
    let mut summary = work_log.join("\n---\n");
    if summary.len() > MAX_WORK_LOG_TASK_CONTEXT {
        summary.truncate(MAX_WORK_LOG_TASK_CONTEXT);
        summary.push_str("\n... (truncated) ...");
    }
    summary
}

/// Trim `task_context` to at most `budget` characters by progressively removing
/// lower-priority sections (codebase snapshot first, then dep API, then workspace
/// map), preserving the core task description, spec, and work log.
pub(super) fn cap_task_context(task_context: &mut String, budget: usize) {
    if task_context.len() <= budget {
        return;
    }

    const SECTIONS: &[&str] = &[
        "\n# Current Codebase Files\n",
        "\n# Dependency API Surface\n",
        "\n# Workspace Structure\n",
        "\n# Type Definitions Referenced in Task\n",
    ];

    for section_header in SECTIONS {
        if task_context.len() <= budget {
            return;
        }
        if let Some(start) = task_context.find(section_header) {
            let next_section = task_context[start + section_header.len()..]
                .find("\n# ")
                .map(|pos| start + section_header.len() + pos);
            let end = next_section.unwrap_or(task_context.len());

            let section_len = end - start;
            let overshoot = task_context.len().saturating_sub(budget);

            if overshoot >= section_len {
                task_context.replace_range(start..end, "");
            } else {
                let keep = section_len - overshoot;
                let trim_start = start + keep;
                task_context.replace_range(
                    trim_start..end,
                    "\n... (truncated to fit context budget) ...\n",
                );
            }
        }
    }

    if task_context.len() > budget {
        task_context.truncate(budget);
        task_context.push_str("\n... (context truncated) ...\n");
    }
}

/// Conservative pre-check: skip simple tasks whose deliverables already exist
/// in the workspace (e.g. a struct/module defined by a predecessor task).
pub(super) async fn check_already_completed(
    project: &Project,
    task: &Task,
    completed_deps: &[Task],
) -> Option<String> {
    if completed_deps.is_empty() {
        return None;
    }

    let desc_lower = format!("{} {}", task.title, task.description).to_lowercase();
    let base = &project.linked_folder_path;

    let define_patterns: &[(&str, &str)] = &[
        ("define struct ", "struct "),
        ("define enum ", "enum "),
        ("define type ", "type "),
        ("create struct ", "struct "),
        ("create enum ", "enum "),
    ];
    for (trigger, code_prefix) in define_patterns {
        if let Some(pos) = desc_lower.find(trigger) {
            let after = &desc_lower[pos + trigger.len()..];
            let name: String = after
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if name.is_empty() {
                continue;
            }

            let dep_files: Vec<&str> = completed_deps
                .iter()
                .flat_map(|d| d.files_changed.iter())
                .map(|f| f.path.as_str())
                .collect();

            for file_path in &dep_files {
                let full_path = std::path::Path::new(base).join(file_path);
                if let Ok(content) = tokio::fs::read_to_string(&full_path).await {
                    let needle = format!("{}{}", code_prefix, name);
                    if content.to_lowercase().contains(&needle.to_lowercase()) {
                        return Some(format!(
                            "`{}{}` already exists in {} (created by a predecessor task)",
                            code_prefix, name, file_path
                        ));
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_work_log_summary_empty() {
        assert_eq!(build_work_log_summary(&[]), "");
    }

    #[test]
    fn build_work_log_summary_joins_entries() {
        let log = vec!["Task 1 done".into(), "Task 2 done".into()];
        let summary = build_work_log_summary(&log);
        assert!(summary.contains("Task 1 done"));
        assert!(summary.contains("---"));
        assert!(summary.contains("Task 2 done"));
    }

    #[test]
    fn build_work_log_summary_truncates_long_input() {
        let log: Vec<String> = (0..500)
            .map(|i| format!("Entry {i}: some work done here"))
            .collect();
        let summary = build_work_log_summary(&log);
        assert!(summary.len() <= MAX_WORK_LOG_TASK_CONTEXT + 30);
        assert!(summary.contains("(truncated)"));
    }

    #[test]
    fn cap_task_context_within_budget_unchanged() {
        let mut ctx = "Short context".to_string();
        let original = ctx.clone();
        cap_task_context(&mut ctx, 1000);
        assert_eq!(ctx, original);
    }

    #[test]
    fn cap_task_context_trims_codebase_section_first() {
        let mut ctx = String::new();
        ctx.push_str("# Task\nDo something\n");
        ctx.push_str("\n# Current Codebase Files\n");
        ctx.push_str(&"x".repeat(5000));
        ctx.push_str("\n# Dependency API Surface\n");
        ctx.push_str("dep info here");

        let original_len = ctx.len();
        let budget = 200;
        cap_task_context(&mut ctx, budget);
        assert!(
            ctx.len() < original_len,
            "context should be smaller after capping"
        );
        assert!(
            !ctx.contains(&"x".repeat(4000)),
            "bulk of codebase section should be trimmed"
        );
        assert!(
            ctx.contains("truncated"),
            "should contain truncation marker"
        );
    }

    #[test]
    fn cap_task_context_hard_truncate_last_resort() {
        let mut ctx = "x".repeat(10_000);
        cap_task_context(&mut ctx, 500);
        assert!(ctx.len() <= 550);
        assert!(ctx.contains("(context truncated)"));
    }

    #[test]
    fn test_extract_codebase_conventions_empty_input() {
        assert_eq!(extract_codebase_conventions(""), String::new());
    }

    #[test]
    fn test_extract_codebase_conventions_no_matches() {
        assert_eq!(
            extract_codebase_conventions("fn main() { println!(\"hello\"); }"),
            String::new(),
        );
    }

    #[test]
    fn test_extract_codebase_conventions_all_conventions() {
        let input = r#"
            use thiserror;
            #[tokio::test]
            Arc<SomeService>
            impl Foo {}
            tracing::info!("hi");
            #[derive(Serialize, Deserialize)]
            async fn do_work() { something.await }
            #[cfg(test)]
        "#;
        let result = extract_codebase_conventions(input);
        assert!(result.contains("thiserror"), "should mention thiserror");
        assert!(result.contains("tokio::test"), "should mention tokio::test");
        assert!(result.contains("Arc"), "should mention Arc");
        assert!(result.contains("tracing"), "should mention tracing");
        assert!(result.contains("serde"), "should mention serde");
        assert!(result.contains("async"), "should mention async");
        assert!(result.contains("#[cfg(test)]"), "should mention cfg(test)");
        let convention_count = result.lines().filter(|l| l.starts_with("- ")).count();
        assert_eq!(convention_count, 7);
    }

    #[test]
    fn test_build_full_task_context_appends_all_sections() {
        let result = build_full_task_context(
            "base".to_string(),
            "workspace map",
            "type defs",
            "codebase snap",
            "dep api",
        );
        assert!(result.contains("Workspace Structure"));
        assert!(result.contains("Type Definitions"));
        assert!(result.contains("Current Codebase Files"));
        assert!(result.contains("Dependency API Surface"));
    }

    #[test]
    fn test_build_full_task_context_empty_extras_stays_minimal() {
        let result = build_full_task_context("base".to_string(), "", "", "", "");
        assert_eq!(result, "base");
    }
}
