use std::path::Path;

use aura_core::*;

use super::build_fix::{classify_build_errors, error_category_guidance, parse_error_references, BuildFixAttemptRecord};
use crate::file_ops::{self, StubReport};

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
- Do NOT use emojis in any text fields

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
- Do NOT use emojis in any text fields

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

pub(crate) fn agentic_execution_system_prompt(
    project: &Project,
    agent: Option<&AgentInstance>,
    workspace_info: Option<&str>,
) -> String {
    let build_cmd = project.build_command.as_deref().unwrap_or("(not configured)");
    let test_cmd = project.test_command.as_deref().unwrap_or("(not configured)");

    let mut preamble = String::new();
    if let Some(a) = agent {
        if !a.system_prompt.is_empty() {
            preamble.push_str(&a.system_prompt);
            preamble.push_str("\n\n");
        }
        let has_identity = !a.name.is_empty() || !a.role.is_empty() || !a.personality.is_empty();
        if has_identity {
            preamble.push_str("You are");
            if !a.name.is_empty() {
                preamble.push_str(&format!(" {}", a.name));
            }
            if !a.role.is_empty() {
                preamble.push_str(&format!(", a {}", a.role));
            }
            preamble.push('.');
            if !a.personality.is_empty() {
                preamble.push_str(&format!(" {}", a.personality));
            }
            preamble.push_str("\n\n");
        }
        if !a.skills.is_empty() {
            preamble.push_str(&format!(
                "Your capabilities include: {}.\n\n",
                a.skills.join(", ")
            ));
        }
    }

    let platform_info = if cfg!(windows) {
        "Platform: Windows. Shell commands run via `cmd /C`. Use PowerShell or \
         Windows-compatible syntax. Avoid Unix-only tools (grep, sed, awk, head, \
         tail, wc, cat). Prefer the built-in tools (search_code, read_file, \
         find_files, list_files) over shell commands for file exploration."
    } else if cfg!(target_os = "macos") {
        "Platform: macOS. Shell commands run via `sh -c`."
    } else {
        "Platform: Linux. Shell commands run via `sh -c`."
    };

    let mut prompt = format!(
        r#"{preamble}You are an expert software engineer executing a single implementation task.
You have tools to explore the codebase, make changes, and verify your work.

{platform_info}

Workflow:
1. Use get_task_context if you need to review the task details
2. Briefly explore (hard limit: ~12 exploration calls before blocking) using read_file, search_code, find_files, list_files. NEVER re-read a file -- read it once fully or use search_code.
3. Form a plan, then make changes using write_file (new files) or edit_file (targeted edits)
4. Verify your changes compile (including tests): run_command with `cargo check --workspace --tests` or the build command
5. Fix any errors iteratively
6. When done, call task_done with your notes

Build command: {build_cmd}
Test command: {test_cmd}

Rules:
- Always verify your changes compile before calling task_done
- Use edit_file for targeted changes to existing files, write_file for new files or full rewrites
- For new files longer than ~80-100 lines, do NOT write the entire file in one write_file call. Write a short skeleton first (e.g. module doc, imports, one small function or test), then use edit_file repeatedly to add the rest in logical chunks (one test or section at a time). This avoids output truncation.
- Search before writing to understand existing code patterns
- Never use non-ASCII characters (em dashes, smart quotes, ellipsis) in source code
- For Rust: use raw string literals for multi-line strings, prefer serde_json::json!() for JSON in tests
- For TypeScript: use forward slashes in import paths
- If a build or test compilation fails, read the errors carefully and fix them before calling task_done
- Do NOT call task_done until the build passes
- Do NOT use emojis in notes or any text output

TOOL USAGE:
- Do NOT use run_command for searching code, reading files, or finding files. Always use the dedicated tools: search_code, read_file, find_files, list_files. Reserve run_command for build, test, git, and package manager commands only.

EXPLORATION LIMITS (ENFORCED):
- You have a hard limit of ~12 exploration calls (read_file + search_code) before reads are blocked.
- NEVER read the same file multiple times. Read it once in full, or use search_code to find specific lines.
- After reading 5 files, you MUST start implementing. You can always read more files later if needed during editing.
- Reading without writing wastes your budget. Every read costs tokens that could be spent on implementation.

SCOPE: Stay strictly on-task.
- ONLY implement what the task description asks for. Do NOT fix pre-existing bugs or code issues unrelated to your task.
- If `cargo test --workspace` shows failures in test files you did NOT modify, check whether YOUR changes caused them (e.g., you changed a struct and tests that use it now fail). If so, fix them. If they are pre-existing and unrelated to your changes, IGNORE them.
- Once your task-specific changes compile and any directly-related tests pass, call task_done immediately. Do NOT keep exploring or "improving" unrelated code.
- When verifying, prefer scoped commands (e.g. `cargo test -p <crate> --lib <module>`) over workspace-wide commands to avoid noise from pre-existing failures.
- NEVER output raw JSON with file_ops in your text response. Always use the provided tools (write_file, edit_file, task_done, etc.) to make changes and signal completion.
"#
    );

    if let Some(ws_info) = workspace_info {
        let crate_count = ws_info.lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("multiple");
        prompt.push_str(&format!(
            r#"
## Workspace Context
This is a Rust workspace with {crate_count} crate members. Before implementing:
1. Check the Workspace Structure section in the task context to understand crate dependencies
2. The codebase snapshot below contains dependency APIs. Refer to it instead of reading files. Only read files you need to modify
3. NEVER guess type signatures, method names, or struct fields -- verify by reading source
4. If you declare `pub mod foo;`, create foo.rs in the same set of file operations
5. Use the codebase snapshot to understand existing patterns before writing new code
"#
        ));
    }

    prompt
}

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
            ctx.push_str(&section);
        }
        ctx.push('\n');
    }

    if !work_log_summary.is_empty() {
        ctx.push_str(&format!(
            "# Session Progress (tasks completed so far)\n{}\n\n",
            work_log_summary
        ));
    }

    ctx.push_str(
        "Briefly explore the codebase to confirm the current state (hard limit: ~12 exploration calls \
         before reads are blocked), then form a plan and begin implementing. NEVER read the same file \
         twice. Do not exhaustively read every file -- focus on files you need to modify. Prefer \
         targeted reads (with start_line/end_line) over full-file reads when you only need a specific section.\n"
    );
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

    let truncated_stderr = truncate_prompt_output(stderr, 8000);
    prompt.push_str(&format!("## stderr\n```\n{}\n```\n\n", truncated_stderr));

    if !stdout.is_empty() {
        let truncated_stdout = truncate_prompt_output(stdout, 4000);
        prompt.push_str(&format!("## stdout\n```\n{}\n```\n\n", truncated_stdout));
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

    let error_source_files = file_ops::resolve_error_source_files(
        Path::new(&project.linked_folder_path),
        &error_refs,
        file_ops::ERROR_SOURCE_BUDGET,
    );
    if !error_source_files.is_empty() {
        prompt.push_str(&error_source_files);
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

fn truncate_prompt_output(s: &str, max_chars: usize) -> String {
    if s.len() <= max_chars {
        return s.to_string();
    }
    let half = max_chars / 2;
    let start = &s[..half];
    let end = &s[s.len() - half..];
    format!("{start}\n\n... (truncated {0} bytes) ...\n\n{end}", s.len() - max_chars)
}

/// Build a prompt that tells the agent to replace stub/placeholder code with
/// real implementations. Used as a follow-up when stub detection fires after
/// an otherwise-successful build.
pub(crate) fn build_stub_fix_prompt(stub_reports: &[StubReport]) -> String {
    let mut prompt = String::from(
        "STOP: Your implementation compiles but contains stub/placeholder code that must be \
         filled in. The following locations have incomplete implementations:\n\n"
    );

    for report in stub_reports {
        prompt.push_str(&format!(
            "- {}:{} -- {}\n  ```\n  {}\n  ```\n\n",
            report.path, report.line, report.pattern, report.context,
        ));
    }

    prompt.push_str(
        "Replace ALL stubs with real, working implementations. Read the spec and codebase \
         to understand what each function should do, then implement it fully.\n\
         Do NOT use todo!(), unimplemented!(), Default::default() as a placeholder, or \
         ignore function parameters with _ prefixes.\n\
         After fixing, verify the build still passes, then call task_done.\n"
    );

    prompt
}
