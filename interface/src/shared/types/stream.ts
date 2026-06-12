import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { SubagentState } from "./harness-protocol";

/* ------------------------------------------------------------------ */
/*  Display types used across stream hooks and UI components           */
/* ------------------------------------------------------------------ */

export interface DisplayContentBlock {
  type: "text";
  text: string;
}

export interface DisplayImageBlock {
  type: "image";
  media_type: string;
  data: string;
  /** S3 URL. When set, use this instead of data:base64. */
  source_url?: string;
}

export interface DisplayVideoBlock {
  type: "video";
  url: string;
}

export interface DisplayModel3DBlock {
  type: "model3d";
  url: string;
}

export type DisplayContentBlockUnion = DisplayContentBlock | DisplayImageBlock | DisplayVideoBlock | DisplayModel3DBlock;

export interface ArtifactRef {
  kind: "task" | "spec";
  id: string;
  title: string;
}

export type TimelineItem =
  | {
      kind: "thinking";
      id: string;
      text?: string;
      /**
       * Wall-clock ms when the first delta of this thinking segment
       * arrived. Transient — only set while the stream is live so the
       * segment closer can compute its own `durationMs`. Persisted
       * history rows omit this.
       */
      startMs?: number;
      /**
       * Elapsed ms for this specific thinking segment. Stamped by
       * `closeCurrentThinkingSegment` (see
       * `interface/src/hooks/stream/handlers/shared.ts`) the moment a
       * tool, assistant text, or stream finalize closes the segment.
       * The `ActivityTimeline` renderer prefers this over the
       * turn-level `thinkingDurationMs` so multi-segment turns no
       * longer repeat the same "Thought for X" label on every block.
       */
      durationMs?: number;
    }
  | { kind: "text"; content: string; id: string }
  | { kind: "tool"; toolCallId: string; id: string };

