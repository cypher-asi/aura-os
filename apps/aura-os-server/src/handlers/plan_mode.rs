//! Shared spec-planning prompt + tool policy for "plan mode".
//!
//! Plan mode is the user-facing surface that lets a human (or another
//! agent) drive the planning loop without letting the harness reach for
//! code-mutating tools. It is invoked from three different entry points,
//! all of which funnel through this module so the wording and tool
//! policy stay in lock-step:
//!
//! * The auth'd chat handlers (`agents/chat/{instance_route,agent_route}.rs`)
//!   when the client sends `action=generate_specs`.
//! * The anonymous public-chat handler (`public/chat.rs`) when the
//!   request body carries `mode=plan`.
//! * The dedicated `POST /api/projects/:id/specs/generate` endpoint
//!   (`specs/gen.rs`), which previously embedded its own copy of the
//!   prompt + tool-hint list.
//!
//! Enforcement happens in two layers:
//!
//! 1. **Cold-start session config**: the system prompt gets
//!    [`PLAN_MODE_SYSTEM_PROMPT_SUFFIX`] appended and
//!    [`plan_mode_tool_permissions`] is stamped onto
//!    `SessionConfig.tool_permissions`. The harness applies these once
//!    when it opens the session; warm sessions keep whatever config
//!    they started with.
//! 2. **Per-turn directives**: every plan-mode user message is wrapped
//!    by [`wrap_user_content_for_plan_mode`] (the model sees the
//!    preamble; persistence stores the unwrapped user content) and
//!    [`plan_mode_tool_hints`] is added to the outbound
//!    [`aura_os_harness::SessionBridgeTurn`] so even a warm session
//!    that started in code mode still sees the plan-mode rules and
//!    tool-choice steering on every plan turn. A subsequent code-mode
//!    turn on the same session omits the wrapper, so the model does
//!    not carry the plan-mode framing forward.

use std::collections::BTreeMap;

use aura_protocol::{AgentToolPermissionsWire, ToolStateWire};

/// Appended to the cold-start system prompt for any plan-mode session.
/// Frames the agent as a spec author and lists the hard rules the
/// harness can't structurally enforce (the spec content contract, the
/// task content contract, external-spec citation, and the
/// transition/execution prohibitions).
pub(crate) const PLAN_MODE_SYSTEM_PROMPT_SUFFIX: &str = "\n\n# Plan mode\n\
You are operating in PLAN MODE. Your job is to design and document, not to implement.\n\
\n\
What you may do in this mode:\n\
- Inspect the project with read-only tools: `read_file`, `list_files`, `find_files`, `search_code`, `stat_file`.\n\
- Inspect existing specs/tasks/project metadata: `list_specs`, `get_spec`, `list_tasks`, `get_task_context`, `get_project`.\n\
- Author spec content using the spec tools: `create_spec`, `update_spec`. All spec body content lives there \u{2014} do NOT write specs to disk via `write_file`.\n\
- Organize tasks under existing specs using `create_task`, `update_task`, `delete_task`, and `transition_task`. Use these to break specs into actionable work, edit titles/descriptions, remove obsolete tasks, and move tasks between organizational statuses.\n\
\n\
What you MUST NOT do in this mode:\n\
- Do not modify source code in any way. `write_file`, `edit_file`, and `delete_file` are disabled.\n\
- Do not execute shell commands, run tasks, commit, push, or touch the dev loop. `run_command`, `run_task`, `retry_task`, `git_commit`, `git_push`, `start_dev_loop`, `pause_dev_loop`, and `stop_dev_loop` are disabled.\n\
- Do not mark tasks done or submit plans on the user's behalf. `task_done` and `submit_plan` are disabled.\n\
- Do not start or finish work via task status. You may NOT transition a task to `in_progress` or `done`, and you may NOT use `update_task` to set `status` to `in_progress` or `done`. Organizational moves (`ready`, `blocked`) are allowed; execution moves are not.\n\
\n\
# Spec content contract\n\
Inspect concrete files in the repo BEFORE writing a spec so you can name them, not guess. Vague specs produce vague tasks. Every spec you create or update MUST contain the following Markdown sections, in this order, with the headings spelled exactly as shown:\n\
- `## Background / Context` \u{2014} 1\u{2013}3 short paragraphs explaining the current state, the problem, and why this work matters now.\n\
- `## Goals` \u{2014} bullet list of the observable outcomes this spec is supposed to deliver.\n\
- `## Non-Goals` \u{2014} bullet list of things explicitly out of scope so a downstream task author does not expand the work.\n\
- `## Affected Files & Modules` \u{2014} bullet list of concrete repository paths (and module names where relevant) the implementer is expected to touch or read. Use real paths you confirmed via `read_file` / `list_files` / `search_code`; do not guess.\n\
- `## Interfaces & Signatures` \u{2014} when modifying existing code, paste the current function signatures, type definitions, error variants, or wire shapes verbatim from the source, then show the proposed shape after the change. For new code, give the proposed signatures only.\n\
- `## Design / Approach` \u{2014} the implementation plan in prose plus, where helpful, ordered steps. Reference the files and signatures above.\n\
- `## External References` \u{2014} URLs or section numbers for any externally-defined wire format, RFC, or upstream library behavior the work depends on. Write `None` if the change is purely internal.\n\
- `## Definition of Done` \u{2014} exact build, test, format, and lint commands that must pass before any task derived from the spec can be marked done, plus 3\u{2013}7 observable acceptance criteria.\n\
\n\
If you implement a type that is defined by an external spec or RFC, cite the authoritative source (URL or section number) under `## External References` \u{2014} do not guess sizes, field layouts, or constants.\n\
\n\
# Task content contract\n\
Tasks you create with `create_task` are read by an executor agent that may not re-open the parent spec. Each task `description` MUST be self-contained and MUST contain the following Markdown sections, in this order, with the headings spelled exactly as shown:\n\
- `## Goal` \u{2014} 1\u{2013}2 sentences naming the concrete change.\n\
- `## Context` \u{2014} quote 1\u{2013}3 lines from the parent spec (the relevant paragraph or bullet) so the executor has the rationale without re-reading the spec.\n\
- `## Files & Symbols` \u{2014} bullet list of concrete repository paths and the function / type / test names to read or modify. Use real paths confirmed against the repo.\n\
- `## Approach` \u{2014} concrete steps. For implementation work, include: briefly inspect, call `submit_plan` with the target files, then use `write_file` / `edit_file` / `delete_file`. Fold inspection and verification into the implementation task when possible.\n\
- `## Acceptance Criteria` \u{2014} 3\u{2013}5 observable bullets a reviewer can check without reading the diff.\n\
- `## Verification` \u{2014} exact build, test, format, and lint commands the executor must run before `task_done`. If a task genuinely needs no source edits, say so here and tell the executor to call `task_done` with `no_changes_needed: true` plus notes explaining why.";

