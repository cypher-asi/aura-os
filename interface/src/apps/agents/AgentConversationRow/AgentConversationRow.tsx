import { memo, useEffect } from "react";
import { Activity, CircleHelp, Pin, ShieldAlert } from "lucide-react";
import { formatChatTime } from "../../../shared/utils/format";
import { stripEmojis } from "../../../shared/utils/text-normalize";
import type { Agent } from "../../../shared/types";
import { isSuperAgent } from "../../../shared/types/permissions";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { LoopActivityPayload } from "../../../shared/types/aura-events";
import { Avatar } from "../../../components/Avatar";
import { LoopProgressView } from "../../../components/LoopProgress";
import { useAfterPaint } from "../../../shared/hooks/use-after-paint";
import { agentDisplayName } from "../../../lib/derive-project-agent-title";
import styles from "./AgentConversationRow.module.css";

// Agent ids whose avatar image has mounted at least once this session. Used to
// skip the after-paint defer on subsequent re-mounts (e.g. flipping back to the
// Agents pane) so warm switches don't re-flicker the avatars.
const seenAvatarAgentIds = new Set<string>();

function stripMarkdown(text: string): string {
  return text
    .replace(/[*_~`#>]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
}

interface AgentConversationRowProps {
  agent: Agent;
  lastMessage: DisplaySessionEvent | undefined;
  showMetadataOnly?: boolean;
  isSelected: boolean;
  /** Pre-resolved presentation state from the list-level batched model. */
  status?: string;
  isLocal?: boolean;
  busy?: boolean;
  loopActivity?: LoopActivityPayload | null;
  isPinned?: boolean;
  attention?: {
    kind: "approval" | "input";
    count: number;
    label: string;
    route?: string;
  };
  activeRun?: {
    route?: string;
  };
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
}

function AgentConversationRowBase({
  agent,
  lastMessage,
  showMetadataOnly = false,
  isSelected,
  status,
  isLocal = false,
  busy = false,
  loopActivity = null,
  isPinned = false,
  attention,
  activeRun,
  onClick,
  onContextMenu,
  onMouseEnter,
}: AgentConversationRowProps) {
  const displayName = agentDisplayName(agent.name);
  const agentRole = stripMarkdown(agent.role ?? "");
  const agentDescription = stripMarkdown(agent.personality ?? "");
  const messagePreview = lastMessage
    ? `${lastMessage.role === "user" ? "You: " : ""}${stripMarkdown(stripEmojis(lastMessage.content)).trim()}`
    : "";
  const fallback = agentRole || "Open this agent";
  const preview = attention
    ? `${attention.count > 1 ? `${attention.count} requests` : attention.kind === "input" ? "Answer needed" : "Approval needed"} · ${attention.label}`
    : activeRun
      ? "Agent is working · Tap to follow"
      : showMetadataOnly
        ? agentDescription || fallback
        : messagePreview || agentDescription || fallback;
  const isCeo = isSuperAgent(agent);

  // Defer the avatar image to the frame after the row paints so the heavy
  // decode never blocks the switch. Already-seen agents render it immediately.
  const avatarReady = useAfterPaint(seenAvatarAgentIds.has(agent.agent_id));
  useEffect(() => {
    if (avatarReady) seenAvatarAgentIds.add(agent.agent_id);
  }, [avatarReady, agent.agent_id]);
  const avatarUrl = avatarReady ? agent.icon ?? undefined : undefined;

  return (
    <button
      id={agent.agent_id}
      className={`${styles.row} ${isSelected ? styles.selected : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      data-agent-role="agent-row"
      data-agent-agent-id={agent.agent_id}
      data-agent-agent-name={displayName}
      data-agent-agent-role={agent.role}
      data-agent-selected={isSelected ? "true" : "false"}
      data-agent-attention={attention?.kind ?? "none"}
      data-agent-activity={activeRun ? "running" : "idle"}
    >
      <Avatar
        avatarUrl={avatarUrl}
        name={displayName}
        type="agent"
        size={36}
        status={status}
        isLocal={isLocal}
        busy={busy}
        className={styles.avatar}
      />

      <span className={styles.body}>
        <span className={styles.top}>
          <span className={styles.name}>
            {displayName}
            {isCeo && <span className={styles.ceoBadge}>CEO</span>}
            {!isCeo && agentRole && (
              <span className={styles.roleBadge}>{agentRole}</span>
            )}
            {isPinned && !isCeo && (
              <Pin size={11} className={styles.pinIcon} />
            )}
            {attention ? (
              <span className={styles.attentionBadge}>
                {attention.kind === "input" ? (
                  <CircleHelp size={11} aria-hidden="true" />
                ) : (
                  <ShieldAlert size={11} aria-hidden="true" />
                )}
                Needs you
              </span>
            ) : activeRun ? (
              <span className={styles.activityBadge}>
                <Activity size={11} aria-hidden="true" />
                Working
              </span>
            ) : null}
          </span>
          <span className={styles.time}>
            <LoopProgressView
              activity={loopActivity}
              size={12}
              className={styles.loopProgress}
            />
            {formatChatTime(agent.updated_at)}
          </span>
        </span>
        <span
          className={attention
            ? styles.attentionPreview
            : activeRun
              ? styles.activityPreview
              : styles.preview}
        >
          {preview}
        </span>
      </span>
    </button>
  );
}

/**
 * Pure, props-driven, memoized row. All live state (avatar status, busy,
 * loop activity, pin, preview) is resolved once at the list level by
 * `useAgentRowModels` and passed in, so re-mounting the row on a pane switch
 * carries no store subscriptions — only a cheap reconciliation.
 */
export const AgentConversationRow = memo(AgentConversationRowBase);
