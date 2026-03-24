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
import { loadPersistedModel, persistModel } from "../../constants/models";
import styles from "../ChatView/ChatView.module.css";

export interface ChatPanelProps {
  streamKey: string;
  onSend: (
    content: string,
    action: string | null,
    selectedModel: string | null,
    attachments?: ChatAttachment[],
  ) => void;
  onStop: () => void;
  agentName?: string;
  isLoading?: boolean;
  historyResolved?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  contextUsagePercent?: number | null;
  scrollResetKey?: unknown;
}

export function ChatPanel({
  streamKey,
  onSend,
  onStop,
  agentName,
  isLoading,
  historyResolved = true,
  errorMessage,
  emptyMessage,
  contextUsagePercent,
  scrollResetKey,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(loadPersistedModel);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const { handleScroll, scrollToBottom, isReady } = useScrollAnchor(messageAreaRef, {
    resetKey: scrollResetKey,
    contentReady: historyResolved,
  });

  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);

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
    (content: string, action?: string, atts?: AttachmentItem[]) => {
      setInput("");
      const apiAttachments = buildApiAttachments(atts);
      setAttachments([]);

      if (isStreaming) {
        useMessageQueueStore.getState().enqueue(streamKey, {
          content,
          action: action ?? null,
          attachments: apiAttachments,
        });
      } else {
        onSend(content, action ?? null, selectedModel, apiAttachments);
      }
      scrollToBottom();
    },
    [buildApiAttachments, isStreaming, onSend, scrollToBottom, selectedModel, streamKey],
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

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const next = useMessageQueueStore.getState().dequeue(streamKey);
      if (next) {
        onSendRef.current(next.content, next.action, selectedModelRef.current, next.attachments);
        scrollToBottom();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, scrollToBottom, streamKey]);

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
      <div className={styles.chatArea}>
        <div
          className={styles.messageArea}
          ref={messageAreaRef}
          onScroll={handleScroll}
          style={isReady ? undefined : { opacity: 0 }}
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
          onModelChange={handleModelChange}
          agentName={agentName}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          contextUsagePercent={contextUsagePercent}
        />
      </div>
    </div>
  );
}
