import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { useChatPanelState } from "./useChatPanelState";
import type { ChatAttachment } from "../../api/streams";
import type { Project } from "../../types";
import type { GenerationMode } from "../../constants/models";
import styles from "./ChatPanel.module.css";

export interface ChatPanelProps {
  streamKey: string;
  onSend: (
    content: string,
    action: string | null,
    selectedModel: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectId?: string,
    generationMode?: GenerationMode,
  ) => void;
  onStop: () => void;
  agentName?: string;
  machineType?: "local" | "remote";
  adapterType?: string;
  defaultModel?: string | null;
  templateAgentId?: string;
  agentId?: string;
  isLoading?: boolean;
  historyResolved?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  scrollResetKey?: unknown;
  projects?: Project[];
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
}

export function ChatPanel({
  streamKey,
  onSend,
  onStop,
  agentName,
  machineType,
  adapterType,
  defaultModel,
  templateAgentId,
  agentId,
  isLoading: _isLoading,
  historyResolved = true,
  errorMessage,
  emptyMessage,
  scrollResetKey,
  projects,
  selectedProjectId,
  onProjectChange,
}: ChatPanelProps) {
  const s = useChatPanelState({
    streamKey,
    onSend,
    adapterType,
    defaultModel,
    historyResolved,
    scrollResetKey,
    selectedProjectId,
  });

  const emptyState = errorMessage ? (
    <div className={styles.emptyState}>
      <AlertCircle size={40} />
      <Text variant="muted" size="sm">{errorMessage}</Text>
    </div>
  ) : historyResolved ? (
    <div className={styles.emptyState}>
      <MessageSquare size={40} />
      <Text variant="muted" size="sm">
        {emptyMessage ?? `Start chatting with ${agentName ?? "this agent"}.`}
      </Text>
    </div>
  ) : null;

  return (
    <div className={styles.container}>
      {s.isMobileLayout && agentName ? (
        <div className={styles.projectAgentBar}>
          <div className={styles.projectAgentSummary}>
            <div className={styles.projectAgentSummaryCopy}>
              <span className={styles.projectAgentName}>{agentName}</span>
              <span className={styles.projectAgentSummaryHint}>
                {machineType === "remote" ? "Remote agent chat" : "Local agent chat"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
      <div className={styles.chatArea}>
        <div
          className={`${styles.messageArea}${s.isReady ? "" : ` ${styles.messageAreaHidden}`}`}
          ref={s.messageAreaRef}
          onScroll={s.handleScroll}
        >
          <div className={styles.messageContent}>
            <ChatMessageList
              streamKey={streamKey}
              scrollRef={s.messageAreaRef}
              emptyState={emptyState}
            />
            <div ref={s.scrollSentinelRef} className={styles.scrollSentinel} />
            <div ref={s.spacerRef} style={{ flexShrink: 0 }} />
          </div>
        </div>

        {s.queue.length > 0 && (
          <div className={styles.queueSection}>
            <MessageQueue
              streamKey={streamKey}
              onEdit={s.handleQueueEdit}
              onMoveUp={s.handleQueueMoveUp}
              onRemove={s.handleQueueRemove}
            />
          </div>
        )}

        <ChatInputBar
          ref={s.inputBarRef}
          input={s.input}
          onInputChange={s.setInput}
          onSend={s.handleSend}
          onStop={onStop}
          streamKey={streamKey}
          adapterType={adapterType}
          defaultModel={defaultModel}
          agentName={agentName}
          machineType={machineType}
          templateAgentId={templateAgentId}
          agentId={agentId}
          attachments={s.attachments}
          onAttachmentsChange={s.setAttachments}
          onRemoveAttachment={s.handleRemoveAttachment}
          selectedCommands={s.commands}
          onCommandsChange={s.setCommands}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
        />
      </div>
    </div>
  );
}
