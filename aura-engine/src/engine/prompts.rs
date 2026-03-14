use std::path::Path;

use aura_core::*;

use super::build_fix::{classify_build_errors, error_category_guidance, parse_error_references, BuildFixAttemptRecord};
use crate::file_ops;

pub(crate) fn task_execution_system_prompt() -> String {
    format!(r#"
You are an expert software engineer executing a single implementation task.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanation,
reasoning, commentary, or markdown fences before or after the JSON. Your
entire response must be parseable as a single JSON value.

Rules:
- "notes": brief summary of what you did (or why you could not)
- "file_ops": array of file operations. Each has "op" ("create", "modify", or "delete"), "path" (relative to project root), and "content" (full file content; omit for delete)
- "follow_up_tasks": optional array of {{"title", "description"}} if you discover missing prerequisites; otherwise omit or use []
- For "modify", always provide the complete new file content, not a diff
- If you cannot complete the task, set notes to explain why and leave file_ops as []

## Language-Specific Rules (MUST FOLLOW)

### Rust (.rs files)
- NEVER use non-ASCII characters (em dashes, smart quotes, ellipsis, etc.) anywhere in source code. Use ASCII equivalents only.
- For test fixtures, multi-line strings, or any string containing quotes/backslashes/special characters: use Rust raw string literals (r followed by one or more {hash} then a quote to open, and a quote followed by the same number of {hash} to close).
- For constructing JSON in tests: prefer serde_json::json!() macro over string literals.
- Remember that \n inside a JSON string value (in your response) becomes a literal newline in the Rust source file. If you want the Rust string to contain a newline escape, you need \\n in your JSON.
- If you declare `pub mod foo;` in mod.rs or lib.rs, the file foo.rs (or foo/mod.rs) MUST exist. Create it in the same response.
- Do NOT call methods that don't exist on a type. Read the codebase snapshot to check actual APIs.

### TypeScript/JavaScript (.ts/.tsx/.js/.jsx files)
- Use forward slashes in import paths, never backslashes.
- Ensure all imported modules exist or are declared as dependencies.

Response schema:
{{"notes":"...","file_ops":[{{"op":"create","path":"src/foo.rs","content":"..."}}],"follow_up_tasks":[]}}
"#, hash = "#")
}

pub(crate) fn build_fix_system_prompt() -> String {
    format!(r#"
You are an expert software engineer fixing build/test errors in existing code.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanation,
reasoning, commentary, or markdown fences before or after the JSON. Your
entire response must be parseable as a single JSON value.

Rules:
- "notes": brief summary of what you fixed
- "file_ops": array of file operations
- "follow_up_tasks": optional array of {{"title", "description"}}; omit or use []

## File Operation Types

You have FOUR operation types. **Prefer "search_replace" for fixes.**

### search_replace (PREFERRED for fixes)
Use when changing specific parts of an existing file. Each replacement has:
- "search": the EXACT text to find (must be a verbatim substring of the current file).
  Include enough surrounding context (3-5 lines) to ensure a unique match.
- "replace": the text to substitute in place of "search".

The "search" string MUST match exactly ONE location in the file. If it matches
zero or more than one location, the operation fails. Include sufficient context
lines to disambiguate.

Example:
{{"op":"search_replace","path":"src/foo.rs","replacements":[
  {{"search":"fn old_name(x: i32) {{\n    x + 1\n}}","replace":"fn new_name(x: i32) {{\n    x + 2\n}}"}}
]}}

### modify (use sparingly)
Use ONLY when rewriting more than ~50% of a file. Provides complete new file content.
{{"op":"modify","path":"src/foo.rs","content":"...entire file..."}}

### create
Use for new files. {{"op":"create","path":"src/bar.rs","content":"...entire file..."}}

### delete
Use to remove files. {{"op":"delete","path":"src/old.rs"}}

## Language-Specific Rules (MUST FOLLOW)

### Rust (.rs files)
- NEVER use non-ASCII characters (em dashes, smart quotes, ellipsis, etc.) anywhere in source code. Use ASCII equivalents only.
- For test fixtures and multi-line strings: use Rust raw string literals (r followed by one or more {hash} then a quote).
- For constructing JSON in tests: prefer serde_json::json!() macro over string literals.
- Remember that \n inside a JSON string value (in your response) becomes a literal newline in the Rust source file. If you want the Rust string to contain a newline escape, you need \\n in your JSON.
- Do NOT call methods that don't exist on a type. Check the codebase snapshot for actual APIs.

### TypeScript/JavaScript (.ts/.tsx/.js/.jsx files)
- Use forward slashes in import paths, never backslashes.
- Ensure all imported modules exist or are declared as dependencies.

Response schema:
{{"notes":"...","file_ops":[{{"op":"search_replace","path":"src/foo.rs","replacements":[{{"search":"old code","replace":"new code"}}]}}],"follow_up_tasks":[]}}
"#, hash = "#")
}

pub(crate) fn agentic_execution_system_prompt(project: &Project) -> String {
    let build_cmd = project.build_command.as_deref().unwrap_or("(not configured)");
    let test_cmd = project.test_command.as_deref().unwrap_or("(not configured)");
    format!(
        r#"You are an expert software engineer executing a single implementation task.
You have tools to explore the codebase, make changes, and verify your work.

Workflow:
1. Use get_task_context if you need to review the task details
2. Explore relevant files using read_file, search_code, find_files, list_files
3. Make changes using write_file (new files) or edit_file (targeted edits)
4. Verify your changes compile: run_command with the build command
5. Fix any errors iteratively
6. When done, call task_done with your notes

Build command: {build_cmd}
Test command: {test_cmd}

Rules:
- Always verify your changes compile before calling task_done
- Use edit_file for targeted changes to existing files, write_file for new files or full rewrites
- Search before writing to understand existing code patterns
- Never use non-ASCII characters (em dashes, smart quotes, ellipsis) in source code
- For Rust: use raw string literals for multi-line strings, prefer serde_json::json!() for JSON in tests
- For TypeScript: use forward slashes in import paths
- If a build fails, read the errors carefully and fix them before calling task_done
- Do NOT call task_done until the build passes

SCOPE: Stay strictly on-task.
- ONLY implement what the task description asks for. Do NOT fix pre-existing bugs, failing tests, or code issues that are unrelated to your task.
- If `cargo test --workspace` or the test command shows failures in test files you did NOT modify, IGNORE them. Only fix tests that directly test the feature you are implementing.
- Once your task-specific changes compile and any directly-related tests pass, call task_done immediately. Do NOT keep exploring or "improving" unrelated code.
- When verifying, prefer scoped commands (e.g. `cargo test -p <crate> --lib <module>`) over workspace-wide commands to avoid noise from pre-existing failures.
- NEVER output raw JSON with file_ops in your text response. Always use the provided tools (write_file, edit_file, task_done, etc.) to make changes and signal completion.
"#
    )
}

pub(crate) fn build_agentic_task_context(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
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
    ctx.push_str("Start by exploring the codebase to understand the current state, then implement the task.\n");
    ctx
}

pub(crate) fn build_execution_prompt(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(
        "# Project: {}\n{}\n\n",
        project.name, project.description
    ));

    prompt.push_str(&format!(
        "# Spec: {}\n{}\n\n",
        spec.title, spec.markdown_contents
    ));

    prompt.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        prompt.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }

    if !task.execution_notes.is_empty() {
        prompt.push_str(&format!(
            "# Notes from Prior Attempts\n{}\n\n",
            task.execution_notes
        ));
    }

    if !codebase_snapshot.is_empty() {
        prompt.push_str(&format!(
            "# Current Codebase Files\n{}\n",
            codebase_snapshot
        ));
    }

    prompt
}

