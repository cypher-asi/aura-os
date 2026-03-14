import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Text, Button } from "@cypher-asi/zui";
import { MessageSquare } from "lucide-react";
import { api } from "../api/client";
import { useChatStream } from "../hooks/use-chat-stream";
import { useProjectContext } from "../context/ProjectContext";
import { setLastChat } from "../utils/storage";
import { MessageBubble, StreamingBubble } from "./MessageBubble";
import { ChatInputBar } from "./ChatInputBar";
import { TerminalPanel } from "./TerminalPanel";
import type { ChatInputBarHandle } from "./ChatInputBar";
import type { ChatMessage } from "../types";
import styles from "./ChatView.module.css";

export function ChatView() {
  const { projectId, chatSessionId } = useParams<{
    projectId: string;
    chatSessionId: string;
  }>();
  const navigate = useNavigate();
  const ctx = useProjectContext();

  const {
    messages,
    isStreaming,
    streamingText,
    activeToolCalls,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  } = useChatStream({ projectId, chatSessionId });

  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("opus-4.6");

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const inputBarRef = useRef<ChatInputBarHandle>(null);

  const scrollToBottom = useCallback(() => {
    if (autoScrollRef.current && messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (projectId && chatSessionId) {
      setLastChat(projectId, chatSessionId);
      inputBarRef.current?.focus();
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
          msgs.map((m: ChatMessage) => ({
            id: m.message_id,
            role: m.role,
            content: m.content,
          })),
        );
      })
      .catch(console.error);
  }, [projectId, chatSessionId, resetMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [rafRef]);

  const handleScroll = () => {
    const el = messageAreaRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  const handleSend = useCallback(
    (content: string, action?: string) => {
      setInput("");
      sendMessage(content, action ?? null, selectedModel);
    },
    [sendMessage, selectedModel],
  );

  if (!chatSessionId) {
    return (
      <div className={styles.container}>
        <div className={styles.chatArea}>
          <div className={styles.emptyState}>
            <MessageSquare size={40} className={styles.emptyIcon} />
            <Text variant="muted" size="sm">
              Select a chat session or create a new one
            </Text>
            {projectId && (
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  try {
                    const session = await api.createChatSession(projectId, "New Chat");
                    navigate(`/projects/${projectId}/chat/${session.chat_session_id}`);
                  } catch (err) {
                    console.error("Failed to create session", err);
                  }
                }}
              >
                Start a new chat
              </Button>
            )}
          </div>
        </div>
        <TerminalPanel cwd={ctx?.project.linked_folder_path} />
      </div>
    );
  }

  const hasMessages = messages.length > 0 || streamingText;

  return (
    <div className={styles.container}>
      <div className={styles.chatArea}>
        <div
          className={styles.messageArea}
          ref={messageAreaRef}
          onScroll={handleScroll}
        >
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
              {(streamingText || activeToolCalls.length > 0) && (
                <StreamingBubble text={streamingText} toolCalls={activeToolCalls} />
              )}
            </>
          )}
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
        />
      </div>

      <TerminalPanel cwd={ctx?.project.linked_folder_path} />
    </div>
  );
}
