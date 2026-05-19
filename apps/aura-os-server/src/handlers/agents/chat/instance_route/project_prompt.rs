//! System-prompt assembly helpers that wrap the project-context block around an agent's prompt.

use aura_os_core::ProjectId;

use crate::state::AppState;

pub(crate) fn build_project_system_prompt(
    state: &AppState,
    project_id: &ProjectId,
    agent_prompt: &str,
    workspace_path: Option<&str>,
) -> String {
    let project_ctx = match state.project_service.get_project(project_id) {
        Ok(p) => render_project_context(project_id, &p.name, &p.description, workspace_path),
        Err(_) => render_project_context_fallback(project_id),
    };
    format!("{}{}", project_ctx, agent_prompt)
}

pub(crate) fn render_project_context(
    project_id: &ProjectId,
    name: &str,
    description: &str,
    workspace_path: Option<&str>,
) -> String {
    let mut ctx = format!(
        "<project_context>\nproject_id: {}\nproject_name: {}\n",
        project_id, name,
    );
    if !description.is_empty() {
        ctx.push_str(&format!("description: {}\n", description));
    }
    if let Some(workspace_path) = workspace_path.filter(|path| !path.is_empty()) {
        ctx.push_str(&format!("workspace: {}\n", workspace_path));
    }
    ctx.push_str("</project_context>\n\n");
    ctx.push_str("IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id from the project_context above.\n\n");
    ctx.push_str(
        "IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use paths relative to that root. \
         Never pass `/` or any other absolute host path to list_files, find_files, read_file, write_file, or run_command.\n\n",
    );
    ctx.push_str(
        "IMPORTANT: When creating or updating specs, put the markdown only in the `markdown_contents` tool argument and keep visible assistant text to a short preview. \
         Create large or multi-phase plans as multiple focused specs, one `create_spec` call at a time, instead of one huge markdown payload.\n\n",
    );
    ctx
}

pub(crate) fn render_project_context_fallback(project_id: &ProjectId) -> String {
    format!(
        "<project_context>\nproject_id: {}\n</project_context>\n\n\
         IMPORTANT: When calling tools that accept a project_id parameter, always use the project_id above.\n\n\
         IMPORTANT: For filesystem and command tools, treat the project root as `.` and always use relative paths. Never pass `/` or any other absolute host path.\n\n\
         IMPORTANT: When creating or updating specs, put the markdown only in the `markdown_contents` tool argument and keep visible assistant text to a short preview. Create large or multi-phase plans as multiple focused specs, one `create_spec` call at a time, instead of one huge markdown payload.\n\n",
        project_id,
    )
}
