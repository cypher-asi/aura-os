import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { MessageSquare } from "lucide-react";
import { api } from "../api/client";
import { useChatStream } from "../hooks/use-chat-stream";
import { useAutoScroll } from "../hooks/use-auto-scroll";
import { setLastChat } from "../utils/storage";
import { MessageBubble, StreamingBubble } from "./MessageBubble";
import { ChatInputBar } from "./ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "./ChatInputBar";
import type { ChatMessage } from "../types";
import styles from "./ChatView.module.css";

export function ChatView() {
  const { projectId, chatSessionId } = useParams<{
    projectId: string;
    chatSessionId: string;
  }>();
  const navigate = useNavigate();

  const {
    messages,
    isStreaming,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  } = useChatStream({ projectId, chatSessionId });

  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("opus-4.6");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const autoCreateRef = useRef(false);
  const { handleScroll } = useAutoScroll(messageAreaRef, chatSessionId);

  useEffect(() => {
    if (projectId && chatSessionId) {
      setLastChat(projectId, chatSessionId);
      requestAnimationFrame(() => inputBarRef.current?.focus());
    }
  }, [projectId, chatSessionId]);

  useEffect(() => {
    if (!projectId || !chatSessionId) {
      resetMessages([]);
      return;
    }
    api
      .getChatMessages(projectId, chatSessionId)
      .then((msgs) => {
        resetMessages(
          msgs
            .filter((m: ChatMessage) => (m.content && m.content.trim().length > 0) || (m.content_blocks && m.content_blocks.length > 0))
            .map((m: ChatMessage) => {
              const blocks = (m.content_blocks ?? [])
                .filter((b) => b.type === "text" || b.type === "image")
                .map((b) =>
                  b.type === "text" ? { type: "text" as const, text: b.text ?? "" } : { type: "image" as const, media_type: b.media_type ?? "image/png", data: b.data ?? "" }
                );
              return {
                id: m.message_id,
                role: m.role,
                content: m.content,
                contentBlocks: blocks.length > 0 ? blocks : undefined,
              };
            }),
        );
      })
      .catch(console.error);
  }, [projectId, chatSessionId, resetMessages]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [rafRef]);

  const handleSend = useCallback(
    (content: string, action?: string, atts?: AttachmentItem[]) => {
      setInput("");
      const toSend = atts ?? attachments;
      const apiAttachments = toSend.length > 0
        ? toSend.map((a) => ({
            type: a.attachmentType,
            media_type: a.mediaType,
            data: a.data,
            name: a.name,
          }))
        : undefined;
      sendMessage(content, action ?? null, selectedModel, apiAttachments);
      setAttachments([]);
    },
    [sendMessage, selectedModel, attachments],
  );

  useEffect(() => {
    if (chatSessionId || !projectId || autoCreateRef.current) return;
    autoCreateRef.current = true;
    api
      .createChatSession(projectId, "New Chat")
      .then((session) => {
        navigate(`/projects/${projectId}/chat/${session.chat_session_id}`, { replace: true });
      })
      .catch((err) => {
        console.error("Failed to auto-create chat session", err);
        autoCreateRef.current = false;
      });
  }, [chatSessionId, projectId, navigate]);

  if (!chatSessionId) {
    return null;
  }

  const hasMessages = messages.length > 0 || streamingText || thinkingText;

  return (
    <div className={styles.container}>
      <div className={styles.chatArea}>
        <div
          className={styles.messageArea}
          ref={messageAreaRef}
          onScroll={handleScroll}
        >
          <div className={styles.messageContent}>
            {!hasMessages ? (
              <div className={styles.emptyState}>
                <MessageSquare size={40} className={styles.emptyIcon} />
                <Text variant="muted" size="sm">
                  Send a message or use a quick action to get started
                </Text>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {(streamingText || thinkingText || activeToolCalls.length > 0) && (
                  <StreamingBubble
                    text={streamingText}
                    toolCalls={activeToolCalls}
                    thinkingText={thinkingText}
                    thinkingDurationMs={thinkingDurationMs}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <ChatInputBar
          ref={inputBarRef}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />
      </div>
    </div>
  );
}