#[allow(dead_code, clippy::too_many_arguments)]
pub(crate) fn build_fix_prompt(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
    build_command: &str,
    stderr: &str,
    stdout: &str,
    prior_notes: &str,
) -> String {
    let empty: Vec<BuildFixAttemptRecord> = vec![];
    build_fix_prompt_with_history(
        project, spec, task, session, codebase_snapshot,
        build_command, stderr, stdout, prior_notes, &empty,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_fix_prompt_with_history(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
    build_command: &str,
    stderr: &str,
    stdout: &str,
    prior_notes: &str,
    prior_attempts: &[BuildFixAttemptRecord],
) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(
        "# Project: {}\n{}\n\n",
        project.name, project.description
    ));
    prompt.push_str(&format!(
        "# Spec: {}\n{}\n\n",
        spec.title, spec.markdown_contents
    ));
    prompt.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        prompt.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }

    if !prior_notes.is_empty() {
        prompt.push_str(&format!(
            "# Notes from Initial Implementation\n{}\n\n",
            prior_notes
        ));
    }

    if !prior_attempts.is_empty() {
        prompt.push_str("# Previous Fix Attempts (all failed)\nThe following fixes were already attempted and did NOT solve the problem. You MUST try a fundamentally different approach.\n\n");
        for (i, attempt) in prior_attempts.iter().enumerate() {
            prompt.push_str(&format!("## Attempt {}\n", i + 1));
            if !attempt.files_changed.is_empty() {
                prompt.push_str("Files changed:\n");
                for f in &attempt.files_changed {
                    prompt.push_str(&format!("- {f}\n"));
                }
            }
            prompt.push_str(&format!("Error:\n```\n{}\n```\n\n", attempt.stderr));
        }
    }

    let mut categories = classify_build_errors(stderr);
    let error_refs = parse_error_references(stderr);
    let resolved_context = file_ops::resolve_error_context(
        Path::new(&project.linked_folder_path),
        &error_refs,
    );

    {
        let mut type_counts: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::new();
        for (t, _) in &error_refs.methods_not_found {
            *type_counts.entry(t.as_str()).or_insert(0) += 1;
        }
        if type_counts.values().any(|&c| c >= 5) || error_refs.wrong_arg_counts.len() >= 3 {
            categories.push(super::build_fix::ErrorCategory::RustApiHallucination);
        }
    }

    let guidance = error_category_guidance(&categories);

    prompt.push_str(&format!(
        "# Build/Test Verification FAILED\n\
         The command `{}` failed after the previous file operations were applied.\n\
         You MUST fix ALL errors below.\n\n",
        build_command
    ));

    if !guidance.is_empty() {
        prompt.push_str(&format!(
            "## Error Analysis & Required Fix Strategy\n{}\n",
            guidance
        ));
    }

    prompt.push_str(&format!("## stderr\n```\n{}\n```\n\n", stderr));

    if !stdout.is_empty() {
        prompt.push_str(&format!("## stdout\n```\n{}\n```\n\n", stdout));
    }

    if error_refs.methods_not_found.len() > 5 {
        prompt.push_str(
            "WARNING: You are calling 5+ methods that do not exist. You MUST use ONLY \
             the methods listed in the \"Actual API Reference\" section below. Do NOT \
             invent or guess method names.\n\n",
        );
    }

    if !resolved_context.is_empty() {
        prompt.push_str(&resolved_context);
        prompt.push('\n');
    }

    if !codebase_snapshot.is_empty() {
        prompt.push_str(&format!(
            "# Current Codebase Files (after previous changes)\n{}\n",
            codebase_snapshot
        ));
    }

    prompt
}
