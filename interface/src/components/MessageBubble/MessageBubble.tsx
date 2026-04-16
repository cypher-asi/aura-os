import { memo } from "react";
import { FileText } from "lucide-react";
import type { DisplaySessionEvent } from "../../types/stream";
import { langFromPath } from "../../ide/lang";
import { useHighlightedHtml } from "../../hooks/use-highlighted-html";
import { useUIModalStore } from "../../stores/ui-modal-store";
import styles from "./MessageBubble.module.css";
import { ResponseBlock } from "../ResponseBlock";
import { LLMOutput } from "../LLMOutput";
import { LargeTextBlock, isLargeText } from "./LargeTextBlock";

interface Props {
  message: DisplaySessionEvent;
  isStreaming?: boolean;
  initialThinkingExpanded?: boolean;
  initialActivitiesExpanded?: boolean;
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

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
  initialThinkingExpanded,
  initialActivitiesExpanded,
}: Props) {
  const openBuyCredits = useUIModalStore((state) => state.openBuyCredits);
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasArtifactRefs = message.artifactRefs && message.artifactRefs.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasThinking = message.thinkingText && message.thinkingText.length > 0;
  const hasTimeline = message.timeline && message.timeline.length > 0;
  const isInsufficientCreditsError = message.displayVariant === "insufficientCreditsError";
  // Models sometimes emit an empty text block right before a tool_use; that
  // still leaves contentBlocks non-empty but nothing renderable, so ignore
  // whitespace-only text blocks when deciding if the bubble carries prose.
  const hasRenderableBlocks = (message.contentBlocks ?? []).some(
    (b) => b.type === "image" || (b.type === "text" && b.text.trim().length > 0),
  );
  // A tool-only assistant bubble holds no prose/thinking -- it is just a
  // slice of the agent's tool-use loop. Drop the bubble padding for these
  // so consecutive tool-only bubbles stack as a tight checklist instead of
  // each row floating in its own 16px padding box.
  const isAssistantToolOnly =
    message.role === "assistant"
    && !isInsufficientCreditsError
    && !hasContent
    && !hasRenderableBlocks
    && !hasThinking
    && (hasToolCalls || hasTimeline);

  if (!hasContent && !hasToolCalls && !hasContentBlocks && !hasThinking && !hasArtifactRefs) return null;

  const renderUserContent = () => {
    if (hasContentBlocks && message.contentBlocks) {
      return (
        <div className={styles.userMessageBlocks}>
          {message.contentBlocks.map((block, i) =>
            block.type === "text" ? (
              FILE_PREFIX_RE.test(block.text) ? (
                <FileAttachmentBlock key={i} text={block.text} />
              ) : isLargeText(block.text) ? (
                <LargeTextBlock key={i} text={block.text} />
              ) : (
                <span key={i}>{block.text}</span>
              )
            ) : (
              <div key={i} className={styles.messageImageWrapper}>
                <img
                  src={`data:${block.media_type};base64,${block.data}`}
                  alt=""
                  className={styles.messageImage}
                  loading="lazy"
                />
              </div>
            ),
          )}
        </div>
      );
    }
    if (hasContent && isLargeText(message.content)) {
      return <LargeTextBlock text={message.content} />;
    }
    return message.content;
  };

  const renderAssistantContent = () => {
    if (!isInsufficientCreditsError) {
      return (
        <div className={styles.markdown}>
          <LLMOutput
            content={message.content}
            timeline={message.timeline}
            toolCalls={message.toolCalls}
            thinkingText={message.thinkingText}
            thinkingDurationMs={message.thinkingDurationMs}
            artifactRefs={message.artifactRefs}
            isStreaming={isStreaming}
            defaultThinkingExpanded={initialThinkingExpanded}
            defaultActivitiesExpanded={initialActivitiesExpanded}
          />
        </div>
      );
    }

    return (
      <div className={styles.inlineError}>
        <span className={styles.inlineErrorMessage}>{message.content}</span>
        <button
          type="button"
          className={styles.inlineErrorLink}
          onClick={openBuyCredits}
        >
          Buy credits
        </button>
        {(hasToolCalls || hasThinking || hasArtifactRefs || hasTimeline) && (
          <div className={styles.inlineErrorMeta}>
            <LLMOutput
              content=""
              timeline={message.timeline}
              toolCalls={message.toolCalls}
              thinkingText={message.thinkingText}
              thinkingDurationMs={message.thinkingDurationMs}
              artifactRefs={message.artifactRefs}
              isStreaming={isStreaming}
              defaultThinkingExpanded={initialThinkingExpanded}
              defaultActivitiesExpanded={initialActivitiesExpanded}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`${styles.message} ${
        message.role === "user" ? styles.messageUser : styles.messageAssistant
      }`}
    >
      <div
        className={`${styles.bubble} ${
          message.role === "user"
            ? styles.bubbleUser
            : styles.bubbleAssistant
        } ${isAssistantToolOnly ? styles.bubbleAssistantCompact : ""}`}
      >
        {message.role === "user" ? (
          renderUserContent()
        ) : (
          renderAssistantContent()
        )}
      </div>
    </div>
  );
});
