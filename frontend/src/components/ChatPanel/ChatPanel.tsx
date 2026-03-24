import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { useIsStreaming, useStreamMessages } from "../../hooks/stream/hooks";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { MessageQueue } from "../MessageQueue";
import { useMessageQueueStore, useMessageQueue } from "../../stores/message-queue-store";
import type { QueuedMessage } from "../../stores/message-queue-store";
import type { ChatAttachment } from "../../api/streams";
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
  /** When false, suppresses the empty-state text so it doesn't flash before history arrives. */
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
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  // Prevent scroll-jank: keep the message area at opacity 0 until
  // useAutoScroll has scrolled to the bottom AND the virtualizer's
  // measure → render cascade has settled (scrollHeight stable).
  const messages = useStreamMessages(streamKey);
  const hasMessages = messages.length > 0;
  const hasMessagesRef = useRef(hasMessages);
  hasMessagesRef.current = hasMessages;

  const [contentVisible, setContentVisible] = useState(false);
  const contentVisibleRef = useRef(false);
  useEffect(() => { contentVisibleRef.current = contentVisible; }, [contentVisible]);

  const revealRafRef = useRef(0);
  const lastRevealHeightRef = useRef(0);
  const stableFramesRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(revealRafRef.current), []);

  const STABLE_FRAMES_REQUIRED = 2;

  const onScrollApplied = useCallback(() => {
    if (!hasMessagesRef.current || contentVisibleRef.current) return;

    // A new scroll correction just landed — reset the stability counter
    // and (re)start the polling loop.
    stableFramesRef.current = 0;
    cancelAnimationFrame(revealRafRef.current);

    const el = messageAreaRef.current;
    if (!el) return;
    lastRevealHeightRef.current = el.scrollHeight;

    // Poll until scrollHeight is unchanged for STABLE_FRAMES_REQUIRED
    // consecutive frames. This adapts to the virtualizer's deferred
    // measurement pipeline (mount items → measureElement → batch state
    // update → re-render) which can take 2-3+ frames for very tall items.
    const poll = () => {
      if (contentVisibleRef.current) return;
      const h = messageAreaRef.current?.scrollHeight ?? 0;
      if (h === lastRevealHeightRef.current) {
        stableFramesRef.current++;
      } else {
        stableFramesRef.current = 0;
        lastRevealHeightRef.current = h;
      }
      if (stableFramesRef.current >= STABLE_FRAMES_REQUIRED) {
        setContentVisible(true);
      } else {
        revealRafRef.current = requestAnimationFrame(poll);
      }
    };
    revealRafRef.current = requestAnimationFrame(poll);
  }, []);

  const { handleScroll, scrollToBottom } = useAutoScroll(
    messageAreaRef, scrollResetKey, onScrollApplied,
  );

  // Fallback: reveal for empty conversations once history resolves.
  useEffect(() => {
    if (contentVisible || hasMessages || !historyResolved) return;
    const raf = requestAnimationFrame(() => setContentVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [historyResolved, hasMessages, contentVisible]);

  const messageAreaVisible = !historyResolved || contentVisible;

  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);

  useEffect(() => {
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [scrollResetKey]);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const buildApiAttachments = useCallback(
    (atts?: AttachmentItem[]): ChatAttachment[] | undefined => {
      const toSend = atts ?? attachmentsRef.current;
      return toSend.length > 0
        ? toSend.map((a) => ({
            type: a.attachmentType,
            media_type: a.mediaType,
            data: a.data,
            name: a.name,
          }))
        : undefined;
    },
    [],
  );

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
        onSend(content, action ?? null, null, apiAttachments);
      }
      scrollToBottom();
    },
    [onSend, scrollToBottom, isStreaming, streamKey, buildApiAttachments],
  );

  // Auto-send next queued message when streaming stops
  const prevStreamingRef = useRef(false);
  const onSendRef = useRef(onSend);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const next = useMessageQueueStore.getState().dequeue(streamKey);
      if (next) {
        onSendRef.current(next.content, next.action, null, next.attachments);
        scrollToBottom();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, streamKey, scrollToBottom]);

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
          style={messageAreaVisible ? undefined : { opacity: 0 }}
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
