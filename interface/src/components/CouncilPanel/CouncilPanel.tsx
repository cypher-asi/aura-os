import { type MouseEvent } from "react";
import { Users } from "lucide-react";
import { Badge } from "@cypher-asi/zui";
import type {
  CouncilMemberEntry,
  DisplaySessionEvent,
  ToolCallEntry,
} from "../../shared/types/stream";
import type { SubagentState } from "../../shared/types/harness-protocol";
import {
  modelLabel,
  subagentBadgeVariant,
  subagentStateLabel,
} from "../../shared/utils/subagent";
import { SegmentedContent } from "../SegmentedContent";
import { useChatPanelStreamKey } from "../../features/chat-ui/ChatPanel/chat-panel-context";
import {
  useSubAgentPaneActions,
  type SubAgentPaneDescriptor,
} from "../../stores/subagent-pane-store";
import { useSubagentChatStream } from "../../hooks/use-subagent-chat-stream";
import {
  useIsStreaming,
  useStreamEvents,
  useStreamingText,
} from "../../hooks/stream/hooks";
import styles from "./CouncilPanel.module.css";

type OpenPane = ReturnType<typeof useSubAgentPaneActions>["openPane"];

interface CouncilPanelProps {
  /**
   * The shared council parent tool-call entry. `entry.id` is the council
   * grouping key (the synthetic `parent_tool_use_id` every member shares)
   * and `entry.councilMembers` carries the per-member columns. Rendered
   * once for the whole group by the block registry.
   */
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

function ordinalLabel(index: number): string {
  return ORDINALS[index] ?? `${index + 1}th`;
}

/**
 * Human label for the council combine mechanism shown in the panel
 * badge. Defaults to "Synthesize" when absent (the wire default and the
 * shape of turns persisted before the mechanism was recorded).
 */
function mechanismLabel(mechanism: string | undefined): string {
  switch (mechanism) {
    case "contrast":
      return "Contrast";
    case "side_by_side":
      return "Side-by-side";
    default:
      return "Synthesize";
  }
}

function isSecondOpinionEntry(entry: ToolCallEntry): boolean {
  return entry.subagentType === "second-opinion";
}

/** Short subtitle clause describing what slot 0 does for the mechanism. */
function mechanismSubtitle(mechanism: string | undefined): string {
  switch (mechanism) {
    case "contrast":
      return "slot 0 contrasts";
    case "side_by_side":
      return "slot 0 lays them side-by-side";
    default:
      return "slot 0 synthesizes";
  }
}

/**
 * Recover the parent agent id from a chat stream key. The chat stream
 * key is `keyForAgentSession(agentId, sessionId)` == `${agentId}:${sessionId}`
 * (segments joined by ":"), so the agent id is everything before the LAST
 * ":". Threaded into each member's attach as `?agent_id=` so a remote
 * (swarm) parent's council members stream over the matching harness
 * transport. Returns undefined with no key (server then defaults to
 * local — the prior behavior for bare local parents).
 */
function agentIdFromStreamKey(streamKey: string | undefined): string | undefined {
  if (!streamKey) return undefined;
  const sep = streamKey.lastIndexOf(":");
  return sep > 0 ? streamKey.slice(0, sep) : streamKey;
}

/** Latest non-empty assistant turn text already committed to the partition. */
function latestAssistantText(events: DisplaySessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.role === "assistant" && event.content.trim().length > 0) {
      return event.content;
    }
  }
  return "";
}

interface CouncilColumnProps {
  member: CouncilMemberEntry;
  parentToolUseId: string;
  parentStreamKey: string | undefined;
  parentAgentId: string | undefined;
  prompt: string;
  openPane: OpenPane;
  variant: "council" | "second_opinion";
}

/**
 * One live AURA Council member column. Drives the member's child run into
 * its own `subagent:{childRunId}` partition via `useSubagentChatStream`
 * (one per column, concurrently) and renders the streaming answer with a
 * status pill. The header opens the existing single slide-over for a full
 * promptable chat-within-a-chat with this member.
 */
