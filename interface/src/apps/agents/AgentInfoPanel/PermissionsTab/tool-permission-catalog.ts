import { TOOL_LABELS } from "../../../../constants/tools";

/**
 * Default tool catalog rendered in the Permissions tab's editable
 * "Tool permissions" section. Every agent gets these tools by default
 * (subject to the capability bundle); each row carries a tri-state
 * On / Ask / Off control persisted on `agent.permissions.tool_permissions`.
 *
 * Names must match the harness / org-tool wire names exactly:
 * - harness-native tools: `tool_dedupe.rs::HARNESS_NATIVE_TOOL_NAMES`
 * - server-installed tools: `handlers/agents/chat/tools.rs`
 * - provider-less org tools: `infra/shared/org-integration-tools.json`
 *
 * Provider-gated integration tools (GitHub, Slack, …) are intentionally
 * not listed here — their availability is driven by org integrations
 * and shown in the read-only "Active harness tools" diagnostic below.
 */
export interface ToolPermissionGroup {
  id: string;
  label: string;
  tools: string[];
}

export const TOOL_PERMISSION_GROUPS: ToolPermissionGroup[] = [
  {
    id: "media",
    label: "Media generation",
    tools: ["generate_image", "generate_video", "generate_3d_model"],
  },
  {
    id: "filesystem",
    label: "Filesystem",
    tools: [
      "read_file",
      "write_file",
      "edit_file",
      "delete_file",
      "list_files",
      "stat_file",
      "find_files",
      "search_code",
    ],
  },
  {
    id: "shell",
    label: "Shell & git",
    tools: ["run_command", "git_commit", "git_push", "git_commit_push"],
  },
  {
    id: "agents",
    label: "Agents",
    tools: [
      "spawn_agent",
      "send_to_agent",
      "agent_lifecycle",
      "get_agent_state",
      "list_agents",
      "delegate_task",
      "task",
    ],
  },
  {
    id: "project",
    label: "Specs & tasks",
    tools: [
      "list_specs",
      "get_spec",
      "create_spec",
      "update_spec",
      "update_spec_section",
      "append_to_spec",
      "delete_spec",
      "list_tasks",
      "create_task",
      "update_task",
      "delete_task",
      "transition_task",
      "run_task",
      "get_project",
      "update_project",
      "set_project_workspace",
    ],
  },
  {
    id: "automation",
    label: "Automation loop",
    tools: ["start_dev_loop", "pause_dev_loop", "stop_dev_loop"],
  },
];

/** Human-readable label for a tool name, falling back to the raw name. */
export function toolPermissionLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}
