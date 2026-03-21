import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { api } from "../api/client";
import { useChatStream } from "../hooks/use-chat-stream";
import { useAutoScroll } from "../hooks/use-auto-scroll";
import { setLastAgent } from "../utils/storage";
import { buildDisplayMessages } from "../utils/build-display-messages";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputBar } from "./ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "./ChatInputBar";
import type { DisplayMessage } from "../types/stream";
import styles from "./ChatView.module.css";

function debugSwitchLog(message: string, details: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    console.debug(`[ChatView switch] ${message}`, details);
  }
}

type CachedHistory = { messages: DisplayMessage[]; fetchedAt: number };
const HISTORY_CACHE_TTL_MS = 30_000;
const historyCache = new Map<string, CachedHistory>();

function chatCacheKey(projectId: string, agentInstanceId: string): string {
  return `${projectId}:${agentInstanceId}`;
}

export function ChatView() {
  const { projectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();

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
  } = useChatStream({ projectId, agentInstanceId });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [agentName, setAgentName] = useState<string | undefined>();
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(() => {
    if (!projectId || !agentInstanceId) return false;
    return !historyCache.has(chatCacheKey(projectId, agentInstanceId));
  });

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const prevIsStreamingRef = useRef(false);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const metadataLoadIdRef = useRef(0);
  const historyLoadIdRef = useRef(0);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const { handleScroll } = useAutoScroll(messageAreaRef, agentInstanceId);

  useEffect(() => {
    let frame: number | null = null;
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();

    if (projectId && agentInstanceId) {
      setLastAgent(projectId, agentInstanceId);
      frame = window.requestAnimationFrame(() => inputBarRef.current?.focus());
      api
        .getAgentInstance(projectId, agentInstanceId, { signal: controller.signal })
        .then((inst) => {
          if (loadId === metadataLoadIdRef.current) {
            setAgentName(inst.name);
          } else {
            debugSwitchLog("discarded stale metadata response", { loadId, projectId, agentInstanceId });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
        });
    } else {
      frame = window.requestAnimationFrame(() => setAgentName(undefined));
    }

    return () => {
      controller.abort();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [projectId, agentInstanceId]);

  const fetchActiveSessionContext = useCallback(async () => {
    if (!projectId || !agentInstanceId) {
      return null;
    }

    try {
      const sessions = await api.listSessions(projectId, agentInstanceId);
      const active = sessions.find((s) => s.status === "active");
      if (active != null && typeof active.context_usage_estimate === "number") {
        return Math.round(active.context_usage_estimate * 100);
      }
    } catch {
      // Ignore context refresh failures and fall back to no usage display.
    }

    return null;
  }, [projectId, agentInstanceId]);

  useEffect(() => {
    let cancelled = false;

    void fetchActiveSessionContext().then((nextPercent) => {
      if (!cancelled) {
        setContextUsagePercent(nextPercent);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchActiveSessionContext]);

  useEffect(() => {
    let cancelled = false;

    if (prevIsStreamingRef.current && !isStreaming) {
      void fetchActiveSessionContext().then((nextPercent) => {
        if (!cancelled) {
          setContextUsagePercent(nextPercent);
        }
      });
    }

    prevIsStreamingRef.current = isStreaming;

    return () => {
      cancelled = true;
    };
  }, [isStreaming, fetchActiveSessionContext]);

  useEffect(() => {
    const loadId = ++historyLoadIdRef.current;
    const controller = new AbortController();

    if (!projectId || !agentInstanceId) {
      setIsHistoryLoading(false);
      queueMicrotask(() => {
        if (loadId === historyLoadIdRef.current) {
          resetMessages([], { allowWhileStreaming: true });
          setContextUsagePercent(null);
        }
      });
      return () => {
        controller.abort();
      };
    }

    const reveal = () => {
      requestAnimationFrame(() => {
        const el = messageAreaRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
          el.style.visibility = "";
        }
      });
    };

    const cacheKey = chatCacheKey(projectId, agentInstanceId);
    const cached = historyCache.get(cacheKey);
    const now = Date.now();
    const cacheIsFresh = cached != null && now - cached.fetchedAt < HISTORY_CACHE_TTL_MS;

    if (cached) {
      const el = messageAreaRef.current;
      if (el) el.style.visibility = "hidden";
      resetMessages(cached.messages, { allowWhileStreaming: true });
      setIsHistoryLoading(false);
      reveal();
      if (cacheIsFresh) return () => { controller.abort(); };
    } else {
      setIsHistoryLoading(true);
    }

    api
      .getMessages(projectId, agentInstanceId, { signal: controller.signal })
      .then((msgs) => {
        if (loadId !== historyLoadIdRef.current) {
          debugSwitchLog("discarded stale history response", { loadId, projectId, agentInstanceId });
          return;
        }
        const displayMessages = buildDisplayMessages(msgs);
        historyCache.set(cacheKey, { messages: displayMessages, fetchedAt: Date.now() });
        if (!cached && messageAreaRef.current) messageAreaRef.current.style.visibility = "hidden";
        resetMessages(displayMessages, { allowWhileStreaming: true });
        setIsHistoryLoading(false);
        if (!cached) reveal();
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (loadId === historyLoadIdRef.current) {
          setIsHistoryLoading(false);
          if (messageAreaRef.current) messageAreaRef.current.style.visibility = "";
        }
        console.error(error);
      });

    return () => {
      controller.abort();
    };
  }, [projectId, agentInstanceId, resetMessages]);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const handleSend = useCallback(
    (content: string, action?: string, atts?: AttachmentItem[]) => {
      setInput("");
      if (projectId && agentInstanceId) {
        historyCache.delete(chatCacheKey(projectId, agentInstanceId));
      }
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
    [sendMessage, projectId, agentInstanceId],
  );

  if (!agentInstanceId) {
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
                isHistoryLoading ? (
                  <EmptyState icon={<MessageSquare size={40} />}>
                    Loading conversation...
                  </EmptyState>
                ) : (
                  <EmptyState icon={<MessageSquare size={40} />}>
                    {`Start chatting with ${agentName ?? "this agent"}.`}
                  </EmptyState>
                )
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
          contextUsagePercent={projectId && agentInstanceId ? contextUsagePercent : undefined}
        />
      </div>
    </div>
  );
}
