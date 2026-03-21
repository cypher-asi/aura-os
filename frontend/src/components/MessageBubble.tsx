import { memo, useMemo } from "react";
import { FileText } from "lucide-react";
import type { ArtifactRef, DisplayMessage, ToolCallEntry, TimelineItem } from "../types/stream";
import { stripEmojis, normalizeMidSentenceBreaks } from "../utils/text-normalize";
import { langFromPath } from "../ide/lang";
import { useHighlightedHtml } from "../hooks/use-highlighted-html";
import styles from "./MessageBubble.module.css";
import toolStyles from "./ToolCallBlock.module.css";
import { ResponseBlock } from "./ResponseBlock";
import { CookingIndicator, getStreamingPhaseLabel } from "./CookingIndicator";
import { SegmentedContent } from "./SegmentedContent";
import { ThinkingRow } from "./ThinkingRow";
import { ToolCallsList } from "./ToolRow";
import { ActivityTimeline } from "./ActivityTimeline";

interface Props {
  message: DisplayMessage;
}

function ArtifactRefsList({ refs }: { refs: ArtifactRef[] }) {
  const tasks = refs.filter((r) => r.kind === "task");
  const specs = refs.filter((r) => r.kind === "spec");
  return (
    <div className={toolStyles.artifactRefs}>
      {specs.map((ref) => (
        <div key={ref.id} className={toolStyles.artifactRef}>
          <span className={toolStyles.artifactRefIcon}>spec</span>
          <span className={toolStyles.artifactRefTitle}>{ref.title}</span>
        </div>
      ))}
      {tasks.map((ref) => (
        <div key={ref.id} className={toolStyles.artifactRef}>
          <span className={toolStyles.artifactRefIcon}>task</span>
          <span className={toolStyles.artifactRefTitle}>{ref.title}</span>
        </div>
      ))}
    </div>
  );
}

const FILE_PREFIX_RE = /^\[File:\s*(.+?)\]\n\n([\s\S]*)$/;

function FileAttachmentBlock({ text }: { text: string }) {
  const match = text.match(FILE_PREFIX_RE);
  const fileName = match?.[1] ?? "";
  const language = langFromPath(fileName);
  const highlightedHtml = useHighlightedHtml(match?.[2] ?? "", language);

  if (!match) return <span>{text}</span>;

  return (
    <ResponseBlock
      header={
        <>
          <FileText size={14} className={styles.fileAttachmentIcon} />
          <span className={styles.fileAttachmentName}>{fileName}</span>
        </>
      }
      contentClassName={styles.fileAttachmentContent}
    >
      <pre>
        <code
          className={language ? `hljs language-${language}` : "hljs"}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </ResponseBlock>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: Props) {
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasArtifactRefs = message.artifactRefs && message.artifactRefs.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasThinking = message.thinkingText && message.thinkingText.length > 0;

  const normalizedContent = useMemo(
    () => (hasContent ? normalizeMidSentenceBreaks(stripEmojis(message.content)) : ""),
    [hasContent, message.content],
  );

  if (!hasContent && !hasToolCalls && !hasContentBlocks && !hasThinking && !hasArtifactRefs) return null;

  const renderUserContent = () => {
    if (hasContentBlocks && message.contentBlocks) {
      return (
        <div className={styles.userMessageBlocks}>
          {message.contentBlocks.map((block, i) =>
            block.type === "text" ? (
              FILE_PREFIX_RE.test(block.text) ? (
                <FileAttachmentBlock key={i} text={block.text} />
              ) : (
                <span key={i}>{block.text}</span>
              )
            ) : (
              <img
                key={i}
                src={`data:${block.media_type};base64,${block.data}`}
                alt=""
                className={styles.messageImage}
              />
            ),
          )}
        </div>
      );
    }
    return message.content;
  };

  return (
    <div
      className={`${styles.message} ${
        message.role === "user" ? styles.messageUser : styles.messageAssistant
      }`}
    >
      <div
        className={`${styles.bubble} ${
          message.role === "user" ? styles.bubbleUser : styles.bubbleAssistant
        }`}
      >
        {message.role === "user" ? (
          renderUserContent()
        ) : (
          <div className={styles.markdown}>
            {message.timeline && message.timeline.length > 0 ? (
              <ActivityTimeline
                timeline={message.timeline}
                thinkingText={message.thinkingText}
                thinkingDurationMs={message.thinkingDurationMs}
                toolCalls={message.toolCalls}
                isStreaming={false}
              />
            ) : (
              <>
                {hasThinking && message.thinkingText && (
                  <ThinkingRow
                    text={message.thinkingText}
                    isStreaming={false}
                    durationMs={message.thinkingDurationMs}
                  />
                )}
                {hasToolCalls && message.toolCalls && (
                  <ToolCallsList entries={message.toolCalls} />
                )}
                {hasContent && (
                  <SegmentedContent content={normalizedContent} />
                )}
              </>
            )}
            {hasArtifactRefs && message.artifactRefs && (
              <ArtifactRefsList refs={message.artifactRefs} />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface StreamingBubbleProps {
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  progressText?: string;
}

function StreamingIndicator({
  text,
  thinkingText,
  toolCalls,
  progressText,
}: {
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
}) {
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
  });

  return <CookingIndicator label={label ?? "Cooking..."} />;
}

export function StreamingBubble({ text, toolCalls, thinkingText, thinkingDurationMs, timeline, progressText }: StreamingBubbleProps) {
  const hasTimeline = timeline && timeline.length > 0;
  const isThinking = Boolean(thinkingText) && !text;
  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <div className={styles.markdown}>
          {hasTimeline ? (
            <ActivityTimeline
              timeline={timeline}
              thinkingText={thinkingText}
              thinkingDurationMs={thinkingDurationMs}
              toolCalls={toolCalls}
              isStreaming
            />
          ) : (
            <>
              {thinkingText && (
                <ThinkingRow
                  text={thinkingText}
                  isStreaming={isThinking}
                  durationMs={thinkingDurationMs}
                />
              )}
              {toolCalls && toolCalls.length > 0 && (
                <ToolCallsList entries={toolCalls} />
              )}
              {text && (
                <SegmentedContent content={normalizeMidSentenceBreaks(stripEmojis(text))} />
              )}
            </>
          )}
          <StreamingIndicator text={text} thinkingText={thinkingText} toolCalls={toolCalls} progressText={progressText} />
        </div>
      </div>
    </div>
  );
}