/// Per-turn preamble prepended to every plan-mode user message on the
/// wire. Kept deliberately short so it does not eat into the model's
/// turn budget on top of the system-prompt suffix above. Names the
/// required spec/task sections so warm sessions that started before
/// the content contract landed still see it every turn.
pub(crate) const PLAN_MODE_USER_PREAMBLE: &str = "[plan-mode] You are in plan mode for this turn. Inspect with read-only tools, capture work in specs via `create_spec` / `update_spec`, and organize tasks via `create_task` / `update_task` / `delete_task` / `transition_task`. Do not write or edit source files, do not run commands, do not mark tasks done, and do not transition tasks to `in_progress` or `done`. Every spec must include `## Background / Context`, `## Goals`, `## Non-Goals`, `## Affected Files & Modules`, `## Interfaces & Signatures`, `## Design / Approach`, `## External References`, and `## Definition of Done`. Every task description must include `## Goal`, `## Context` (quoting the parent spec), `## Files & Symbols`, `## Approach`, `## Acceptance Criteria`, and `## Verification`.";

/// Tool name list used both as `tool_hints` on the outbound
/// `UserMessage` (which steers `tool_choice` on the first iteration of
/// the agent loop) and as the canonical set of tools plan mode actually
/// needs. Used by `instance_route`, `agent_route`, `public/chat.rs`,
/// and `specs/gen.rs`; tests pin the membership so regressions are
/// loud.
pub(crate) const PLAN_MODE_TOOL_HINT_NAMES: &[&str] = &[
    "read_file",
    "list_files",
    "find_files",
    "search_code",
    "stat_file",
    "list_specs",
    "get_spec",
    "create_spec",
    "update_spec",
    "list_tasks",
    "get_task_context",
    "get_project",
    "create_task",
    "update_task",
    "delete_task",
    "transition_task",
];

