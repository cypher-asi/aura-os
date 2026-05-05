import { memo, useMemo } from "react";
import { FileText } from "lucide-react";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { langFromPath } from "../../../../ide/lang";
import { useHighlightedHtml } from "../../../../shared/hooks/use-highlighted-html";
import { useUIModalStore } from "../../../../stores/ui-modal-store";
import styles from "./MessageBubble.module.css";
import { ResponseBlock } from "../../../../components/ResponseBlock";
import { CopyButton } from "../../../../components/CopyButton";
import { useGallery, type GalleryItem } from "../../../../components/Gallery";
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
  const fileContents = match?.[2] ?? "";
  const language = langFromPath(fileName);
  const highlightedHtml = useHighlightedHtml(fileContents, language);

  if (!match) return <span>{text}</span>;

  return (
    <div className={styles.fileAttachmentWrapper}>
      <ResponseBlock
        header={
          <>
            <FileText size={14} className={styles.fileAttachmentIcon} />
            <span className={styles.fileAttachmentName}>{fileName}</span>
          </>
        }
        className={styles.fileAttachmentBlock}
        contentClassName={styles.fileAttachmentContent}
      >
        <pre>
          <code
            className={language ? `hljs language-${language}` : "hljs"}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </ResponseBlock>
      <CopyButton
        getText={() => fileContents}
        className={styles.fileAttachmentCopyBtn}
        ariaLabel={`Copy ${fileName || "file"} contents`}
      />
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
  initialThinkingExpanded,
  initialActivitiesExpanded,
}: Props) {
  const openBuyCredits = useUIModalStore((state) => state.openBuyCredits);
  const { openGallery } = useGallery();
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasArtifactRefs = message.artifactRefs && message.artifactRefs.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;
  const hasThinking = message.thinkingText && message.thinkingText.length > 0;
  const hasTimeline = message.timeline && message.timeline.length > 0;
  const isInsufficientCreditsError = message.displayVariant === "insufficientCreditsError";
  const isStreamDropped = message.displayVariant === "streamDropped";

  const galleryImages = useMemo<GalleryItem[]>(() => {
    if (!hasContentBlocks || !message.contentBlocks) return [];
    return message.contentBlocks.flatMap((block, i): GalleryItem[] =>
      block.type === "image"
        ? [{
            id: `${message.id}-img-${i}`,
            src: `data:${block.media_type};base64,${block.data}`,
            alt: "Attached image",
          }]
        : [],
    );
  }, [hasContentBlocks, message.contentBlocks, message.id]);
  // Models sometimes emit an empty text block right before a tool_use; that
  // still leaves contentBlocks non-empty but nothing renderable, so ignore
  // whitespace-only text blocks when deciding if the bubble carries prose.
  const hasRenderableBlocks = (message.contentBlocks ?? []).some(
    (b) => b.type === "image" || (b.type === "text" && b.text.trim().length > 0),
  );
  // A tool-only assistant bubble holds no prose/thinking -- it is just a
  // slice of the agent's tool-use loop. Drop the bubble padding for these
  // so consecutive tool-only bubbles stack as a tight checklist instead of
  // each row floating in its own 16px padding box. Stream-dropped bubbles
  // own their own banner chrome and must not be collapsed into the compact
  // tool-only slot.
  const isAssistantToolOnly =
    message.role === "assistant"
    && !isInsufficientCreditsError
    && !isStreamDropped
    && !hasContent
    && !hasRenderableBlocks
    && !hasThinking
    && (hasToolCalls || hasTimeline);

  // A user message is "widget-only" when every renderable block is either
  // a file attachment (`[File: ...]`) or qualifies as a large-text doc.
  // In that case we drop the grey chat-bubble chrome so the widget itself
  // reads as the message, matching the app background.
  const userBlocksAreAllWidgets = (() => {
    if (message.role !== "user") return false;
    if (hasContentBlocks && message.contentBlocks) {
      const textBlocks = message.contentBlocks.filter((b) => b.type === "text");
      if (textBlocks.length === 0) return false;
      if (message.contentBlocks.some((b) => b.type !== "text")) return false;
      return textBlocks.every((b) => {
        const t = (b as { type: "text"; text: string }).text;
        return FILE_PREFIX_RE.test(t) || isLargeText(t);
      });
    }
    if (hasContent && isLargeText(message.content)) return true;
    return false;
  })();

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
              <button
                key={i}
                type="button"
                className={styles.messageImageWrapper}
                onClick={() => {
                  const targetId = `${message.id}-img-${i}`;
                  if (galleryImages.length === 0) return;
                  openGallery({ items: galleryImages, initialId: targetId });
                }}
                aria-label="Open image in gallery"
              >
                <img
                  src={`data:${block.media_type};base64,${block.data}`}
                  alt=""
                  className={styles.messageImage}
                  loading="lazy"
                />
              </button>
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
    if (isStreamDropped) {
      return (
        <div
          className={styles.streamDroppedBanner}
          role="status"
          aria-live="polite"
        >
          <span className={styles.streamDroppedTitle}>
            Chat stream interrupted
          </span>
          <span className={styles.streamDroppedMessage}>{message.content}</span>
          {(hasToolCalls || hasThinking || hasArtifactRefs || hasTimeline) && (
            <div className={styles.streamDroppedMeta}>
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
    }

    if (!isInsufficientCreditsError) {
      return (
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
      } ${userBlocksAreAllWidgets ? styles.messageUserWidgetOnly : ""}`}
    >
      <div
        className={`${styles.bubble} ${
          message.role === "user"
            ? styles.bubbleUser
            : styles.bubbleAssistant
        } ${isAssistantToolOnly ? styles.bubbleAssistantCompact : ""} ${
          userBlocksAreAllWidgets ? styles.bubbleUserWidgetOnly : ""
        }`}
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
