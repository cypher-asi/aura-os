import { useState, useRef, useEffect } from "react";
import { stripEmojis } from "../../utils/text-normalize";
import { formatDuration } from "../../utils/format";
import { ResponseBlock } from "../ResponseBlock";
import styles from "./ThinkingRow.module.css";

interface ThinkingRowProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
}

export function ThinkingRow({ text, isStreaming, durationMs }: ThinkingRowProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef(isStreaming);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setAnimate(false);
      const frame = window.requestAnimationFrame(() => {
        setExpanded(false);
        requestAnimationFrame(() => setAnimate(true));
      });
      prevStreamingRef.current = isStreaming;
      return () => window.cancelAnimationFrame(frame);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (expanded && isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, expanded, isStreaming]);

  const durationLabel = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  return (
    <ResponseBlock
      expanded={expanded}
      onExpandedChange={setExpanded}
      maxExpandedHeight={300}
      animate={animate}
      className={styles.thinkingBlock}
      header={
        <span className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}>
          {durationLabel}
        </span>
      }
    >
      <div ref={contentRef} className={styles.thinkingContent}>
        {stripEmojis(text)}
      </div>
    </ResponseBlock>
  );
}
