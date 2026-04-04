import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useScrollAnchor } from "../../hooks/use-scroll-anchor";
import { useIsStreaming, useStreamEvents } from "../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { useMessageQueueStore, useMessageQueue } from "../../stores/message-queue-store";
import type { QueuedMessage } from "../../stores/message-queue-store";
import type { ChatAttachment } from "../../api/streams";
import type { SlashCommand } from "../../constants/commands";
import { isGenerationCommand } from "../../constants/commands";
import type { Project } from "../../types";
import type { GenerationMode } from "../../constants/models";
import { loadPersistedModel, persistModel } from "../../constants/models";
import styles from "../ChatView/ChatView.module.css";

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
  /** Agent template ID used by AgentEnvironment for remote VM state polling. */
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
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(loadPersistedModel);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const { handleScroll, scrollToBottom: _scrollToBottom, scrollToBottomIfPinned, scrollToTop, holdPosition, isReady } = useScrollAnchor(
    messageAreaRef,
    scrollSentinelRef,
    {
      resetKey: scrollResetKey,
      contentReady: historyResolved,
    },
  );

  const scrollToBottom = useCallback(() => {
    if (spacerRef.current) spacerRef.current.style.minHeight = "0";
    _scrollToBottom();
  }, [_scrollToBottom]);

  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);
  const messages = useStreamEvents(streamKey);
  const prevMessageCountRef = useRef(messages.length);
  const pendingScrollToTopRef = useRef(false);

  useEffect(() => {
    if (
      messages.length > prevMessageCountRef.current &&
      pendingScrollToTopRef.current
    ) {
      pendingScrollToTopRef.current = false;
      const lastIndex = messages.length - 1;
      const el = messageAreaRef.current?.querySelector<HTMLElement>(
        `[data-index="${lastIndex}"]`,
      );
      if (el) {
        const container = messageAreaRef.current;
        if (container && spacerRef.current) {
          spacerRef.current.style.minHeight = `${container.clientHeight}px`;
        }
        scrollToTop(el);
        holdPosition();
      } else {
        scrollToBottom();
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, scrollToTop, scrollToBottom, holdPosition]);

  useEffect(() => {
    if (isMobileLayout) return;
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [isMobileLayout, scrollResetKey]);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    persistModel(modelId);
  }, []);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const buildApiAttachments = useCallback((atts?: AttachmentItem[]): ChatAttachment[] | undefined => {
    const toSend = atts ?? attachmentsRef.current;
    return toSend.length > 0
      ? toSend.map((a) => ({
          type: a.attachmentType,
          media_type: a.mediaType,
          data: a.data,
          name: a.name,
        }))
      : undefined;
  }, []);

  const handleSend = useCallback(
    (content: string, action?: string, atts?: AttachmentItem[], genMode?: GenerationMode) => {
      setInput("");
      const apiAttachments = buildApiAttachments(atts);
      const commandIds = commands.length > 0 ? commands.map((c) => c.id).filter((id) => !isGenerationCommand(id)) : undefined;
      const effectiveGenMode = genMode ?? (commands.some((c) => c.id === "generate_image") ? "image" as GenerationMode : commands.some((c) => c.id === "generate_3d") ? "3d" as GenerationMode : undefined);
      setAttachments([]);
      setCommands([]);

      if (isStreaming) {
        useMessageQueueStore.getState().enqueue(streamKey, {
          content,
          action: action ?? null,
          attachments: apiAttachments,
          commands: commandIds,
        });
        scrollToBottom();
      } else {
        pendingScrollToTopRef.current = true;
        onSend(content, action ?? null, selectedModel, apiAttachments, commandIds, selectedProjectId, effectiveGenMode);
      }
    },
    [buildApiAttachments, commands, isStreaming, onSend, scrollToBottom, selectedModel, selectedProjectId, streamKey],
  );

  const prevStreamingRef = useRef(false);
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  const selectedModelRef = useRef(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const next = useMessageQueueStore.getState().dequeue(streamKey);
      if (next) {
        onSendRef.current(next.content, next.action, selectedModelRef.current, next.attachments, next.commands, selectedProjectIdRef.current);
        scrollToBottom();
      } else {
        requestAnimationFrame(() => scrollToBottomIfPinned());
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, streamKey, scrollToBottom, scrollToBottomIfPinned]);

  const handleQueueEdit = useCallback(
    (item: QueuedMessage) => {
      useMessageQueueStore.getState().remove(streamKey, item.id);
      setInput(item.content);
      requestAnimationFrame(() => inputBarRef.current?.focus());
    },
    [streamKey],
  );

  const handleQueueMoveUp = useCallback(
    (id: string) => useMessageQueueStore.getState().moveUp(streamKey, id),
    [streamKey],
  );

  const handleQueueRemove = useCallback(
    (id: string) => useMessageQueueStore.getState().remove(streamKey, id),
    [streamKey],
  );

  let emptyState: React.ReactNode = null;
  if (errorMessage) {
    emptyState = (
      <div className={styles.emptyState}>
        <AlertCircle size={40} />
        <Text variant="muted" size="sm">{errorMessage}</Text>
      </div>
    );
  } else if (historyResolved) {
    emptyState = (
      <div className={styles.emptyState}>
        <MessageSquare size={40} />
        <Text variant="muted" size="sm">
          {emptyMessage ?? `Start chatting with ${agentName ?? "this agent"}.`}
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {isMobileLayout && agentName ? (
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
          className={`${styles.messageArea}${isReady ? "" : ` ${styles.messageAreaHidden}`}`}
          ref={messageAreaRef}
          onScroll={handleScroll}
        >
          <div className={styles.messageContent}>
            <ChatMessageList
              streamKey={streamKey}
              scrollRef={messageAreaRef}
              emptyState={emptyState}
            />
            <div ref={scrollSentinelRef} className={styles.scrollSentinel} />
            <div ref={spacerRef} style={{ flexShrink: 0 }} />
          </div>
        </div>

        {queue.length > 0 && (
          <div className={styles.queueSection}>
            <MessageQueue
              streamKey={streamKey}
              onEdit={handleQueueEdit}
              onMoveUp={handleQueueMoveUp}
              onRemove={handleQueueRemove}
            />
          </div>
        )}

        <ChatInputBar
          ref={inputBarRef}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={onStop}
          streamKey={streamKey}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          agentName={agentName}
          machineType={machineType}
          templateAgentId={templateAgentId}
          agentId={agentId}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          selectedCommands={commands}
          onCommandsChange={setCommands}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
        />
      </div>
    </div>
  );
}