/// Code-mutating / side-effecting tools that plan mode turns off
/// structurally via `SessionConfig.tool_permissions`. The harness reads
/// this map on session open; any tool present here is hard-disabled
/// regardless of what `tool_hints` says. Anything NOT in this map keeps
/// whatever default state the user / agent already configured \u2014
/// plan mode is purely subtractive.
const PLAN_MODE_DISABLED_TOOLS: &[&str] = &[
    "write_file",
    "edit_file",
    "delete_file",
    "run_command",
    "run_task",
    "retry_task",
    "task_done",
    "submit_plan",
    "git_commit",
    "git_push",
    "start_dev_loop",
    "pause_dev_loop",
    "stop_dev_loop",
];

/// Build the per-session tool override map for plan mode. Every entry
/// is set to [`ToolStateWire::Off`] so the harness refuses to expose
/// the tool even if the agent's bundle would otherwise include it.
pub(crate) fn plan_mode_tool_permissions() -> AgentToolPermissionsWire {
    let mut per_tool = BTreeMap::new();
    for name in PLAN_MODE_DISABLED_TOOLS {
        per_tool.insert((*name).to_string(), ToolStateWire::Off);
    }
    AgentToolPermissionsWire { per_tool }
}

/// Resolve the per-session tool override map for a chat session: the
/// agent's **persisted** per-tool tri-state (edited in the Permissions
/// tab; empty = every tool `on`) with the plan-mode hard-disables
/// layered on top when this is a plan-mode session. Plan-mode `off`
/// entries win over any persisted state so a `generate_specs` turn can
/// never write code, regardless of how permissive the agent record is.
///
/// Returns `None` when there is nothing to override (no persisted
/// entries and not plan mode) so the wire request keeps the historical
/// "field absent" shape.
pub(crate) fn session_tool_permissions(
    persisted: &aura_os_core::AgentToolPermissions,
    is_plan_mode: bool,
) -> Option<AgentToolPermissionsWire> {
    let mut wire: AgentToolPermissionsWire = persisted.into();
    if is_plan_mode {
        wire.per_tool.extend(plan_mode_tool_permissions().per_tool);
    }
    (!wire.per_tool.is_empty()).then_some(wire)
}

/// Per-turn `tool_hints` payload. Cloned each call because the harness
/// API takes ownership.
pub(crate) fn plan_mode_tool_hints() -> Vec<String> {
    PLAN_MODE_TOOL_HINT_NAMES
        .iter()
        .map(|s| (*s).to_string())
        .collect()
}

/// Append the plan-mode rules to a cold-start system prompt. Returns
/// the suffixed string so the caller can drop it straight into
/// `SessionConfig.system_prompt`.
pub(crate) fn append_plan_mode_suffix(system_prompt: &str) -> String {
    let mut out = String::with_capacity(system_prompt.len() + PLAN_MODE_SYSTEM_PROMPT_SUFFIX.len());
    out.push_str(system_prompt);
    out.push_str(PLAN_MODE_SYSTEM_PROMPT_SUFFIX);
    out
}

/// Wrap the user's content with the plan-mode preamble for the
/// outbound `SessionBridgeTurn`. The persisted user message keeps the
/// raw `user_content`; only the harness-bound payload carries the
/// wrapper, so flipping back to code mode produces an unwrapped turn
/// and the model does not believe plan mode is still in effect.
///
/// Returns the original content untouched when it is empty so we do
/// not synthesize a user message out of thin air (the chat handlers'
/// own empty-content guards already cover the no-input case).
pub(crate) fn wrap_user_content_for_plan_mode(user_content: &str) -> String {
    if user_content.is_empty() {
        return PLAN_MODE_USER_PREAMBLE.to_string();
    }
    format!("{PLAN_MODE_USER_PREAMBLE}\n\n---\n\n{user_content}")
}

