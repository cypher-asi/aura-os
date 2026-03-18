import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { api } from "../../api/client";
import { useAgentChatStream } from "../../hooks/use-agent-chat-stream";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { useAgentApp } from "./AgentAppProvider";
import { MessageBubble, StreamingBubble } from "../../components/MessageBubble";
import { CookingIndicator } from "../../components/CookingIndicator";
import { ChatInputBar } from "../../components/ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../../components/ChatInputBar";
import type { Message, ChatContentBlock } from "../../types";
import type { ToolCallEntry } from "../../hooks/use-chat-stream";
import styles from "../../components/ChatView.module.css";

function extractToolCalls(blocks: ChatContentBlock[]): ToolCallEntry[] | undefined {
  const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
  if (toolUseBlocks.length === 0) return undefined;
  const resultMap = new Map<string, { result: string; isError: boolean }>();
  for (const b of blocks) {
    if (b.type === "tool_result" && b.tool_use_id) {
      resultMap.set(b.tool_use_id, {
        result: b.content ?? "",
        isError: b.is_error === true,
      });
    }
  }
  return toolUseBlocks.map((b) => {
    const res = resultMap.get(b.id ?? "");
    return {
      id: b.id ?? "",
      name: b.name ?? "",
      input: (b.input as Record<string, unknown>) ?? {},
      result: res?.result,
      isError: res?.isError,
      pending: false,
    };
  });
}

export function AgentChatView() {
  const { agentId } = useParams<{ agentId: string }>();
  const { selectedAgent, selectAgent } = useAgentApp();

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
  } = useAgentChatStream({ agentId });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { handleScroll } = useAutoScroll(messageAreaRef, agentId);

  useEffect(() => {
    if (agentId) {
      localStorage.setItem("aura:lastAgentId", agentId);
      requestAnimationFrame(() => inputBarRef.current?.focus());
      api.agents.get(agentId as never).then((a) => {
        selectAgent(a);
      }).catch(() => {});
    }
  }, [agentId, selectAgent]);

  useEffect(() => {
    if (!agentId) {
      resetMessages([]);
      return;
    }
    api.agents
      .listMessages(agentId as never)
      .then((msgs) => {
        resetMessages(
          msgs
            .filter((m: Message) =>
              (m.content && m.content.trim().length > 0) ||
              (m.content_blocks && m.content_blocks.length > 0) ||
              m.thinking,
            )
            .map((m: Message) => {
              const allBlocks = m.content_blocks ?? [];
              const displayBlocks = allBlocks
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
                contentBlocks: displayBlocks.length > 0 ? displayBlocks : undefined,
                toolCalls: extractToolCalls(allBlocks),
                thinkingText: m.thinking || undefined,
                thinkingDurationMs: m.thinking_duration_ms ?? null,
              };
            }),
        );
      })
      .catch(console.error);
  }, [agentId, resetMessages]);

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
      sendMessage(content, action ?? null, null, apiAttachments);
      setAttachments([]);
    },
    [sendMessage, attachments],
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
              <EmptyState icon={<MessageSquare size={40} />}>
                Send a message to chat with {agentName ?? "this agent"} across all linked projects
              </EmptyState>
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isStreaming && !streamingText && !thinkingText && activeToolCalls.length === 0 && (
                  <CookingIndicator />
                )}
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
          agentName={agentName}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />
      </div>
    </div>
  );
}
