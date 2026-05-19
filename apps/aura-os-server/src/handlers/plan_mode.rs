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
/// harness can't structurally enforce (e.g. the `## Definition of Done`
/// suffix, external-spec citation).
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
Every spec you create or update MUST end with a `## Definition of Done` section that lists the exact build, test, format, and lint commands that must pass before any task derived from the spec can be marked done, plus 3\u{2013}7 observable acceptance criteria.\n\
\n\
If you implement a type that is defined by an external spec or RFC, cite the authoritative source (URL or section number) in the spec itself \u{2014} do not guess sizes, field layouts, or constants.";

/// Per-turn preamble prepended to every plan-mode user message on the
/// wire. Kept deliberately short so it does not eat into the model's
/// turn budget on top of the system-prompt suffix above.
pub(crate) const PLAN_MODE_USER_PREAMBLE: &str = "[plan-mode] You are in plan mode for this turn. Inspect with read-only tools, capture work in specs via `create_spec` / `update_spec`, and organize tasks via `create_task` / `update_task` / `delete_task` / `transition_task`. Do not write or edit source files, do not run commands, do not mark tasks done, and do not transition tasks to `in_progress` or `done`. Every spec must end with a `## Definition of Done` section.";

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
