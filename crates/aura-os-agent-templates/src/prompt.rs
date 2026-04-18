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
6. When drafting long-form specs or other substantial markdown that will be persisted via tools such as `create_spec` or `update_spec`, first stream the actual draft markdown visibly as normal assistant text, then call the tool with that same finalized markdown. Do not stream meta-commentary like "I will create a spec" as the draft. The visible text should be the real spec body the user is meant to read.

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