function CouncilColumn({
  member,
  parentToolUseId,
  parentStreamKey,
  parentAgentId,
  prompt,
  openPane,
  variant,
}: CouncilColumnProps) {
  const thread = useSubagentChatStream(
    member.childRunId,
    parentToolUseId,
    true,
    undefined,
    parentAgentId,
  );
  const events = useStreamEvents(thread.streamKey);
  const streamingText = useStreamingText(thread.streamKey);
  const isStreaming = useIsStreaming(thread.streamKey);

  const state: SubagentState = member.status ?? "running";
  const isSynthesizer = member.councilIndex === 0;
  const isSecondOpinion = variant === "second_opinion";
  const label = modelLabel(member.model) ?? "Member";
  const canOpen = !!parentStreamKey;
  const slotLabel = isSecondOpinion
    ? isSynthesizer
      ? "Final"
      : "Reference"
    : `${ordinalLabel(member.councilIndex)}${isSynthesizer ? " · synthesizes" : ""}`;

  const liveText =
    streamingText.trim().length > 0
      ? streamingText
      : latestAssistantText(events);

  const placeholderText = member.reason ?? (isStreaming ? "Thinking…" : null);

  const open = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (!parentStreamKey) return;
    const descriptor: SubAgentPaneDescriptor = {
      childRunId: member.childRunId,
      parentToolUseId,
      subagentType: label,
      prompt,
      state,
      reason: member.reason,
      subagentSessionId: member.subagentSessionId,
    };
    openPane(parentStreamKey, descriptor);
  };

  return (
    <div className={styles.column} data-council-index={member.councilIndex}>
      <button
        type="button"
        className={styles.columnHead}
        onClick={open}
        disabled={!canOpen}
        aria-label={
          canOpen
            ? `Open ${label} council member thread`
            : `${label} council member thread not available yet`
        }
        title={canOpen ? "Open this member's thread" : undefined}
      >
        <span className={styles.slot}>
          {slotLabel}
        </span>
        <span className={styles.model}>{label}</span>
        <Badge
          variant={subagentBadgeVariant(state)}
          pulse={state === "running"}
        >
          {subagentStateLabel(state)}
        </Badge>
      </button>
      <div className={styles.body}>
        {liveText.length > 0 ? (
          <SegmentedContent content={liveText} isStreaming={isStreaming} />
        ) : placeholderText ? (
          <span className={styles.placeholder}>{placeholderText}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders an AURA Council turn: N live member columns (ordered by
 * `councilIndex`, labeled by `model`) streaming concurrently, each with a
 * status pill and a click-to-open drill-in. The synthesized combined
 * answer is the normal parent assistant message, which renders below this
 * panel. Slot 0 is the synthesizer.
 */
export function CouncilPanel({ entry }: CouncilPanelProps) {
  const members = entry.councilMembers ?? [];
  const parentStreamKey = useChatPanelStreamKey();
  const { openPane } = useSubAgentPaneActions();
  const parentAgentId = agentIdFromStreamKey(parentStreamKey);
  const prompt = entry.subagentPrompt ?? "";

  const ordered = [...members].sort((a, b) => a.councilIndex - b.councilIndex);

  if (ordered.length === 0) return null;

  const mechanism = entry.councilMechanism;
  const secondOpinion = isSecondOpinionEntry(entry);
  const nonFinalCount = ordered.filter((member) => member.councilIndex !== 0).length;
  const referenceCount = secondOpinion
    ? nonFinalCount || ordered.length
    : Math.max(ordered.length - 1, 1);

  return (
    <div
      className={styles.panel}
      data-council-panel="true"
      data-council-mechanism={mechanism ?? "synthesize"}
      data-second-opinion-panel={secondOpinion ? "true" : undefined}
    >
      <div className={styles.header}>
        <Users size={12} className={styles.headerIcon} />
        <span className={styles.title}>
          {secondOpinion ? "Second Opinion" : "AURA Council"}
        </span>
        <span className={styles.mechanism}>
          {secondOpinion ? "References -> final" : mechanismLabel(mechanism)}
        </span>
        <span className={styles.subtitle}>
          {secondOpinion
            ? `${referenceCount} ${referenceCount === 1 ? "reference" : "references"} · final answer below`
            : `${ordered.length} members · ${mechanismSubtitle(mechanism)}`}
        </span>
      </div>
      <div className={styles.columns}>
        {ordered.map((member) => (
          <CouncilColumn
            key={member.childRunId}
            member={member}
            parentToolUseId={entry.id}
            parentStreamKey={parentStreamKey}
            parentAgentId={parentAgentId}
            prompt={prompt}
            openPane={openPane}
            variant={secondOpinion ? "second_opinion" : "council"}
          />
        ))}
      </div>
    </div>
  );
}