export interface DisplaySessionEvent {
  id: string;
  /**
   * Stable React identity for the bubble across the entire lifecycle:
   *   - First assigned when the message is first created (optimistic
   *     user, stream placeholder, or hydrated history row).
   *   - Preserved across `id` mutations such as the
   *     `stream-...` -> persisted `event_id` swap that
   *     `handleEventSaved` performs at end-of-turn.
   *
   * `ChatMessageList` keys on `clientId ?? id` so React reconciliation
   * does NOT unmount/remount the bubble when the persisted id arrives.
   * Replaces the old `applyTailIdAliases` walk that compensated for
   * the same race after the fact.
   */
  clientId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  displayVariant?:
    | "insufficientCreditsError"
    | "agentBusyError"
    | "harnessCapacityExhaustedError"
    | "streamDropped";
  toolCalls?: ToolCallEntry[];
  artifactRefs?: ArtifactRef[];
  contentBlocks?: DisplayContentBlockUnion[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  /**
   * Mirrors `SessionEvent.in_flight`: `true` when the server is still
   * streaming this assistant turn. Drives mid-turn refresh recovery —
   * see `useChatHistorySync` (re-arms `streamingAgentInstanceId`) and
   * `useChatStream` (skips `clearGeneratedArtifacts` so sidekick
   * pending placeholders survive the reload).
   */
  inFlight?: boolean;
  /**
   * Phase 5: the server-stamped `support_id` parsed out of an
   * `ErrorMsg.message` suffix (`(support_id=<12hex>)`). Set only
   * on synthesized error events emitted by `handleStreamError`;
   * surfaced as a copyable chip in the error bubble + as the
   * top-line context line in the `ReportBugButton` pre-fill so
   * support can join the chat-side report back to the matching
   * server `tracing` span.
   */
  supportId?: string;
  /**
   * Server- or client-classified error string (already stripped
   * of the `(support_id=...)` suffix). Set only on synthesized
   * error events emitted by `handleStreamError`. Rendered inline
   * in the Support ID + Report Bug action row in `MessageBubble`,
   * truncated with the full text exposed via the `title`
   * tooltip. Kept separate from `content` so the partial
   * streaming buffer (any text the assistant produced before the
   * turn errored out) can render through `LLMOutput` while the
   * synthesized error string lives in the action row instead of
   * being concatenated into the bubble body.
   */
  errorMessage?: string;
  /**
   * Org-level `agents.agent_id` UUID of the agent that injected
   * this `user_message` on behalf of cross-agent communication
   * (rather than the human user typing into the box). `undefined`
   * on every regular human-typed turn and on assistant rows.
   *
   * Mirrors `SessionEvent.from_agent_id`; threaded through by
   * `buildDisplayEvents` so `MessageBubble` can render a small
   * "↩ from <agent name>" badge above user-role bubbles when
   * set. The agent name is resolved from `useAgentStore` with a
   * truncated-id fallback when the sender belongs to another org
   * the local store has never fetched.
   */
  fromAgentId?: string;
}

/**
 * One AURA Council member folded onto the shared council parent
 * tool-call entry. All members of a council turn arrive as
 * `subagent_spawned` events sharing ONE synthetic `parent_tool_use_id`
 * (the grouping key), so they accumulate into {@link
 * ToolCallEntry.councilMembers} on that single entry rather than each
 * minting a separate card. The `CouncilPanel` renders one live column
 * per member, ordered by `councilIndex`, labeled by `model`.
 */
export interface CouncilMemberEntry {
  /** Child run id this member streams over (its `useSubagentChatStream`). */
  childRunId: string;
  /** Model id driving the member, used as the column label. */
  model?: string;
  /** Zero-based council slot index; orders the columns (slot 0 synthesizes). */
  councilIndex: number;
  /** Latest lifecycle state folded in from `subagent_status`. */
  status?: SubagentState;
  /**
   * Storage session id of this member's persisted transcript, folded in
   * during history reconstruction (mirrors {@link
   * ToolCallEntry.subagentSessionId} for a `task` spawn). Lets a
   * reopened council member pane fetch its saved transcript when the
   * live child run is gone.
   */
  subagentSessionId?: string;
  /** Failure/rejection detail from the latest `subagent_status`. */
  reason?: string;
}

export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  pending: boolean;
  started?: boolean;
  /**
   * `true` while the harness is between streaming-retry attempts for
   * this tool call. Set to `true` on every `ToolCallRetrying` event
   * from aura-harness and cleared back to `false` by the next
   * successful `ToolCallSnapshot` / `ToolResult`, or latched off by a
   * terminal `ToolCallFailed`. Renderers (see
   * `components/Block/renderers/FileBlock.tsx`) switch the card
   * title to "… retrying (n/max)…" while this is set.
   */
  retrying?: boolean;
  /** 1-indexed attempt number carried on the latest ToolCallRetrying. */
  retryAttempt?: number;
  /** Total retry budget for this tool call (harness default: 8). */
  retryMax?: number;
  /** Classified reason the last retry was scheduled for (e.g.
   *  "upstream_529_overloaded", "stream_aborted_mid_tool_use"). */
  retryReason?: string;
  /**
   * Set to `true` when aura-harness emits `ToolCallFailed` for this
   * `tool_use_id`. Tool-level retries are entirely the harness's
   * responsibility now (the server no longer runs a parallel retry
   * ladder for tool calls), so a single emission marks the call as
   * terminally failed. Used by renderers to prefix the failure
   * title with "retried N/max — " so users understand the full
   * recovery history, not just the last stream abort.
   */
  retryExhausted?: boolean;
  /**
   * `true` when this entry was synthesised by the FE
   * (`emitSyntheticTransitionBlock` in `task-stream-bootstrap.ts`)
   * to render a decorative lifecycle card in the timeline rather
   * than reflecting a real harness tool invocation. Downstream
   * consumers (`getStreamingPhaseLabel`, `ActiveTaskStream`) filter
   * these out of phase-label / has-content gates so the pinned
   * cooking shimmer's fallback `Cooking…` label still shows up
   * before any real tool / text delta arrives, and the in-body
   * stream renderer stays unmounted until there's real content.
   */
  synthetic?: boolean;
  /**
   * For `task` tool calls only — the child run id of the subagent this
   * tool spawned, captured from the parent stream's `subagent_spawned`
   * event (`SubagentSpawned.child_run_id`). The `SubAgentBlock` uses it
   * to attach to the child's live thread
   * (`POST /api/streams/subagents/:subagentRunId/attach`). Absent until
   * the spawn event lands (and on history-reopened cards — see the
   * TODO in `SubAgentBlock`).
   */
  subagentRunId?: string;
  /**
   * Storage session id of the subagent thread, when known. Reserved for
   * the history-reopen path (listing + replaying a finished thread);
   * unset on the live spawn+watch path.
   */
  subagentSessionId?: string;
  /**
   * Latest lifecycle state for the spawned subagent, folded in from the
   * parent stream's `subagent_status` events. Drives the card's status
   * pill. Absent until the first status (or spawn) event lands.
   */
  subagentStatus?: SubagentState;
  /**
   * Subagent kind (`general_purpose` / `explore` / `shell` /
   * `code_reviewer` / …) carried on `subagent_spawned`. Used for the
   * card's type label; falls back to the `task` tool input when absent.
   */
  subagentType?: string;
  /** Spawn prompt carried on `subagent_spawned`, for the card summary. */
  subagentPrompt?: string;
  /**
   * Model id driving the spawned subagent, carried on `subagent_spawned`
   * (`SubagentSpawned.model`). Set for AURA Council members so a member
   * rendered as a card can label its model; absent for ordinary `task`
   * spawns, whose runtime emits a `null` model today.
   */
  subagentModel?: string;
  /**
   * Failure/rejection detail from the latest `subagent_status` (e.g. a
   * depth/quota rejection reason). Rendered in the card's rejected /
   * failed state.
   */
  subagentReason?: string;
  /**
   * AURA Council members folded onto this entry when the spawned
   * subagents carry a `council_index` (all members of a turn share this
   * entry's `id` as their synthetic `parent_tool_use_id`). Present ⇒ the
   * block registry renders a {@link CouncilMemberEntry}-driven
   * `CouncilPanel` (N live columns) instead of a single `SubAgentBlock`.
   */
  councilMembers?: CouncilMemberEntry[];
  /**
   * AURA Council combine mechanism (`synthesize` / `contrast` /
   * `side_by_side`) shared by every member of the turn. Surfaced on the
   * shared council parent entry so the `CouncilPanel` can label which
   * mechanism produced the answer below it. Absent for non-council tool
   * calls and for older turns persisted before the field existed.
   */
  councilMechanism?: string;
}

