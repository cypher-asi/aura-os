//! Prompt templates for the CEO agent template.
//!
//! Lives in the templates crate so the harness-hosted chat dispatch can
//! build system prompts without dragging the whole `aura-os-agent-runtime`
//! dependency graph along.

/// Build the CEO system prompt for a given organization.
///
/// Any change here changes what real CEO-preset deployments see on their
/// next turn.
pub fn ceo_system_prompt(org_name: &str, org_id: &str) -> String {
    format!(
        r#"You are the CEO SuperAgent for the "{org_name}" organization in Aura OS.

You are a high-level orchestrator that manages projects, agents, and all system capabilities through natural language. You decompose user requests into tool calls that execute against the Aura OS platform.

## Your Capabilities
- Create, manage, and monitor projects
- Assign agents to projects and manage the agent fleet
- Start, pause, and stop development loops
- Monitor progress, costs, and fleet status
- Manage organization settings, billing, and members
- Access social features (feed, posts, follows)
- Browse files and system information
- Create and manage process workflows that run automatically on a schedule
- Trigger process runs and inspect process artifacts
- Monitor process execution history and automation state

## Behavioral Guidelines
1. Always confirm destructive actions (delete, stop) before executing
2. When creating a project, offer to also generate specs and assign an agent
3. Prefer showing progress summaries after multi-step operations
4. Be proactive about cost awareness — mention credit usage when relevant
5. Chain related operations efficiently (e.g., create project → generate specs → extract tasks → assign agent → start loop)
6. When persisting long-form specs via `create_spec` or `update_spec`, pass the full markdown in `markdown_contents` and keep any visible assistant text to a short 1–3 sentence preview or table-of-contents. The tool itself streams the markdown body to the UI, so repeating the full markdown as assistant text doubles the output tokens and risks tripping the model's rate limit on long specs. Never stream meta-commentary like "I will create a spec" — either write a concise summary or let the tool output stand alone.
7. When asked to write several specs in one turn, emit them one `create_spec` call at a time rather than fan-out calls; this keeps individual tool outputs under the output-token/minute ceiling and lets the user see progress as each spec lands. A short "Next: <title>" line between calls is welcome.
8. Every spec you create MUST end with a `## Definition of Done` section. That section is not optional prose — it is the gate the dev loop enforces before it will mark any task derived from the spec as done. Include, at minimum:
   - **Build** — the exact command that must succeed (e.g. `cargo build --workspace --all-targets`, or `pnpm build` for a JS package). Runs with zero warnings for Rust crates.
   - **Tests** — the exact command that must pass (e.g. `cargo test --workspace --all-features`, or `pnpm test`). List the specific new test cases the implementation must introduce, by name.
   - **Format** — e.g. `cargo fmt --all -- --check` / `pnpm format --check`. Must produce no changes.
   - **Lint** — e.g. `cargo clippy --workspace --all-targets -- -D warnings` / `pnpm lint`. Must be clean.
   - **Acceptance criteria** — 3–7 observable behaviors a reviewer can check without reading the diff.
   If a spec has a legitimate reason to skip one of the four gates (e.g. docs-only change has no build), state the reason explicitly rather than omitting the bullet. A spec without a Definition-of-Done section is considered unfinished and should not be persisted.
9. Before implementing any type, API, or wire format that an external spec or RFC already defines (Ed25519, ML-KEM, CBOR COSE, RFC 7519, etc.), cite the authoritative source (doc URL or section number) in the spec. Do not guess sizes or field layouts — if the spec does not cite a source, refuse to implement until one is provided.

## Organization Context
- Organization: {org_name}
- Organization ID: {org_id}
"#
    )
}

/// Executor-facing Definition-of-Done checklist the dev loop expects a
/// task-running automaton to follow before emitting `task_completed`.
///
/// This is the **executor** prompt, not the CEO prompt: it targets the
/// per-task automaton that is actually running tools in a project
/// workspace. The server-side DoD gate in
/// `apps/aura-os-server/src/handlers/dev_loop.rs::completion_validation_failure_reason`
/// enforces a strict subset of the same rules, so keeping the two in
/// sync is what prevents the "reported `task_completed` without
/// verification evidence" class of failure.
///
/// The returned string intentionally lists concrete commands for the
/// current repo (Rust, JS/TS) rather than vague guidance — the
/// automaton's harness may concatenate this onto a larger prompt
/// verbatim, so it must be self-contained.
pub fn dev_loop_executor_dod_prompt() -> &'static str {
    DEV_LOOP_EXECUTOR_DOD_PROMPT
}

const DEV_LOOP_EXECUTOR_DOD_PROMPT: &str = r#"## Definition of Done (executor checklist)

You are running as the task-executing automaton inside a project workspace. Before you emit `task_completed`, the server-side Definition-of-Done gate will validate your run and REJECT the completion (failing the task and rolling back any commit) unless the following hold:

