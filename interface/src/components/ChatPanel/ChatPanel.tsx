import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useScrollAnchor } from "../../hooks/use-scroll-anchor";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { useMessageQueueStore, useMessageQueue } from "../../stores/message-queue-store";
import type { QueuedMessage } from "../../stores/message-queue-store";
import type { ChatAttachment } from "../../api/streams";
import type { SlashCommand } from "../../constants/commands";
import type { Project } from "../../types";
import {
  availableModelsForAdapter,
  defaultModelForAdapter,
  loadPersistedModel,
  persistModel,
} from "../../constants/models";
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
  ) => void;
  onStop: () => void;
  agentName?: string;
  machineType?: "local" | "remote";
  adapterType?: string;
  defaultModel?: string | null;
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
  adapterType,
  defaultModel,
  templateAgentId,
  agentId,
  isLoading,
  historyResolved = true,
  errorMessage,
  emptyMessage,
  scrollResetKey,
  projects,
  selectedProjectId,
  onProjectChange,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const availableModels = availableModelsForAdapter(adapterType);
  const [selectedModel, setSelectedModel] = useState(() => loadPersistedModel(adapterType, defaultModel));
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const { handleScroll, scrollToBottom, scrollToBottomIfPinned, isReady } = useScrollAnchor(
    messageAreaRef,
    {
      resetKey: scrollResetKey,
      contentReady: historyResolved,
    },
  );

  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);

  useEffect(() => {
    if (isMobileLayout) return;
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [isMobileLayout, scrollResetKey]);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    persistModel(modelId, adapterType);
  }, [adapterType]);

  useEffect(() => {
    setSelectedModel((current) => {
      if (availableModels.some((model) => model.id === current)) {
        return current;
      }
      return defaultModelForAdapter(adapterType, defaultModel);
    });
  }, [adapterType, defaultModel, availableModels]);

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
    (content: string, action?: string, atts?: AttachmentItem[]) => {
      setInput("");
      const apiAttachments = buildApiAttachments(atts);
      const commandIds = commands.length > 0 ? commands.map((c) => c.id) : undefined;
      const runtimeModel = adapterType === "codex" ? null : selectedModel;
      setAttachments([]);
      setCommands([]);

      if (isStreaming) {
        useMessageQueueStore.getState().enqueue(streamKey, {
          content,
          action: action ?? null,
          attachments: apiAttachments,
          commands: commandIds,
        });
      } else {
        onSend(content, action ?? null, runtimeModel, apiAttachments, commandIds, selectedProjectId);
      }
      scrollToBottom();
    },
    [adapterType, buildApiAttachments, commands, isStreaming, onSend, scrollToBottom, selectedModel, selectedProjectId, streamKey],
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
        onSendRef.current(
          next.content,
          next.action,
          adapterType === "codex" ? null : selectedModelRef.current,
          next.attachments,
          next.commands,
          selectedProjectIdRef.current,
        );
        scrollToBottom();
      } else {
        requestAnimationFrame(() => scrollToBottomIfPinned());
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [adapterType, isStreaming, streamKey, scrollToBottom, scrollToBottomIfPinned]);

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
  } else if (isLoading) {
    emptyState = (
      <div className={styles.emptyState}>
        <MessageSquare size={40} />
        <Text variant="muted" size="sm">Loading conversation...</Text>
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
          availableModels={availableModels}
          adapterType={adapterType}
          defaultModel={defaultModel}
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