/* ------------------------------------------------------------------ */
/*  Ref / setter interfaces for stream state                           */
/* ------------------------------------------------------------------ */

export interface StreamRefs {
  streamBuffer: MutableRefObject<string>;
  thinkingBuffer: MutableRefObject<string>;
  thinkingStart: MutableRefObject<number | null>;
  toolCalls: MutableRefObject<ToolCallEntry[]>;
  raf: MutableRefObject<number | null>;
  flushTimeout: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  displayedTextLength: MutableRefObject<number>;
  lastTextFlushAt: MutableRefObject<number>;
  thinkingRaf: MutableRefObject<number | null>;
  timeline: MutableRefObject<TimelineItem[]>;
  snapshottedToolCallIds: MutableRefObject<Set<string>>;
}

/**
 * Kind of generation an entry is currently driving. Used to gate the
 * cooking-indicator ETA countdown so the timer only renders for the
 * generation modes we have estimates for. `null` when no generation
 * is in flight on this entry.
 */
export type GenerationKind = "image" | "video" | "3d";

/**
 * Fields a single streaming display tick may publish together. Applied
 * through {@link StreamSetters.applyStreamingPatch} as ONE store update
 * so a reveal frame costs one subscriber notification instead of the
 * 3-5 separate `setState` calls the individual setters would incur.
 */
export interface StreamingDisplayPatch {
  streamingText?: string;
  thinkingText?: string;
  timeline?: TimelineItem[];
  isWriting?: boolean;
}

export interface StreamSetters {
  /**
   * Batched display-tick setter: applies every field of the patch (plus
   * the wire-progress bookkeeping that `markStreamProgress` would do) in
   * a single store update. The per-frame reveal loop and the thinking
   * coalescer go through this; the individual setters below remain for
   * low-frequency lifecycle paths.
   */
  applyStreamingPatch: Dispatch<StreamingDisplayPatch>;
  setStreamingText: Dispatch<SetStateAction<string>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setThinkingDurationMs: Dispatch<SetStateAction<number | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setEvents: Dispatch<SetStateAction<DisplaySessionEvent[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setIsWriting: Dispatch<SetStateAction<boolean>>;
  setProgressText: Dispatch<SetStateAction<string>>;
  setTimeline: Dispatch<SetStateAction<TimelineItem[]>>;
  /**
   * Stamp the generation lifecycle for the entry. Called from
   * `useAgentChatStream` when an image / 3D / video stream opens so
   * the cooking-indicator ETA hook can read the start wall-clock and
   * model id to drive a per-model fallback estimate. `model` may be
   * null when the caller doesn't know the model id (e.g. the chat
   * 3D pipeline's source-image step uses the default image model
   * implicitly).
   */
  setGenerationState: Dispatch<{
    startedAt: number;
    model: string | null;
    kind: GenerationKind;
  }>;
  /**
   * Update the latest server-reported `percent` for the active
   * generation. The ETA hook switches from the per-model fallback
   * to `elapsed * (100 - percent) / percent` once the first
   * meaningful value lands.
   */
  setGenerationPercent: Dispatch<number | null>;
  /**
   * Clear the generation lifecycle for the entry. Called on
   * `generation_completed` / `generation_error` and from
   * `finalizeStream` / `handleStreamError` so the countdown disappears
   * the moment the stream terminates.
   */
  clearGeneration: Dispatch<void>;
}
