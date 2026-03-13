import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Text, Button, Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { ArrowUp, Square, Plus, MessageSquare, FileText } from "lucide-react";
import { api } from "../api/client";
import { useSidekick } from "../context/SidekickContext";
import type { ChatMessage } from "../types";
import styles from "./ChatView.module.css";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export function ChatView() {
  const { projectId, chatSessionId } = useParams<{
    projectId: string;
    chatSessionId: string;
  }>();
  const navigate = useNavigate();
  const sidekick = useSidekick();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (autoScrollRef.current && messageAreaRef.current) {
      messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
    }
  }, []);

  // Persist last visited chat for restoring on app open
  useEffect(() => {
    if (projectId && chatSessionId) {
      localStorage.setItem(
        "aura-last-chat",
        JSON.stringify({ projectId, chatSessionId }),
      );
    }
  }, [projectId, chatSessionId]);

  // Load messages on session change
  useEffect(() => {
    if (!projectId || !chatSessionId) {
      setMessages([]);
      return;
    }
    api
      .getChatMessages(projectId, chatSessionId)
      .then((msgs) => {
        setMessages(
          msgs.map((m: ChatMessage) => ({
            id: m.message_id,
            role: m.role,
            content: m.content,
          })),
        );
      })
      .catch(console.error);
  }, [projectId, chatSessionId]);

  // Auto-scroll when messages change or streaming text updates
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!plusMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [plusMenuOpen]);

  const plusMenuItems: MenuItem[] = [
    { id: "generate_specs", label: "Generate Specs", icon: <FileText size={14} /> },
  ];

  const handleScroll = () => {
    const el = messageAreaRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const sendMessage = useCallback(
    async (content: string, action: string | null = null) => {
      if (!projectId || !chatSessionId || isStreaming) return;
      const trimmed = content.trim();
      if (!trimmed && !action) return;

      const userMsg: DisplayMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed || (action === "generate_specs" ? "Generate specs for this project" : trimmed),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);
      sidekick.setStreamingSessionId(chatSessionId);
      setStreamingText("");
      streamBufferRef.current = "";
      autoScrollRef.current = true;

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      if (action === "generate_specs") {
        sidekick.clearGeneratedArtifacts();
        sidekick.setActiveTab("specs");
      }

      const controller = new AbortController();
      abortRef.current = controller;

      await api.sendMessageStream(
        projectId,
        chatSessionId,
        userMsg.content,
        action,
        {
          onDelta(text) {
            streamBufferRef.current += text;
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                setStreamingText(streamBufferRef.current);
              });
            }
          },
          onSpecSaved(spec) {
            sidekick.pushSpec(spec);
          },
          onTaskSaved(task) {
            sidekick.pushTask(task);
          },
          onMessageSaved(msg) {
            setMessages((prev) => [
              ...prev,
              { id: msg.message_id, role: "assistant", content: msg.content },
            ]);
            setStreamingText("");
            streamBufferRef.current = "";
          },
          onTitleUpdated(session) {
            sidekick.notifySessionTitleUpdate(session);
          },
          onError(message) {
            console.error("Chat stream error:", message);
            if (streamBufferRef.current) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `error-${Date.now()}`,
                  role: "assistant",
                  content: streamBufferRef.current + `\n\n*Error: ${message}*`,
                },
              ]);
            }
            setStreamingText("");
            streamBufferRef.current = "";
          },
          onDone() {
            if (streamBufferRef.current && !isStreaming) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `stream-${Date.now()}`,
                  role: "assistant",
                  content: streamBufferRef.current,
                },
              ]);
              setStreamingText("");
              streamBufferRef.current = "";
            }
            setIsStreaming(false);
            sidekick.setStreamingSessionId(null);
            abortRef.current = null;
          },
        },
        controller.signal,
      );

      setIsStreaming(false);
      sidekick.setStreamingSessionId(null);
      abortRef.current = null;
    },
    [projectId, chatSessionId, isStreaming, sidekick],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (streamBufferRef.current) {
      setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant",
          content: streamBufferRef.current,
        },
      ]);
    }
    setStreamingText("");
    streamBufferRef.current = "";
    setIsStreaming(false);
    sidekick.setStreamingSessionId(null);
    abortRef.current = null;
  }, [sidekick]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // If no session is selected, show empty prompt
  if (!chatSessionId) {
    return (
      <div className={styles.container}>
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
    );
  }

  const hasMessages = messages.length > 0 || streamingText;

  return (
    <div className={styles.container}>
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
              <div
                key={msg.id}
                className={`${styles.message} ${
                  msg.role === "user" ? styles.messageUser : styles.messageAssistant
                }`}
              >
                <div
                  className={`${styles.bubble} ${
                    msg.role === "user" ? styles.bubbleUser : styles.bubbleAssistant
                  }`}
                >
                  {msg.role === "user" ? (
                    msg.content
                  ) : (
                    <div className={styles.markdown}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {streamingText && (
              <div className={`${styles.message} ${styles.messageAssistant}`}>
                <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                  <div className={styles.markdown}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                    >
                      {streamingText}
                    </ReactMarkdown>
                    <span className={styles.streamingCursor} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.inputWrapper}>
        <div className={styles.inputContainer}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message Aura..."
            rows={1}
          />
          <div className={styles.inputToolbar}>
            <div className={styles.toolbarLeft}>
              <div ref={plusMenuRef} className={styles.plusMenuWrap}>
                <button
                  type="button"
                  className={styles.attachButton}
                  onClick={() => setPlusMenuOpen((v) => !v)}
                  aria-label="Actions"
                >
                  <Plus size={18} />
                </button>
                {plusMenuOpen && (
                  <div className={styles.plusMenu}>
                    <Menu
                      items={plusMenuItems}
                      onChange={(id) => {
                        setPlusMenuOpen(false);
                        if (id === "generate_specs") {
                          sendMessage("Generate specs for this project", "generate_specs");
                        }
                      }}
                      background="solid"
                      border="solid"
                      rounded="md"
                      width={200}
                      isOpen
                    />
                  </div>
                )}
              </div>
            </div>
            <div className={styles.toolbarRight}>
              {isStreaming ? (
                <button
                  type="button"
                  className={`${styles.sendButton} ${styles.stopButton}`}
                  onClick={stopStreaming}
                  aria-label="Stop"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  aria-label="Send"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
