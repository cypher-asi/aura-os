import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Drawer, Text } from "@cypher-asi/zui";
import { useSidekick } from "../context/SidekickContext";
import styles from "./Sidekick.module.css";

export function Sidekick() {
  const {
    isOpen,
    mode,
    title,
    streamedText,
    streamStage,
    tokenCount,
    selectedSpec,
    infoContent,
    close,
  } = useSidekick();

  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === "streaming" && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamedText, mode]);

  return (
    <Drawer
      side="right"
      isOpen={isOpen}
      onClose={close}
      title={title}
      defaultSize={520}
      minSize={340}
      maxSize={780}
      storageKey="aura-sidekick"
    >
      <div className={styles.sidekickBody}>
        {mode === "streaming" && (
          <>
            {streamStage && (
              <div className={styles.stageLabel}>
                <span>{streamStage}</span>
                {tokenCount > 0 && (
                  <span className={styles.tokenCount}>
                    {tokenCount.toLocaleString()} tokens
                  </span>
                )}
              </div>
            )}
            <div className={styles.streamArea}>
              {streamedText || (
                <Text variant="muted" size="sm">
                  Waiting for response...
                </Text>
              )}
              <div ref={streamEndRef} />
            </div>
          </>
        )}

        {mode === "viewing" && selectedSpec && (
          <div className={styles.viewerArea}>
            <div className={styles.markdown}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {selectedSpec.markdown_contents}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {mode === "info" && infoContent && (
          <div className={styles.infoArea}>
            {infoContent}
          </div>
        )}
      </div>
    </Drawer>
  );
}
