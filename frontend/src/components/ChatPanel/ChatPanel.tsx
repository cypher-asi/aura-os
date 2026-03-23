import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { ChatMessageList } from "../ChatMessageList";
import { ChatInputBar } from "../ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
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
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const { handleScroll, scrollToBottom } = useAutoScroll(messageAreaRef, scrollResetKey);

  useEffect(() => {
    if (isMobileLayout) return;
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [isMobileLayout, scrollResetKey]);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const handleSend = useCallback(
    (content: string, action?: string, atts?: AttachmentItem[]) => {
      setInput("");
      const toSend = atts ?? attachmentsRef.current;
      const apiAttachments: ChatAttachment[] | undefined = toSend.length > 0
        ? toSend.map((a) => ({
            type: a.attachmentType,
            media_type: a.mediaType,
            data: a.data,
            name: a.name,
          }))
        : undefined;
      onSend(content, action ?? null, null, apiAttachments);
      setAttachments([]);
      scrollToBottom();
    },
    [onSend, scrollToBottom],
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
        >
          <div className={styles.messageContent}>
            <ChatMessageList
              streamKey={streamKey}
              scrollRef={messageAreaRef}
              emptyState={emptyState}
            />
          </div>
        </div>

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
