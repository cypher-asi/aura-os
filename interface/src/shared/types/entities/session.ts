import type {
  AgentInstanceId,
  ProjectId,
  SessionId,
  SessionEventId,
  TaskId,
} from "../ids";
import type { SessionStatus } from "../enums";

export interface Session {
  session_id: SessionId;
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  active_task_id: TaskId | null;
  tasks_worked: TaskId[];
  context_usage_estimate: number;
  total_input_tokens: number;
  total_output_tokens: number;
  summary_of_previous_context: string;
  /** Persistent conversation pin. Absent on older server deployments. */
  pinned_at?: string | null;
  status: SessionStatus;
  user_id?: string;
  model?: string;
  started_at: string;
  ended_at: string | null;
}

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string; source_url?: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
      /**
       * Additive subagent linkage stamped onto a `task` tool_use block by
       * the server (`handle_subagent_spawned` / `handle_subagent_status`)
       * and round-tripped through the session-history GET. Lets a
       * history-reopened card re-attach to (and label) the spawned child
       * thread without a live `subagent_spawned` event. All optional —
       * absent on every non-`task` tool call and on pre-fix history.
       */
      child_run_id?: string;
      parent_tool_use_id?: string;
      subagent_type?: string;
      prompt?: string;
      subagent_status?: string;
      subagent_reason?: string;
      /**
       * Storage session id of the subagent's persisted transcript, folded
       * onto the block during server-side history reconstruction from the
       * `subagent_session` linkage event. Lets a history-reopened card
       * fetch and render the child transcript once its live run is gone.
       */
      subagent_session_id?: string;
      /**
       * AURA Council members folded onto the shared parent `tool_use`
       * block by the server (`handle_subagent_spawned`). All members of a
       * council turn share ONE `parent_tool_use_id`, so the server
       * accumulates the full ordered set here (keyed by `child_run_id`,
       * ordered by `council_index`) instead of overwriting a single
       * scalar. Round-trips through the `ChatContentBlock::ToolUse`
       * flattened `extra` map. On reload `extractToolCalls` folds this
       * into `ToolCallEntry.councilMembers[]` so the block registry
       * rebuilds the N-column `CouncilPanel`. Absent on every non-council
       * tool call.
       */
      /**
       * AURA Council combine mechanism (`synthesize` / `contrast` /
       * `side_by_side`) stamped once on the parent block by the server.
       * Shared by every member of the turn; absent on non-council tool
       * calls and on history persisted before the field existed.
       */
      council_mechanism?: string;
      council_members?: {
        child_run_id: string;
        model?: string;
        council_index: number;
        subagent_status?: string;
        subagent_reason?: string;
        /**
         * Storage session id of this member's persisted transcript,
         * folded on by the server's `subagent_session` link during
         * history reconstruction. Lets a reopened council column fetch
         * its saved transcript once the live child run is reaped.
         */
        subagent_session_id?: string;
      }[];
    }
  | { type: "tool_result"; tool_use_id: string; content: string;
      is_error?: boolean }
  | { type: "task_ref"; task_id: string; title: string }
  | { type: "spec_ref"; spec_id: string; title: string };

export interface SessionEvent {
  event_id: SessionEventId;
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  role: "user" | "assistant" | "system";
  content: string;
  content_blocks?: ChatContentBlock[];
  thinking?: string;
  thinking_duration_ms?: number;
  created_at: string;
  /**
   * `true` when this row is a server-reconstructed snapshot of an
   * assistant turn that has been started but not yet terminated by an
   * `assistant_message_end`. The chat panel uses this flag to keep
   * `streamingAgentInstanceId` set after a mid-turn page refresh, and
   * the sidekick uses it to rebuild `pending-*` spec/task placeholders
   * from the partial `content_blocks` it carries.
   */
  in_flight?: boolean;
  /**
   * Set on `user_message` rows that were *injected by another agent*
   * rather than typed by the human user. Two paths populate it
   * server-side:
   *   1. **A → B inbound** — when agent A invokes the harness
   *      `send_to_agent` tool against B, the harness's
   *      `cross_agent_hook::deliver_message` POSTs a `user_message`
   *      into B's session carrying `from_agent_id: A's UUID`.
   *   2. **B → A async reply** — when B's turn finishes, the
   *      server-side `spawn_cross_agent_reply_callback` POSTs B's
   *      reply back into A's session as another `user_message`,
   *      stamped with `from_agent_id: B's UUID`.
   *
   * `MessageBubble` reads this and labels the row "↩ from
   * <agent name>" instead of styling it indistinguishably from a
   * real user prompt — without it, Barret's reply showed up in
   * A's chat as a duplicate of A's own input. `undefined` on every
   * regular human-typed user message and on assistant rows.
   */
  from_agent_id?: string;
}
