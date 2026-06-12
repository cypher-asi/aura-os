import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../shared/types/stream";
import { FileBlock } from "./renderers/FileBlock";
import { CommandBlock } from "./renderers/CommandBlock";
import { SpecBlock } from "./renderers/SpecBlock";
import { TaskBlock } from "./renderers/TaskBlock";
import { ListBlock } from "./renderers/ListBlock";
import { ImageBlock } from "./renderers/ImageBlock";
import { Model3DBlock } from "./renderers/Model3DBlock";
import { VideoBlock } from "./renderers/VideoBlock";
import { StatusReadoutBlock } from "./renderers/StatusReadoutBlock";
import { GenericToolBlock } from "./renderers/GenericToolBlock";
import { SubAgentBlock } from "../SubAgentBlock";
import { CouncilPanel } from "../CouncilPanel";

/**
 * Phase 5 — extra hints the parent feed (`ActivityTimeline`) can hand
 * to a renderer when the same tool call ends up sharing a row with
 * siblings that need disambiguation or collapsing. Only `FileBlock`
 * consumes these today; other renderers ignore them.
 */
export interface BlockRenderOptions {
  /**
   * Minimum-unique right-anchored path tail for the file under render,
   * computed across every file block visible in the current feed. Lets
   * two `Cargo.toml` reads in different crates show as
   * `crates/A/Cargo.toml` / `crates/B/Cargo.toml` instead of two
   * identical `Cargo.toml` rows.
   */
  displayPath?: string;
  /**
   * Number of adjacent identical tool calls collapsed into this single
   * rendered row. `undefined` / 1 ⇒ a normal single-call row; `>= 2`
   * triggers the `×N` badge in the block header.
   */
  groupCount?: number;
}

/**
 * Renderer contract: every block renderer takes a ToolCallEntry plus an
 * optional defaultExpanded hint and returns a ReactNode built around the
 * shared `Block` primitive. Renderers that opt into feed-aware hints
 * (e.g. `FileBlock`) destructure them off the optional third argument.
 */
export type BlockRenderer = (
  entry: ToolCallEntry,
  defaultExpanded?: boolean,
  options?: BlockRenderOptions,
) => ReactNode;

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
  // `run_command` is intentionally absent: a finished command collapses
  // to its one-line outcome (pending commands still force-open with live
  // output via `forceExpanded` in CommandBlock). Detail is one click away.
]);

export function isAutoExpandedTool(name: string): boolean {
  return AUTO_EXPAND_TOOLS.has(name);
}

const REGISTRY: Record<string, BlockRenderer> = {
  read_file: (entry, def, opts) => (
    <FileBlock
      entry={entry}
      defaultExpanded={def}
      displayPath={opts?.displayPath}
      groupCount={opts?.groupCount}
    />
  ),
  write_file: (entry, def, opts) => (
    <FileBlock
      entry={entry}
      defaultExpanded={def}
      displayPath={opts?.displayPath}
      groupCount={opts?.groupCount}
    />
  ),
  edit_file: (entry, def, opts) => (
    <FileBlock
      entry={entry}
      defaultExpanded={def}
      displayPath={opts?.displayPath}
      groupCount={opts?.groupCount}
    />
  ),
  delete_file: (entry, def, opts) => (
    <FileBlock
      entry={entry}
      defaultExpanded={def}
      displayPath={opts?.displayPath}
      groupCount={opts?.groupCount}
    />
  ),

  run_command: (entry, def) => <CommandBlock entry={entry} defaultExpanded={def} />,

  create_spec: (entry, def) => <SpecBlock entry={entry} defaultExpanded={def} />,
  update_spec: (entry, def) => <SpecBlock entry={entry} defaultExpanded={def} />,

  // `task` spawns a live subagent thread — NOT project-task CRUD
  // (that's `create_task` etc. below, rendered by `TaskBlock`).
  task: (entry, def) => <SubAgentBlock entry={entry} defaultExpanded={def} />,

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
  generate_video: (entry, def) => <VideoBlock entry={entry} defaultExpanded={def} />,

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
  options?: BlockRenderOptions,
): ReactNode {
  // AURA Council grouping: all members of a council turn fold onto ONE
  // tool-call entry (they share its id as their synthetic
  // `parent_tool_use_id`), so a single entry carries every member. Render
  // the whole group as ONE `CouncilPanel` of N live columns instead of a
  // per-member `SubAgentBlock` — sibling to the `task` -> `SubAgentBlock`
  // mapping below, but matched on the folded-in members rather than the
  // tool name.
  if (entry.councilMembers && entry.councilMembers.length > 0) {
    return <CouncilPanel entry={entry} defaultExpanded={defaultExpanded} />;
  }
  const renderer = REGISTRY[entry.name];
  if (renderer) return renderer(entry, defaultExpanded, options);
  return <GenericToolBlock entry={entry} defaultExpanded={defaultExpanded} />;
}
