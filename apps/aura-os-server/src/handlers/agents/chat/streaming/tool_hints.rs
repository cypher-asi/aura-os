//! Per-turn `tool_hints` builder. Combines client-supplied command
//! hints (`/image`, `/3d`) with the plan-mode tool surface when this
//! turn is a plan-mode request so the harness sees both intents.

pub(super) fn tool_hints_from_commands(commands: Option<&[String]>) -> Option<Vec<String>> {
    let mut hints = Vec::new();
    for command in commands.unwrap_or(&[]) {
        let hint = match command.as_str() {
            "generate_image" => "generate_image",
            "generate_3d" | "generate_3d_model" => "generate_3d_model",
            _ => continue,
        };
        if !hints.iter().any(|existing| existing == hint) {
            hints.push(hint.to_string());
        }
    }
    (!hints.is_empty()).then_some(hints)
}

/// Build the final `tool_hints` payload for a chat turn. Merges the
/// command-derived hints with the plan-mode hints (when this is a
/// plan-mode turn) and dedupes so a caller that asked for a media
/// command on a plan-mode turn still sees both surfaces. Returns
/// `None` only when both inputs are empty so the on-wire payload stays
/// `Option<Vec<_>>` and clients without hints see the same shape as
/// before.
pub(super) fn build_turn_tool_hints(
    commands: Option<&[String]>,
    is_plan_mode: bool,
) -> Option<Vec<String>> {
    let command_hints = tool_hints_from_commands(commands).unwrap_or_default();
    let mut merged = command_hints;
    if is_plan_mode {
        for hint in crate::handlers::plan_mode::plan_mode_tool_hints() {
            if !merged.iter().any(|existing| existing == &hint) {
                merged.push(hint);
            }
        }
    }
    (!merged.is_empty()).then_some(merged)
}

#[cfg(test)]
mod tests {
    use super::{build_turn_tool_hints, tool_hints_from_commands};

    #[test]
    fn tool_hints_from_commands_maps_generation_commands() {
        let commands = vec![
            "generate_image".to_string(),
            "generate_3d".to_string(),
            "unknown".to_string(),
        ];

        assert_eq!(
            tool_hints_from_commands(Some(&commands)),
            Some(vec![
                "generate_image".to_string(),
                "generate_3d_model".to_string(),
            ]),
        );
    }

    #[test]
    fn tool_hints_from_commands_dedupes_and_ignores_unknowns() {
        let commands = vec![
            "generate_image".to_string(),
            "generate_image".to_string(),
            "not_a_tool".to_string(),
        ];

        assert_eq!(
            tool_hints_from_commands(Some(&commands)),
            Some(vec!["generate_image".to_string()]),
        );
        assert_eq!(tool_hints_from_commands(None), None);
    }

    #[test]
    fn build_turn_tool_hints_code_mode_passes_through_command_hints() {
        let commands = vec!["generate_image".to_string()];
        let hints = build_turn_tool_hints(Some(&commands), /* is_plan_mode */ false)
            .expect("hints derived from command");
        assert_eq!(hints, vec!["generate_image".to_string()]);
        assert!(build_turn_tool_hints(None, false).is_none());
    }

    #[test]
    fn build_turn_tool_hints_plan_mode_adds_plan_mode_surface() {
        let hints = build_turn_tool_hints(None, /* is_plan_mode */ true)
            .expect("plan mode must populate hints even without commands");
        assert!(
            hints.iter().any(|h| h == "create_spec"),
            "plan-mode hints must include `create_spec`, got {hints:?}",
        );
        assert!(
            hints.iter().any(|h| h == "read_file"),
            "plan-mode hints must include `read_file`, got {hints:?}",
        );
        for task_tool in [
            "create_task",
            "update_task",
            "delete_task",
            "transition_task",
        ] {
            assert!(
                hints.iter().any(|h| h == task_tool),
                "plan-mode hints must include `{task_tool}` so the planner can organize tasks, got {hints:?}",
            );
        }
        assert!(
            hints.iter().all(|h| h != "write_file"),
            "plan-mode hints must NEVER list a code-writing tool, got {hints:?}",
        );
        for code_tool in ["run_task", "retry_task", "task_done", "submit_plan"] {
            assert!(
                hints.iter().all(|h| h != code_tool),
                "plan-mode hints must NEVER list `{code_tool}` (execution surface), got {hints:?}",
            );
        }
    }

    #[test]
    fn build_turn_tool_hints_plan_mode_merges_and_dedupes_with_commands() {
        // A user that picks plan mode and ALSO attaches a `/image`
        // slash command must end up with both surfaces in the
        // outbound `tool_hints` so the harness sees the user's
        // explicit intent without losing the plan-mode steering. The
        // dedupe guard fires on tool names common to both lists
        // (today only the plan-mode read/spec tools — no overlap
        // with the media commands, but the test pins the contract).
        let commands = vec!["generate_image".to_string()];
        let hints =
            build_turn_tool_hints(Some(&commands), /* is_plan_mode */ true).expect("merged hints");
        assert!(
            hints.iter().any(|h| h == "generate_image"),
            "merged hints must keep the command-derived entry, got {hints:?}",
        );
        assert!(
            hints.iter().any(|h| h == "create_spec"),
            "merged hints must include the plan-mode entries, got {hints:?}",
        );
        let mut seen = std::collections::BTreeSet::new();
        for hint in &hints {
            assert!(
                seen.insert(hint.clone()),
                "build_turn_tool_hints must dedupe; saw `{hint}` twice in {hints:?}",
            );
        }
    }
}