/// True when an inbound `action` field on the chat surface should
/// trigger plan-mode behaviour. Tolerant of casing / surrounding
/// whitespace for the same reason `projects_helpers::is_project_tool_action`
/// is: an upstream UI control could send `"Generate_Specs"` and we do
/// not want plan-mode wiring to silently fall off.
pub(crate) fn is_plan_mode_action(action: Option<&str>) -> bool {
    matches!(
        action
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("generate_specs")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_permissions_disable_every_code_writing_tool() {
        let perms = plan_mode_tool_permissions();
        for name in [
            "write_file",
            "edit_file",
            "delete_file",
            "run_command",
            "run_task",
            "retry_task",
            "task_done",
            "submit_plan",
            "git_commit",
            "git_push",
            "start_dev_loop",
            "pause_dev_loop",
            "stop_dev_loop",
        ] {
            assert_eq!(
                perms.per_tool.get(name),
                Some(&ToolStateWire::Off),
                "{name} must be hard-disabled in plan mode",
            );
        }
    }

    #[test]
    fn session_tool_permissions_returns_none_when_nothing_to_override() {
        let persisted = aura_os_core::AgentToolPermissions::default();
        assert!(session_tool_permissions(&persisted, false).is_none());
    }

    #[test]
    fn session_tool_permissions_forwards_persisted_overrides() {
        let mut persisted = aura_os_core::AgentToolPermissions::default();
        persisted
            .per_tool
            .insert("generate_video".into(), aura_os_core::ToolState::Ask);
        persisted
            .per_tool
            .insert("run_command".into(), aura_os_core::ToolState::Off);

        let wire = session_tool_permissions(&persisted, false).expect("overrides forwarded");
        assert_eq!(
            wire.per_tool.get("generate_video"),
            Some(&ToolStateWire::Ask)
        );
        assert_eq!(wire.per_tool.get("run_command"), Some(&ToolStateWire::Off));
    }

    #[test]
    fn session_tool_permissions_plan_mode_off_wins_over_persisted_on() {
        // The operator can pin `write_file` to `on`, but a plan-mode
        // session must still hard-disable it.
        let mut persisted = aura_os_core::AgentToolPermissions::default();
        persisted
            .per_tool
            .insert("write_file".into(), aura_os_core::ToolState::On);
        persisted
            .per_tool
            .insert("generate_image".into(), aura_os_core::ToolState::Ask);

        let wire = session_tool_permissions(&persisted, true).expect("plan-mode overrides");
        assert_eq!(wire.per_tool.get("write_file"), Some(&ToolStateWire::Off));
        // Non-conflicting persisted entries survive the merge.
        assert_eq!(
            wire.per_tool.get("generate_image"),
            Some(&ToolStateWire::Ask)
        );
    }

    #[test]
    fn tool_permissions_leave_read_and_spec_tools_unset() {
        let perms = plan_mode_tool_permissions();
        for name in [
            "read_file",
            "list_files",
            "find_files",
            "search_code",
            "list_specs",
            "get_spec",
            "create_spec",
            "update_spec",
            "create_task",
            "update_task",
            "delete_task",
            "transition_task",
        ] {
            assert!(
                !perms.per_tool.contains_key(name),
                "{name} must not be touched \u{2014} plan mode is subtractive",
            );
        }
    }

    #[test]
    fn tool_hints_cover_read_and_spec_surface() {
        let hints = plan_mode_tool_hints();
        for required in [
            "read_file",
            "list_files",
            "search_code",
            "list_specs",
            "get_spec",
            "create_spec",
            "update_spec",
            "create_task",
            "update_task",
            "delete_task",
            "transition_task",
        ] {
            assert!(
                hints.iter().any(|h| h == required),
                "plan-mode hints must include `{required}`, got {hints:?}",
            );
        }
        for forbidden in [
            "write_file",
            "edit_file",
            "run_command",
            "task_done",
            "run_task",
            "retry_task",
            "submit_plan",
        ] {
            assert!(
                hints.iter().all(|h| h != forbidden),
                "plan-mode hints must NOT include `{forbidden}`, got {hints:?}",
            );
        }
    }

    #[test]
    fn system_prompt_suffix_calls_out_status_restriction() {
        // Plan mode allows organizing tasks but forbids transitioning
        // them into execution states. Tool permissions are binary
        // on/off so this rule is prompt-enforced; if the wording
        // drifts, the steering quietly disappears. Pin it.
        assert!(
            PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains("transition a task to `in_progress` or `done`"),
            "plan-mode prompt must forbid transitioning tasks to in_progress or done, got: {PLAN_MODE_SYSTEM_PROMPT_SUFFIX}",
        );
        assert!(
            PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains("`create_task`")
                && PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains("`update_task`")
                && PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains("`delete_task`")
                && PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains("`transition_task`"),
            "plan-mode prompt must advertise the task-organization tool surface, got: {PLAN_MODE_SYSTEM_PROMPT_SUFFIX}",
        );
    }

    /// Pin the spec content contract: every required heading must
    /// appear verbatim in the suffix. The extraction prompt and tool
    /// schemas reference the same section names, so a drift here
    /// silently desynchronises the pipeline.
    #[test]
    fn system_prompt_suffix_pins_spec_content_contract() {
        for heading in [
            "# Spec content contract",
            "`## Background / Context`",
            "`## Goals`",
            "`## Non-Goals`",
            "`## Affected Files & Modules`",
            "`## Interfaces & Signatures`",
            "`## Design / Approach`",
            "`## External References`",
            "`## Definition of Done`",
        ] {
            assert!(
                PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains(heading),
                "plan-mode suffix must name the spec contract heading {heading:?}, got: {PLAN_MODE_SYSTEM_PROMPT_SUFFIX}",
            );
        }
        assert!(
            PLAN_MODE_SYSTEM_PROMPT_SUFFIX
                .contains("Inspect concrete files in the repo BEFORE writing a spec"),
            "plan-mode suffix must tell the model to inspect before authoring",
        );
    }

    /// Pin the task content contract on the suffix as well: plan mode
    /// is allowed to call `create_task` directly, so plan-mode-authored
    /// tasks must match the same shape as extraction-authored tasks.
    #[test]
    fn system_prompt_suffix_pins_task_content_contract() {
        for heading in [
            "# Task content contract",
            "`## Goal`",
            "`## Context`",
            "`## Files & Symbols`",
            "`## Approach`",
            "`## Acceptance Criteria`",
            "`## Verification`",
        ] {
            assert!(
                PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains(heading),
                "plan-mode suffix must name the task contract heading {heading:?}, got: {PLAN_MODE_SYSTEM_PROMPT_SUFFIX}",
            );
        }
        assert!(
            PLAN_MODE_SYSTEM_PROMPT_SUFFIX.contains("quote 1\u{2013}3 lines from the parent spec"),
            "plan-mode suffix must require Context to quote the parent spec",
        );
    }

    /// Pin the per-turn preamble. Warm sessions that started before
    /// the contract landed only see the preamble, so it has to name
    /// every required heading itself.
    #[test]
    fn user_preamble_mentions_required_sections() {
        for needle in [
            "`## Background / Context`",
            "`## Affected Files & Modules`",
            "`## Interfaces & Signatures`",
            "`## Definition of Done`",
            "`## Goal`",
            "`## Context`",
            "`## Files & Symbols`",
            "`## Acceptance Criteria`",
            "`## Verification`",
        ] {
            assert!(
                PLAN_MODE_USER_PREAMBLE.contains(needle),
                "plan-mode preamble must mention {needle:?}, got: {PLAN_MODE_USER_PREAMBLE}",
            );
        }
    }

    #[test]
    fn wrap_user_content_prepends_preamble_with_separator() {
        let wrapped = wrap_user_content_for_plan_mode("Plan a refactor of the storage layer.");
        assert!(
            wrapped.starts_with(PLAN_MODE_USER_PREAMBLE),
            "wrapped content must lead with the plan-mode preamble, got: {wrapped}",
        );
        assert!(
            wrapped.contains("\n\n---\n\n"),
            "wrapped content must separate preamble from user text with `\\n\\n---\\n\\n`, got: {wrapped}",
        );
        assert!(
            wrapped.ends_with("Plan a refactor of the storage layer."),
            "wrapped content must end with the verbatim user message, got: {wrapped}",
        );
    }

    #[test]
    fn wrap_user_content_handles_empty_input() {
        let wrapped = wrap_user_content_for_plan_mode("");
        assert_eq!(wrapped, PLAN_MODE_USER_PREAMBLE);
    }

    #[test]
    fn append_plan_mode_suffix_concatenates_without_extra_separator() {
        let base = "You are AURA.";
        let suffixed = append_plan_mode_suffix(base);
        assert!(suffixed.starts_with(base));
        assert!(suffixed.ends_with(PLAN_MODE_SYSTEM_PROMPT_SUFFIX));
        assert_eq!(
            suffixed.len(),
            base.len() + PLAN_MODE_SYSTEM_PROMPT_SUFFIX.len()
        );
    }

    #[test]
    fn is_plan_mode_action_matches_canonical_and_tolerates_casing() {
        assert!(is_plan_mode_action(Some("generate_specs")));
        assert!(is_plan_mode_action(Some("Generate_Specs")));
        assert!(is_plan_mode_action(Some("  generate_specs  ")));
    }

    #[test]
    fn is_plan_mode_action_rejects_unrelated_actions() {
        assert!(!is_plan_mode_action(None));
        assert!(!is_plan_mode_action(Some("")));
        assert!(!is_plan_mode_action(Some("chat")));
        assert!(!is_plan_mode_action(Some("plan")));
        assert!(!is_plan_mode_action(Some("extract_tasks")));
        assert!(!is_plan_mode_action(Some("regenerate_specs_summary")));
    }
}
