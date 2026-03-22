use aura_core::*;

pub(crate) fn build_agentic_task_context(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    completed_deps: &[Task],
    work_log_summary: &str,
) -> String {
    let mut ctx = String::new();
    ctx.push_str(&format!("# Project: {}\n{}\n\n", project.name, project.description));
    ctx.push_str(&format!("# Spec: {}\n{}\n\n", spec.title, spec.markdown_contents));
    ctx.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        ctx.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }
    if !task.execution_notes.is_empty() {
        ctx.push_str(&format!(
            "# Notes from Prior Attempts\n{}\n\n",
            task.execution_notes
        ));
    }

    if !completed_deps.is_empty() {
        ctx.push_str("# Completed Predecessor Tasks\n");
        ctx.push_str(&format_completed_deps(completed_deps));
        ctx.push('\n');
    }

    if !work_log_summary.is_empty() {
        ctx.push_str(&format!(
            "# Session Progress (tasks completed so far)\n{}\n\n\
             IMPORTANT: Review the completed tasks above. If your task's work was already done \
             by a prior task (e.g. the struct/module/function already exists), verify quickly with \
             search_code or read_file and call task_done immediately instead of re-implementing.\n\n",
            work_log_summary
        ));
    }

    ctx.push_str(
        "Briefly explore the codebase, then form a plan and begin implementing. \
         Focus on files you need to modify. Prefer targeted reads (with start_line/end_line) \
         over full-file reads when you only need a specific section.\n\n",
    );

    let title_lower = task.title.to_lowercase();
    let desc_lower = task.description.to_lowercase();
    if title_lower.contains("test") || title_lower.contains("integration")
        || desc_lower.contains("test") || desc_lower.contains("integration")
    {
        ctx.push_str(
            "\nIMPORTANT: This task involves writing tests. Before writing any test code, \
             read the struct/type definitions for every type you will construct or call methods on. \
             Verify exact field names, constructor signatures (::new() parameters), and return types. \
             Do NOT rely on memory or inference from method signatures in store/service files.\n"
        );
    }

    ctx
}

fn format_completed_deps(completed_deps: &[Task]) -> String {
    let mut output = String::new();
    let mut dep_budget = 5_000usize;
    for dep in completed_deps {
        let files_list = dep.files_changed.iter()
            .map(|fc| format!("{} ({})", fc.path, fc.op))
            .collect::<Vec<_>>()
            .join(", ");
        let section = format!(
            "## {}\n{}\nFiles: {}\n\n",
            dep.title,
            dep.execution_notes,
            files_list,
        );
        if section.len() > dep_budget {
            break;
        }
        dep_budget -= section.len();
        output.push_str(&section);
    }
    output
}
