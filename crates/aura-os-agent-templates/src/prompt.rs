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
}
