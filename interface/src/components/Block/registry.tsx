import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../types/stream";
import { FileBlock } from "./renderers/FileBlock";
import { CommandBlock } from "./renderers/CommandBlock";
import { SpecBlock } from "./renderers/SpecBlock";
import { TaskBlock } from "./renderers/TaskBlock";
import { ListBlock } from "./renderers/ListBlock";
import { ImageBlock } from "./renderers/ImageBlock";
import { Model3DBlock } from "./renderers/Model3DBlock";
import { StatusReadoutBlock } from "./renderers/StatusReadoutBlock";
import { GenericToolBlock } from "./renderers/GenericToolBlock";

/**
 * Renderer contract: every block renderer takes a ToolCallEntry plus an
 * optional defaultExpanded hint and returns a ReactNode built around the
 * shared `Block` primitive.
 */
export type BlockRenderer = (entry: ToolCallEntry, defaultExpanded?: boolean) => ReactNode;

/**
 * Tools that default to expanded when a fresh streaming bubble flips into
 * its "just finalized" historical state. These are the ones whose body
 * carries useful review content (drafted spec, generated file, command
 * output). Everything else starts collapsed so the turn reads as a tight
 * checklist rather than a wall of JSON.
 */
const AUTO_EXPAND_TOOLS = new Set([
  "create_spec",
  "update_spec",
  "write_file",
  "edit_file",
  "run_command",
]);

export function isAutoExpandedTool(name: string): boolean {
  return AUTO_EXPAND_TOOLS.has(name);
}

const REGISTRY: Record<string, BlockRenderer> = {
  read_file: (entry, def) => <FileBlock entry={entry} defaultExpanded={def} />,
  write_file: (entry, def) => <FileBlock entry={entry} defaultExpanded={def} />,
  edit_file: (entry, def) => <FileBlock entry={entry} defaultExpanded={def} />,
  delete_file: (entry, def) => <FileBlock entry={entry} defaultExpanded={def} />,

  run_command: (entry, def) => <CommandBlock entry={entry} defaultExpanded={def} />,

  create_spec: (entry, def) => <SpecBlock entry={entry} defaultExpanded={def} />,
  update_spec: (entry, def) => <SpecBlock entry={entry} defaultExpanded={def} />,

  create_task: (entry, def) => <TaskBlock entry={entry} defaultExpanded={def} />,
  update_task: (entry, def) => <TaskBlock entry={entry} defaultExpanded={def} />,
  transition_task: (entry, def) => <TaskBlock entry={entry} defaultExpanded={def} />,
  delete_task: (entry, def) => <TaskBlock entry={entry} defaultExpanded={def} />,
  retry_task: (entry, def) => <TaskBlock entry={entry} defaultExpanded={def} />,
  run_task: (entry, def) => <TaskBlock entry={entry} defaultExpanded={def} />,

  list_files: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  find_files: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  search_code: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_specs: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_tasks: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_tasks_by_spec: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_projects: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_agents: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_agent_instances: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_orgs: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_members: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_feed: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_follows: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_sessions: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  list_log_entries: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,
  browse_files: (entry, def) => <ListBlock entry={entry} defaultExpanded={def} />,

  generate_image: (entry, def) => <ImageBlock entry={entry} defaultExpanded={def} />,
  generate_3d_model: (entry, def) => <Model3DBlock entry={entry} defaultExpanded={def} />,

  get_project: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_fleet_status: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_progress_report: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_credit_balance: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_loop_status: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_remote_agent_state: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_project_stats: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_usage_stats: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_billing_account: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_agent: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_org: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_spec: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_task_output: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_environment_info: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
  get_3d_status: (entry, def) => <StatusReadoutBlock entry={entry} defaultExpanded={def} />,
};

export function renderToolBlock(
  entry: ToolCallEntry,
  defaultExpanded?: boolean,
): ReactNode {
  const renderer = REGISTRY[entry.name];
  if (renderer) return renderer(entry, defaultExpanded);
  return <GenericToolBlock entry={entry} defaultExpanded={defaultExpanded} />;
}
