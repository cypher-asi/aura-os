import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { MessageSquare, AlertCircle } from "lucide-react";
import { useAgentChatStream } from "../../hooks/use-agent-chat-stream";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { ChatMessageList } from "../../components/ChatMessageList";
import { ChatInputBar } from "../../components/ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../../components/ChatInputBar";
import styles from "../../components/ChatView.module.css";
import { useAgentStore, useAgentHistory, useSelectedAgent, LAST_AGENT_ID_KEY } from "./stores";

function HistoryEmptyState({
  status,
  error,
  agentName,
}: {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  agentName: string | undefined;
}) {
  if (status === "error" && error) {
    return (
      <div className={styles.emptyState}>
        <AlertCircle size={40} />
        <Text variant="muted" size="sm">{error}</Text>
      </div>
    );
  }

  return (
    <div className={styles.emptyState}>
      <MessageSquare size={40} />
      <Text variant="muted" size="sm">
        {status === "loading"
          ? "Loading conversation..."
          : `Send a message to chat with ${agentName ?? "this agent"} across all linked projects`}
      </Text>
    </div>
  );
}

export function AgentChatView() {
  const { agentId } = useParams<{ agentId: string }>();
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
  const {
    messages: historyMessages,
    status: historyStatus,
    error: historyError,
  } = useAgentHistory(agentId);

  const {
    messages,
    isStreaming,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    timeline,
    progressText,
    sendMessage,
    stopStreaming,
    resetMessages,
  } = useAgentChatStream({ agentId });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const resetMessagesRef = useRef(resetMessages);
  useEffect(() => { resetMessagesRef.current = resetMessages; }, [resetMessages]);
  const { handleScroll } = useAutoScroll(messageAreaRef, agentId);

  useEffect(() => {
    if (!agentId) return;
    useAgentStore.getState().fetchHistory(agentId);
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
    requestAnimationFrame(() => inputBarRef.current?.focus());
  }, [agentId, setSelectedAgent]);

  useEffect(() => {
    if (historyMessages.length === 0) return;
    const el = messageAreaRef.current;
    if (el) el.style.visibility = "hidden";
    resetMessagesRef.current(historyMessages, { allowWhileStreaming: true });
    requestAnimationFrame(() => {
      if (el) {
        el.scrollTop = el.scrollHeight;
        el.style.visibility = "";
      }
    });
  }, [historyMessages]);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const handleSend = useCallback(
    (content: string, action?: string, atts?: AttachmentItem[]) => {
      setInput("");
      const toSend = atts ?? attachmentsRef.current;
      const apiAttachments = toSend.length > 0
        ? toSend.map((a) => ({
            type: a.attachmentType,
            media_type: a.mediaType,
            data: a.data,
            name: a.name,
          }))
        : undefined;
      sendMessage(content, action ?? null, null, apiAttachments);
      setAttachments([]);
    },
    [sendMessage],
  );

  if (!agentId) {
    return null;
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
              messages={messages}
              isStreaming={isStreaming}
              streamingText={streamingText}
              thinkingText={thinkingText}
              thinkingDurationMs={thinkingDurationMs}
              activeToolCalls={activeToolCalls}
              timeline={timeline}
              progressText={progressText}
              emptyState={
                <HistoryEmptyState
                  status={historyStatus}
                  error={historyError}
                  agentName={selectedAgent?.name}
                />
              }
            />
          </div>
        </div>

        <ChatInputBar
          ref={inputBarRef}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          agentName={selectedAgent?.name}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
        />
      </div>
    </div>
  );
}
