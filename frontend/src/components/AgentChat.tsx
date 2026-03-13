import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Spinner, Text } from "@cypher-asi/zui";
import { MessageSquare } from "lucide-react";
import { useSidekick } from "../context/SidekickContext";
import styles from "./AgentChat.module.css";

export function AgentChat() {
  const {
    isStreaming,
    streamTitle,
    streamedText,
    streamStage,
    tokenCount,
    savedSpecs,
  } = useSidekick();

  const chatAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatAreaRef.current;
    if (isStreaming && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamedText, savedSpecs, isStreaming]);

  const hasContent = isStreaming || streamedText || savedSpecs.length > 0;

  return (
    <div className={styles.chatContainer}>
      {isStreaming && streamStage && (
        <div className={styles.header}>
          <Spinner size="sm" />
          <span>{streamStage}</span>
          {tokenCount > 0 && (
            <span className={styles.tokenCount}>
              {tokenCount.toLocaleString()} tokens
            </span>
          )}
        </div>
      )}

      <div className={styles.chatArea} ref={chatAreaRef}>
        {hasContent ? (
          <>
            {streamTitle && (
              <Text size="lg" style={{ fontWeight: 600, marginBottom: "var(--space-4)" }}>
                {streamTitle}
              </Text>
            )}
            {streamedText && (
              <div className={styles.markdown}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {streamedText}
                </ReactMarkdown>
              </div>
            )}
            {savedSpecs.map((spec) => (
              <div key={spec.spec_id} className={styles.savedSpecBlock}>
                <div className={styles.savedSpecTitle}>{spec.title}</div>
                <div className={styles.markdown}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {spec.markdown_contents}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            {isStreaming && !streamedText && (
              <Text variant="muted" size="sm">
                Waiting for response...
              </Text>
            )}
          </>
        ) : (
          <div className={styles.emptyState}>
            <MessageSquare size={40} className={styles.emptyIcon} />
            <Text variant="muted" size="sm">
              Agent output will appear here
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
