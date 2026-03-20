import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { MessageSquare } from "lucide-react";
import { api } from "../../api/client";
import { useAgentChatStream } from "../../hooks/use-agent-chat-stream";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { useAgentApp } from "./AgentAppProvider";
import { MessageBubble, StreamingBubble } from "../../components/MessageBubble";
import { CookingIndicator } from "../../components/CookingIndicator";
import { ChatInputBar } from "../../components/ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../../components/ChatInputBar";
import type { Message } from "../../types";
import { extractArtifactRefs, extractToolCalls } from "../../utils/chat-history";
import styles from "../../components/ChatView.module.css";

export function AgentChatView() {
  const { agentId } = useParams<{ agentId: string }>();
  const { agents, selectedAgent, selectAgent } = useAgentApp();

  const {
    messages,
    isStreaming,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    progressText,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  } = useAgentChatStream({ agentId });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const { handleScroll } = useAutoScroll(messageAreaRef, agentId);

  useEffect(() => {
    if (agentId) {
      localStorage.setItem("aura:lastAgentId", agentId);
      requestAnimationFrame(() => inputBarRef.current?.focus());
      const cachedAgent = agents.find((agent) => agent.agent_id === agentId);
      if (cachedAgent) {
        selectAgent(cachedAgent);
      }
      api.agents.get(agentId as never).then((a) => {
        selectAgent(a);
      }).catch(() => {});
    }
  }, [agentId, agents, selectAgent]);

  useEffect(() => {
    let cancelled = false;

    if (!agentId) {
      resetMessages([]);
      return;
    }
    api.agents
      .listMessages(agentId as never)
      .then((msgs) => {
        if (cancelled) return;
        resetMessages(
          msgs
            .filter((m: Message) =>
              (m.content && m.content.trim().length > 0) ||
              (m.content_blocks && m.content_blocks.length > 0) ||
              m.thinking,
            )
            .map((m: Message) => {
              const allBlocks = m.content_blocks ?? [];
              const blocks = allBlocks
                .filter((b) => b.type === "text" || b.type === "image")
                .map((b) =>
                  b.type === "text"
                    ? { type: "text" as const, text: b.text ?? "" }
                    : { type: "image" as const, media_type: b.media_type ?? "image/png", data: b.data ?? "" },
                );
              return {
                id: m.message_id,
                role: m.role,
                content: m.content,
                contentBlocks: blocks.length > 0 ? blocks : undefined,
                toolCalls: extractToolCalls(allBlocks),
                artifactRefs: extractArtifactRefs(allBlocks),
                thinkingText: m.thinking || undefined,
                thinkingDurationMs: m.thinking_duration_ms ?? null,
              };
            }),
        );
      })
      .catch(console.error);

    return () => { cancelled = true; };
  }, [agentId, resetMessages]);

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

  const agentName = selectedAgent?.name;
  const hasMessages = messages.length > 0 || isStreaming || streamingText || thinkingText;

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
                  Send a message to chat with {agentName ?? "this agent"} across all linked projects
                </Text>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isStreaming && !streamingText && !thinkingText && activeToolCalls.length === 0 && (
                  <CookingIndicator label={progressText || "Cooking..."} />
                )}
                {(streamingText || thinkingText || activeToolCalls.length > 0) && (
                  <StreamingBubble
                    text={streamingText}
                    toolCalls={activeToolCalls}
                    thinkingText={thinkingText}
                    thinkingDurationMs={thinkingDurationMs}
                    progressText={progressText}
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
          agentName={agentName}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
        />
      </div>
    </div>
  );
}
