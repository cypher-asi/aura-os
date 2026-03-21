import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { MessageSquare } from "lucide-react";
import { api } from "../../api/client";
import { useAgentChatStream } from "../../hooks/use-agent-chat-stream";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { useAgentApp } from "./AgentAppProvider";
import { buildDisplayMessages } from "../../utils/build-display-messages";
import { ChatMessageList } from "../../components/ChatMessageList";
import { ChatInputBar } from "../../components/ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "../../components/ChatInputBar";
import styles from "../../components/ChatView.module.css";

function debugSwitchLog(message: string, details: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    console.debug(`[AgentChatView switch] ${message}`, details);
  }
}

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
    timeline,
    progressText,
    sendMessage,
    stopStreaming,
    resetMessages,
  } = useAgentChatStream({ agentId });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const metadataLoadIdRef = useRef(0);
  const historyLoadIdRef = useRef(0);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const { handleScroll } = useAutoScroll(messageAreaRef, agentId);

  useEffect(() => {
    if (agentId) {
      localStorage.setItem("aura:lastAgentId", agentId);
      requestAnimationFrame(() => inputBarRef.current?.focus());
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    const cachedAgent = agents.find((agent) => agent.agent_id === agentId);
    if (cachedAgent && selectedAgent?.agent_id !== agentId) {
      selectAgent(cachedAgent);
    }
  }, [agentId, agents, selectedAgent?.agent_id, selectAgent]);

  useEffect(() => {
    if (!agentId) return;
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();

    api.agents
      .get(agentId as never, { signal: controller.signal })
      .then((agent) => {
        if (loadId === metadataLoadIdRef.current) {
          selectAgent(agent);
        } else {
          debugSwitchLog("discarded stale metadata response", { loadId, agentId });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => {
      controller.abort();
    };
  }, [agentId, selectAgent]);

  useEffect(() => {
    const loadId = ++historyLoadIdRef.current;
    const controller = new AbortController();

    if (!agentId) {
      setIsHistoryLoading(false);
      resetMessages([], { allowWhileStreaming: true });
      return () => {
        controller.abort();
      };
    }

    setIsHistoryLoading(true);
    api.agents
      .listMessages(agentId as never, { signal: controller.signal })
      .then((msgs) => {
        if (loadId !== historyLoadIdRef.current) {
          debugSwitchLog("discarded stale history response", { loadId, agentId });
          return;
        }
        resetMessages(buildDisplayMessages(msgs), { allowWhileStreaming: true });
        setIsHistoryLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (loadId === historyLoadIdRef.current) {
          setIsHistoryLoading(false);
        }
        console.error(error);
      });

    return () => {
      controller.abort();
    };
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
                <div className={styles.emptyState}>
                  <MessageSquare size={40} />
                  <Text variant="muted" size="sm">
                    {isHistoryLoading
                      ? "Loading conversation..."
                      : `Send a message to chat with ${agentName ?? "this agent"} across all linked projects`}
                  </Text>
                </div>
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
          agentName={agentName}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onRemoveAttachment={handleRemoveAttachment}
        />
      </div>
    </div>
  );
}