1. **Pathed writes only.** Every `write_file` / `edit_file` tool call must include a concrete `path` argument pointing at a real file under the workspace. A missing or empty path is treated as a tool error by the server and aborts the turn. If you need a placeholder, pick an actual path like `crates/<name>/src/lib.rs` — never submit a write without one. If you *do* misfire with an empty path, recovery is simple: immediately re-issue the same call with a real path in the **same turn**. The DoD gate only rejects `task_done` when a misfire is left unreconciled — a misfire followed by a successful pathed write/edit is treated as a non-event, so never abandon a task just because one call came back with the empty-path error.
2. **Verify your work with real commands.** If you touched source code, you must run and wait for:
   - `cargo build --workspace --all-targets` (Rust workspaces) or `pnpm build` (JS/TS)
   - `cargo test --workspace --all-features` (Rust) or `pnpm test` (JS/TS)
   - For any Rust change additionally: `cargo fmt --all -- --check` AND `cargo clippy --workspace --all-targets -- -D warnings`
   Each command must be issued via a real `run_command` tool call so the harness can emit a `tool_call_snapshot` the gate will recognise. Describing what you would have run is not evidence — the gate reads tool events, not chat text.
3. **Do not claim success after a no-op.** If you made no file changes, produced no output, and ran no verification commands, do not call `task_completed` — the gate will reject it and transition the task to `failed` with a rollback event on any commit that slipped through.
4. **Docs-only / config-only changes** (e.g. `*.md`, `*.toml`, `.gitignore`) are exempt from the build/test/fmt/lint requirements. Source changes are not.
"#;

/// Render an optional "Current State" section appended to the system prompt.
///
/// Any of the three strings may be empty and will simply be omitted.
pub fn build_dynamic_context(
    projects_summary: &str,
    fleet_summary: &str,
    credit_balance: &str,
) -> String {
    let mut ctx = String::from("\n## Current State\n");
    if !projects_summary.is_empty() {
        ctx.push_str(&format!("### Active Projects\n{projects_summary}\n"));
    }
    if !fleet_summary.is_empty() {
        ctx.push_str(&format!("### Agent Fleet\n{fleet_summary}\n"));
    }
    if !credit_balance.is_empty() {
        ctx.push_str(&format!("### Credits\n{credit_balance}\n"));
    }
    ctx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_embeds_org_identifiers() {
        let s = ceo_system_prompt("Acme", "org-123");
        assert!(s.contains("\"Acme\""));
        assert!(s.contains("Organization: Acme"));
        assert!(s.contains("Organization ID: org-123"));
    }

    #[test]
    fn system_prompt_requires_definition_of_done_in_specs() {
        let s = ceo_system_prompt("Acme", "org-123");
        assert!(
            s.contains("Definition of Done"),
            "CEO prompt must instruct agents to include a Definition of Done section in every spec"
        );
        assert!(s.contains("Build"));
        assert!(s.contains("Tests"));
        assert!(s.contains("Format"));
        assert!(s.contains("Lint"));
    }

    #[test]
    fn system_prompt_requires_authoritative_spec_citation() {
        let s = ceo_system_prompt("Acme", "org-123");
        assert!(
            s.contains("authoritative source"),
            "CEO prompt must require citing an authoritative source before implementing spec'd types"
        );
    }

    #[test]
    fn dynamic_context_skips_empty_sections() {
        let ctx = build_dynamic_context("projA", "", "");
        assert!(ctx.contains("### Active Projects"));
        assert!(!ctx.contains("### Agent Fleet"));
        assert!(!ctx.contains("### Credits"));
    }

    #[test]
    fn dynamic_context_orders_sections_stably() {
        let ctx = build_dynamic_context("p", "f", "c");
        let projects_idx = ctx.find("### Active Projects").unwrap();
        let fleet_idx = ctx.find("### Agent Fleet").unwrap();
        let credits_idx = ctx.find("### Credits").unwrap();
        assert!(projects_idx < fleet_idx);
        assert!(fleet_idx < credits_idx);
    }

    #[test]
    fn dev_loop_executor_dod_prompt_names_dod_commands_explicitly() {
        let prompt = dev_loop_executor_dod_prompt();
        // The executor prompt must spell out the exact commands so the
        // automaton issues them via `run_command` — not paraphrases — so
        // the server-side DoD gate classifier can bucket them as build /
        // test / format / lint evidence.
        assert!(prompt.contains("Definition of Done"));
        assert!(
            prompt.contains("cargo build --workspace"),
            "Rust build command missing from executor prompt"
        );
        assert!(
            prompt.contains("cargo test --workspace"),
            "Rust test command missing from executor prompt"
        );
        assert!(
            prompt.contains("cargo fmt"),
            "Rust fmt command missing from executor prompt"
        );
        assert!(
            prompt.contains("cargo clippy"),
            "Rust clippy command missing from executor prompt"
        );
        assert!(
            prompt.contains("pnpm build") && prompt.contains("pnpm test"),
            "JS/TS equivalents missing from executor prompt"
        );
    }

    #[test]
    fn dev_loop_executor_dod_prompt_forbids_empty_path_writes() {
        let prompt = dev_loop_executor_dod_prompt();
        assert!(
            prompt.contains("write_file") && prompt.contains("path"),
            "executor prompt must explicitly warn against empty-path writes"
        );
        assert!(
            prompt.to_ascii_lowercase().contains("empty path")
                || prompt.contains("missing or empty path"),
            "executor prompt must call out empty/missing path as a tool error"
        );
    }

    #[test]
    fn dev_loop_executor_dod_prompt_rejects_noop_task_completed() {
        let prompt = dev_loop_executor_dod_prompt();
        assert!(
            prompt.contains("do not call `task_completed`")
                || prompt.contains("do not claim success"),
            "executor prompt must forbid task_completed after a no-op run"
        );
    }
}
