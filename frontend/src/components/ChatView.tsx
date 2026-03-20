import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { api } from "../api/client";
import { useChatStream } from "../hooks/use-chat-stream";
import { useAutoScroll } from "../hooks/use-auto-scroll";
import { setLastAgent } from "../utils/storage";
import { MessageBubble, StreamingBubble } from "./MessageBubble";
import { CookingIndicator } from "./CookingIndicator";
import { ChatInputBar } from "./ChatInputBar";
import type { ChatInputBarHandle, AttachmentItem } from "./ChatInputBar";
import type { Message } from "../types";
import { extractToolCalls, extractArtifactRefs } from "../utils/chat-history";
import styles from "./ChatView.module.css";

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
    progressText,
    sendMessage,
    stopStreaming,
    resetMessages,
    rafRef,
  } = useChatStream({ projectId, agentInstanceId });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [agentName, setAgentName] = useState<string | undefined>();
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);

  const messageAreaRef = useRef<HTMLDivElement>(null);
  const prevIsStreamingRef = useRef(false);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const { handleScroll } = useAutoScroll(messageAreaRef, agentInstanceId);

  useEffect(() => {
    let frame: number | null = null;
    if (projectId && agentInstanceId) {
      setLastAgent(projectId, agentInstanceId);
      frame = window.requestAnimationFrame(() => inputBarRef.current?.focus());
      api.getAgentInstance(projectId, agentInstanceId).then((inst) => {
        setAgentName(inst.name);
      }).catch(() => {});
    } else {
      frame = window.requestAnimationFrame(() => setAgentName(undefined));
    }
    return () => {
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
    let cancelled = false;

    if (!projectId || !agentInstanceId) {
      queueMicrotask(() => {
        if (!cancelled) {
          resetMessages([]);
          setContextUsagePercent(null);
        }
      });
      return;
    }

    api
      .getMessages(projectId, agentInstanceId)
      .then((msgs) => {
        if (cancelled) return;

        resetMessages(
          msgs
            .filter((m: Message) => (m.content && m.content.trim().length > 0) || (m.content_blocks && m.content_blocks.length > 0) || m.thinking)
            .map((m: Message) => {
              const allBlocks = m.content_blocks ?? [];
              const displayBlocks = allBlocks
                .filter((b) => b.type === "text" || b.type === "image")
                .map((b) =>
                  b.type === "text" ? { type: "text" as const, text: b.text ?? "" } : { type: "image" as const, media_type: b.media_type ?? "image/png", data: b.data ?? "" }
                );
              return {
                id: m.message_id,
                role: m.role,
                content: m.content,
                contentBlocks: displayBlocks.length > 0 ? displayBlocks : undefined,
                toolCalls: extractToolCalls(allBlocks),
                artifactRefs: extractArtifactRefs(allBlocks),
                thinkingText: m.thinking || undefined,
                thinkingDurationMs: m.thinking_duration_ms ?? null,
              };
            }),
        );
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [projectId, agentInstanceId, resetMessages]);

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

  if (!agentInstanceId) {
    return null;
  }

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
                {`Start chatting with ${agentName ?? "this agent"}.`}
              </EmptyState>
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
          contextUsagePercent={projectId && agentInstanceId ? contextUsagePercent : undefined}
        />
      </div>
    </div>
  );
}
